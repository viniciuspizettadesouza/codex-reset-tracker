#!/usr/bin/env node
/**
 * Autonomous event collector — runs via GitHub Actions every 4h.
 * Sources: Reddit RSS (no auth) + OpenAI Status API (no auth).
 * No external dependencies. Node 18+ required (native fetch).
 *
 * Exit codes:
 *   0 — no new events found, JSON unchanged
 *   1 — new events written to data/resets.json
 *   2 — unexpected error
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { upsertEvent, deriveStatus } from "./lib/events.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "../data/resets.json");

const USER_AGENT = "codex-reset-tracker/1.0 (github.com/user/codex-reset-tracker)";
// Broad in r/codex (context is already Codex) plus Codex-qualified phrases for the
// general subreddits. Matched case-insensitively against post titles.
const KEYWORDS = [
  "rate limit reset", "rate limits reset", "limit reset", "limits reset",
  "reset early", "reset for all", "reset for everyone", "quota reset",
  "usage reset", "quota refresh", "quota restored", "quota back",
  "codex is back", "codex refreshed", "quota replenished", "weekly limit reset",
];
// r/codex is where early resets are usually reported first (often within minutes).
const SUBREDDITS = ["codex", "ChatGPT", "OpenAI"];

// Posts within 6h of each other are considered the same event.
const CLUSTER_WINDOW_MS = 6 * 60 * 60 * 1000;

async function fetchWithRetry(url, options, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429 && i < retries) {
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      return res;
    } catch (err) {
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// Minimal RSS/Atom parser — extracts <item> or <entry> blocks without dependencies.
function parseRssItems(xml) {
  const items = [];
  const titleRe = /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/;
  const linkRe = /<(?:link|id)[^>]*>(?:<!\[CDATA\[)?(https?[^<\]]+)/;
  const dateRe = /<(?:pubDate|published|updated)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated)>/;
  // Match both RSS <item> and Atom <entry>
  const itemRe = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const title = (titleRe.exec(block) ?? [])[1]?.trim() ?? "";
    const link = (linkRe.exec(block) ?? [])[1]?.trim() ?? "";
    const pubDate = (dateRe.exec(block) ?? [])[1]?.trim() ?? "";
    if (title && pubDate) items.push({ title, link, pubDate });
  }
  return items;
}

async function fetchRedditRss() {
  const posts = [];
  const query = encodeURIComponent("codex rate limit reset OR codex quota reset OR limits reset early");

  for (const sub of SUBREDDITS) {
    const url = `https://www.reddit.com/r/${sub}/search.rss?q=${query}&sort=new&t=week&restrict_sr=1`;
    try {
      const res = await fetchWithRetry(url, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) {
        console.warn(`Reddit RSS r/${sub}: HTTP ${res.status}`);
        continue;
      }
      const xml = await res.text();
      const items = parseRssItems(xml);
      for (const item of items) {
        const text = item.title.toLowerCase();
        const isRelevant = KEYWORDS.some((kw) => text.includes(kw));
        if (isRelevant) {
          const createdAt = new Date(item.pubDate).toISOString();
          posts.push({
            id: item.link.split("/").findLast((s) => s.length > 0) ?? createdAt,
            createdAt,
            title: item.title,
            url: item.link,
            subreddit: sub,
          });
        }
      }
      console.log(`Reddit RSS r/${sub}: ${items.length} items, ${posts.length} relevant so far.`);
    } catch (err) {
      console.warn(`Reddit RSS r/${sub} failed:`, err.message);
    }
  }

  return posts;
}

async function fetchOpenAIStatus() {
  const incidents = [];
  try {
    const res = await fetchWithRetry("https://status.openai.com/api/v2/summary.json", {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      console.warn(`OpenAI Status: HTTP ${res.status}`);
      return incidents;
    }
    const json = await res.json();
    const relevant = (json?.incidents ?? []).filter((inc) => {
      const updates = inc.incident_updates?.map((u) => u.body).join(" ") ?? "";
      const text = `${inc.name} ${updates}`.toLowerCase();
      return KEYWORDS.some((kw) => text.includes(kw));
    });
    for (const inc of relevant) {
      incidents.push({
        id: `openai-status-${inc.id}`,
        createdAt: inc.created_at,
        title: inc.name,
        url: inc.shortlink ?? "https://status.openai.com",
        isOfficial: true,
      });
    }
    console.log(`OpenAI Status: ${relevant.length} relevant incident(s).`);
  } catch (err) {
    console.warn("OpenAI Status fetch failed:", err.message);
  }
  return incidents;
}

function clusterByWindow(posts) {
  const sorted = [...posts].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const clusters = [];
  for (const post of sorted) {
    const postTime = new Date(post.createdAt).getTime();
    const last = clusters.findLast(() => true);
    if (last && postTime - new Date(last[0].createdAt).getTime() < CLUSTER_WINDOW_MS) {
      last.push(post);
    } else {
      clusters.push([post]);
    }
  }
  return clusters;
}

function buildEvent(cluster) {
  const sorted = [...cluster].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const earliest = sorted[0];
  const isOfficial = cluster.some((p) => p.isOfficial);
  const status = deriveStatus(cluster.length, isOfficial);
  const reportNoun = cluster.length === 1 ? "report" : "reports";
  const subs = [...new Set(cluster.map((p) => p.subreddit).filter(Boolean))];

  const description = isOfficial
    ? earliest.title
    : `${cluster.length} independent ${reportNoun} across r/${subs.join(", r/")} suggest a quota reset occurred around this time.`;

  return {
    id: `auto-${earliest.createdAt.slice(0, 10)}-${earliest.id.slice(0, 6)}`,
    occurredAt: earliest.createdAt,
    // Public rumors carry no reliable scheduled renewal date, so "how early"
    // stays unknown until a report with a scheduled date corroborates it.
    scheduledAt: null,
    daysEarly: null,
    reportedAt: earliest.createdAt,
    status,
    title: isOfficial ? earliest.title : "Quota reset reported by community",
    affectedPlans: ["Unknown"],
    reportCount: cluster.length,
    sourceName: isOfficial ? "OpenAI Status" : `${cluster.length} Reddit ${reportNoun}`,
    sourceUrl: isOfficial ? earliest.url : cluster[0].url,
    description,
  };
}

try {
  console.log("Collecting from Reddit RSS and OpenAI Status…");
  const [redditPosts, officialIncidents] = await Promise.all([
    fetchRedditRss(),
    fetchOpenAIStatus(),
  ]);

  console.log(`Total: ${redditPosts.length} Reddit posts, ${officialIncidents.length} official incidents.`);

  const allPosts = [...redditPosts, ...officialIncidents];
  if (allPosts.length === 0) {
    console.log("Nothing new. Exiting with 0.");
    process.exit(0);
  }

  const clusters = clusterByWindow(allPosts);
  console.log(`Clustered into ${clusters.length} event(s).`);

  const raw = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  let events = raw.events ?? [];
  let added = 0;
  let merged = 0;

  for (const cluster of clusters) {
    const candidate = buildEvent(cluster);
    const result = upsertEvent(events, candidate);
    events = result.events;
    if (result.action === "added") {
      added++;
      console.log(`New event: [${candidate.status}] ${candidate.title} @ ${candidate.occurredAt}`);
    } else {
      merged++;
      console.log(`Merged ${cluster.length} report(s) into an existing event @ ${candidate.occurredAt}`);
    }
  }

  if (added === 0 && merged === 0) {
    console.log("No new or updated events. Exiting with 0.");
    process.exit(0);
  }

  const updated = {
    lastUpdatedAt: new Date().toISOString(),
    events,
  };

  writeFileSync(DATA_PATH, JSON.stringify(updated, null, 2) + "\n", "utf-8");
  console.log(`Wrote changes: ${added} added, ${merged} merged.`);
  process.exit(1);
} catch (err) {
  console.error("Collector failed:", err);
  process.exit(2);
}
