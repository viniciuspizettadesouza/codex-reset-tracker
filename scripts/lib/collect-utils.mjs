import { deriveStatus } from "./events.mjs";

// Posts within 6h of each other are considered the same event.
export const CLUSTER_WINDOW_MS = 6 * 60 * 60 * 1000;

// Minimal RSS/Atom parser — extracts <item> or <entry> blocks without dependencies.
export function parseRssItems(xml) {
  const items = [];
  const titleRe = /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/;
  const linkRe = /<(?:link|id)[^>]*>(?:<!\[CDATA\[)?(https?[^<\]]+)/;
  const dateRe = /<(?:pubDate|published|updated)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated)>/;
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

export function isRelevantRedditTitle(title, subreddit, qualifiedKeywords) {
  const normalizedTitle = title.toLowerCase();
  return (
    qualifiedKeywords.some((keyword) => normalizedTitle.includes(keyword)) ||
    (subreddit.toLowerCase() === "codex" && /\bresets?\b/i.test(title))
  );
}

export function clusterByWindow(posts) {
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

export function buildEvent(cluster) {
  const sorted = [...cluster].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const earliest = sorted[0];
  const isOfficial = cluster.some((p) => p.isOfficial);
  const status = deriveStatus(cluster.length, isOfficial);
  const noun = cluster.length === 1 ? "report" : "reports";
  const subs = [...new Set(cluster.map((p) => p.subreddit).filter(Boolean))];
  const hasX = cluster.some((p) => p.sourcePlatform === "x");
  const hasReddit = subs.length > 0;

  let sourceName;
  if (isOfficial) sourceName = "OpenAI Status";
  else if (hasX && !hasReddit) sourceName = `${cluster.length} X (Twitter) ${noun}`;
  else if (hasX) sourceName = `${cluster.length} ${noun} (Reddit + X)`;
  else sourceName = `${cluster.length} Reddit ${noun}`;

  const parts = [
    ...(hasReddit ? [`r/${subs.join(", r/")}`] : []),
    ...(hasX ? ["X (Twitter)"] : []),
  ];
  const description = isOfficial
    ? earliest.title
    : `${cluster.length} independent ${noun} across ${parts.join(" and ")} suggest a quota reset occurred around this time.`;

  return {
    id: `auto-${earliest.createdAt.slice(0, 10)}-${earliest.id.slice(0, 6)}`,
    occurredAt: earliest.createdAt,
    scheduledAt: null,
    daysEarly: null,
    reportedAt: earliest.createdAt,
    status,
    title: isOfficial ? earliest.title : "Quota reset reported by community",
    affectedPlans: ["Unknown"],
    reportCount: cluster.length,
    sourceName,
    sourceUrl: isOfficial ? earliest.url : cluster[0].url,
    description,
  };
}
