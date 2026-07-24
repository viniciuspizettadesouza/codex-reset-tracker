import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRssItems, clusterByWindow, buildEvent, CLUSTER_WINDOW_MS } from "../scripts/lib/collect-utils.mjs";

// ── parseRssItems ────────────────────────────────────────────────────────────

test("parseRssItems parses a standard RSS <item>", () => {
  const xml = `
    <rss><channel>
      <item>
        <title>Codex quota reset early for all plans</title>
        <link>https://reddit.com/r/codex/comments/abc123/</link>
        <pubDate>Thu, 24 Jul 2026 14:00:00 +0000</pubDate>
      </item>
    </channel></rss>`;
  const items = parseRssItems(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Codex quota reset early for all plans");
  assert.equal(items[0].link, "https://reddit.com/r/codex/comments/abc123/");
  assert.equal(items[0].pubDate, "Thu, 24 Jul 2026 14:00:00 +0000");
});

test("parseRssItems parses an Atom <entry> with CDATA title", () => {
  const xml = `
    <feed>
      <entry>
        <title><![CDATA[Codex limit reset early]]></title>
        <id>https://reddit.com/r/ChatGPT/comments/xyz/</id>
        <published>2026-07-24T10:00:00+00:00</published>
      </entry>
    </feed>`;
  const items = parseRssItems(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Codex limit reset early");
  assert.equal(items[0].pubDate, "2026-07-24T10:00:00+00:00");
});

test("parseRssItems skips items missing title or date", () => {
  const xml = `
    <rss><channel>
      <item>
        <link>https://example.com/no-title</link>
        <pubDate>Thu, 24 Jul 2026 14:00:00 +0000</pubDate>
      </item>
      <item>
        <title>No date item</title>
        <link>https://example.com/no-date</link>
      </item>
      <item>
        <title>Valid item</title>
        <pubDate>Thu, 24 Jul 2026 15:00:00 +0000</pubDate>
      </item>
    </channel></rss>`;
  const items = parseRssItems(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Valid item");
});

test("parseRssItems returns multiple items in document order", () => {
  const xml = `
    <rss><channel>
      <item><title>First</title><pubDate>Thu, 24 Jul 2026 10:00:00 +0000</pubDate></item>
      <item><title>Second</title><pubDate>Thu, 24 Jul 2026 11:00:00 +0000</pubDate></item>
    </channel></rss>`;
  const items = parseRssItems(xml);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "First");
  assert.equal(items[1].title, "Second");
});

// ── clusterByWindow ──────────────────────────────────────────────────────────

function post(id, isoDate) {
  return { id, createdAt: isoDate, title: `Post ${id}` };
}

const T0 = "2026-07-24T10:00:00.000Z";
const T1H = "2026-07-24T11:00:00.000Z"; // +1h
const T7H = "2026-07-24T17:00:00.000Z"; // +7h — beyond 6h window

test("clusterByWindow merges two posts within 6h into one cluster", () => {
  const clusters = clusterByWindow([post("a", T0), post("b", T1H)]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].length, 2);
});

test("clusterByWindow splits posts more than 6h apart into separate clusters", () => {
  const clusters = clusterByWindow([post("a", T0), post("b", T7H)]);
  assert.equal(clusters.length, 2);
});

test("clusterByWindow sorts out-of-order posts before clustering", () => {
  // b is earlier but listed second — should still merge with a
  const clusters = clusterByWindow([post("a", T1H), post("b", T0)]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0][0].id, "b"); // earliest first after sort
});

test("clusterByWindow handles an empty array", () => {
  assert.deepEqual(clusterByWindow([]), []);
});

test("clusterByWindow chains: first+second close, third far → two clusters", () => {
  const clusters = clusterByWindow([post("a", T0), post("b", T1H), post("c", T7H)]);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].length, 2);
  assert.equal(clusters[1].length, 1);
});

test("clusterByWindow uses window edge: exactly CLUSTER_WINDOW_MS apart stays separate", () => {
  const t2 = new Date(new Date(T0).getTime() + CLUSTER_WINDOW_MS).toISOString();
  const clusters = clusterByWindow([post("a", T0), post("b", t2)]);
  assert.equal(clusters.length, 2);
});

// ── buildEvent ───────────────────────────────────────────────────────────────

function redditPost(id, isoDate, subreddit = "codex") {
  return { id, createdAt: isoDate, title: `Post ${id}`, url: `https://reddit.com/${id}`, subreddit };
}

test("buildEvent with a single Reddit post produces a suspected event", () => {
  const ev = buildEvent([redditPost("abc", T0)]);
  assert.equal(ev.status, "suspected");
  assert.equal(ev.reportCount, 1);
  assert.equal(ev.sourceName, "1 Reddit report");
  assert.equal(ev.occurredAt, T0);
  assert.equal(ev.affectedPlans[0], "Unknown");
  assert.equal(ev.scheduledAt, null);
});

test("buildEvent with 3 Reddit posts produces a community event", () => {
  const cluster = [redditPost("a", T0), redditPost("b", T1H), redditPost("c", T1H)];
  const ev = buildEvent(cluster);
  assert.equal(ev.status, "community");
  assert.equal(ev.reportCount, 3);
  assert.equal(ev.sourceName, "3 Reddit reports");
});

test("buildEvent with an official post produces an official event", () => {
  const official = { id: "openai-status-1", createdAt: T0, title: "Codex quota reset", url: "https://status.openai.com", isOfficial: true };
  const ev = buildEvent([official]);
  assert.equal(ev.status, "official");
  assert.equal(ev.sourceName, "OpenAI Status");
  assert.equal(ev.title, "Codex quota reset");
});

test("buildEvent with Reddit + X posts reflects mixed source in sourceName", () => {
  const xPost = { id: "x-123", createdAt: T1H, title: "tweet", url: "https://x.com/user/123", sourcePlatform: "x" };
  const ev = buildEvent([redditPost("a", T0), xPost]);
  assert.match(ev.sourceName, /Reddit \+ X/);
});

test("buildEvent id uses the earliest post date", () => {
  const cluster = [redditPost("late", T1H), redditPost("early", T0)];
  const ev = buildEvent(cluster);
  assert.ok(ev.id.startsWith(`auto-${T0.slice(0, 10)}`));
});
