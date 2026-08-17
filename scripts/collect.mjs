#!/usr/bin/env node
/**
 * Autonomous event collector — runs via GitHub Actions every 4h.
 * Sources: Reddit RSS + OpenAI Status API + X API v2 (when TWITTER_BEARER_TOKEN is set).
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
import { upsertEvent } from "./lib/events.mjs";
import {
  parseRssItems,
  isRelevantRedditTitle,
  clusterByWindow,
  buildEvent,
  isPublishableCluster,
  reportKey,
  selectUnseenReports,
  assertCollectorUpdate,
} from "./lib/collect-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "../data/resets.json");

const USER_AGENT = "codex-reset-tracker/1.0 (github.com/user/codex-reset-tracker)";
// Broad in r/codex (context is already Codex) plus Codex-qualified phrases for the
// general subreddits. Matched case-insensitively against post titles.
const KEYWORDS = [
  "rate limit reset",
  "rate limits reset",
  "limit reset",
  "limits reset",
  "reset early",
  "reset for all",
  "reset for everyone",
  "quota reset",
  "usage reset",
  "quota refresh",
  "quota restored",
  "quota back",
  "codex is back",
  "codex refreshed",
  "quota replenished",
  "weekly limit reset",
];
// r/codex is where early resets are usually reported first (often within minutes).
const SUBREDDITS = ["codex", "ChatGPT", "OpenAI"];
const GENERAL_REDDIT_QUERY = "codex rate limit reset OR codex quota reset OR limits reset early";

// X accounts whose timelines are always fetched in addition to keyword search.
// Add handles here as new reliable sources are identified.
const X_ACCOUNTS = ["thsottiaux"];

async function fetchWithRetry(url, options, retries = 2, timeoutMs = 10_000) {
  for (let i = 0; i <= retries; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 429 && i < retries) {
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function fetchRedditRss() {
  const posts = [];

  for (const sub of SUBREDDITS) {
    const query = encodeURIComponent(sub === "codex" ? "reset" : GENERAL_REDDIT_QUERY);
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
        const isRelevant = isRelevantRedditTitle(item.title, sub, KEYWORDS);
        if (isRelevant) {
          const createdAt = new Date(item.pubDate).toISOString();
          const sourceId = item.id || item.link || `${createdAt}:${item.title}`;
          posts.push({
            id: sourceId,
            sourceId: `reddit:${sourceId}`,
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
        sourceId: `openai-status:${inc.id}`,
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

// Fetches relevant tweets via the X API v2 recent-search endpoint.
// Skips silently when TWITTER_BEARER_TOKEN is not set — no config, no data.
async function fetchXApi() {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) {
    console.log("X API: TWITTER_BEARER_TOKEN not set; skipping.");
    return [];
  }

  const accountFilter = X_ACCOUNTS.map((a) => `from:${a}`).join(" OR ");
  const keywordFilter = "codex quota reset OR codex limit reset OR codex rate limit reset";
  const query = encodeURIComponent(`(${keywordFilter} OR ${accountFilter}) -is:retweet lang:en`);
  const url =
    "https://api.twitter.com/2/tweets/search/recent" +
    `?query=${query}&max_results=100&tweet.fields=created_at&expansions=author_id&user.fields=username`;

  try {
    const res = await fetchWithRetry(url, {
      headers: { "User-Agent": USER_AGENT, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.warn(`X API: HTTP ${res.status}`);
      return [];
    }
    const json = await res.json();
    const tweets = json?.data ?? [];
    const usersById = Object.fromEntries(
      (json?.includes?.users ?? []).map((u) => [u.id, u.username]),
    );

    const posts = tweets
      .filter((t) => KEYWORDS.some((kw) => t.text.toLowerCase().includes(kw)))
      .map((t) => {
        const username = usersById[t.author_id] ?? "unknown";
        return {
          id: `x-${t.id}`,
          sourceId: `x:${t.id}`,
          createdAt: new Date(t.created_at).toISOString(),
          title: t.text,
          url: `https://x.com/${username}/status/${t.id}`,
          sourcePlatform: "x",
          xAccount: username,
          isOfficial: X_ACCOUNTS.some(
            (account) => account.toLowerCase() === username.toLowerCase(),
          ),
          sourceName: `@${username} on X`,
        };
      });

    console.log(`X API: ${tweets.length} tweets fetched, ${posts.length} relevant.`);
    return posts;
  } catch (err) {
    console.warn("X API fetch failed:", err.message);
    return [];
  }
}

try {
  console.log("Collecting from Reddit RSS, OpenAI Status, and X API…");
  const [redditPosts, officialIncidents, xPosts] = await Promise.all([
    fetchRedditRss(),
    fetchOpenAIStatus(),
    fetchXApi(),
  ]);

  console.log(
    `Total: ${redditPosts.length} Reddit posts, ${officialIncidents.length} official incidents, ${xPosts.length} X posts.`,
  );

  const allPosts = [...redditPosts, ...officialIncidents, ...xPosts];
  if (allPosts.length === 0) {
    console.log("Nothing new. Exiting with 0.");
    process.exit(0);
  }

  const raw = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  const { reports: unseenPosts } = selectUnseenReports(
    allPosts,
    raw.collectedReportIds,
    raw.collectorStartedAt,
  );
  if (unseenPosts.length === 0) {
    console.log("No unseen reports. JSON is unchanged.");
    process.exit(0);
  }

  const clusters = clusterByWindow(unseenPosts);
  const publishableClusters = clusters.filter(isPublishableCluster);
  const deferredCount = clusters.length - publishableClusters.length;
  console.log(
    `Clustered into ${publishableClusters.length} publishable event(s); deferred ${deferredCount} uncorroborated cluster(s).`,
  );

  if (publishableClusters.length === 0) {
    console.log("No corroborated or official event. JSON is unchanged.");
    process.exit(0);
  }

  const collectedReportIds = [
    ...(raw.collectedReportIds ?? []),
    ...publishableClusters.flat().map(reportKey),
  ];

  let events = raw.events ?? [];
  let added = 0;
  let merged = 0;

  for (const cluster of publishableClusters) {
    const candidate = buildEvent(cluster);
    const result = upsertEvent(events, candidate);
    events = result.events;
    if (result.action === "added") {
      added++;
      console.log(`New event: [${candidate.status}] ${candidate.title} @ ${candidate.occurredAt}`);
    } else {
      merged++;
      console.log(
        `Merged ${cluster.length} report(s) into an existing event @ ${candidate.occurredAt}`,
      );
    }
  }

  if (added === 0 && merged === 0) {
    console.log("No new or updated events. Exiting with 0.");
    process.exit(0);
  }

  assertCollectorUpdate(raw.events ?? [], events, raw.collectedReportIds ?? [], collectedReportIds);

  const updated = {
    ...raw,
    lastUpdatedAt: new Date().toISOString(),
    collectedReportIds,
    events,
  };

  writeFileSync(DATA_PATH, JSON.stringify(updated, null, 2) + "\n", "utf-8");
  console.log(`Wrote changes: ${added} added, ${merged} merged.`);
  process.exit(1);
} catch (err) {
  console.error("Collector failed:", err);
  process.exit(2);
}
