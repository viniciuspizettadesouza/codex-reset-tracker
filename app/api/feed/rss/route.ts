import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

type Plan = string;

type ResetEvent = {
  id: string;
  occurredAt: string;
  daysEarly?: number | null;
  title: string;
  affectedPlans: Plan[];
  description: string;
};

type ResetData = {
  lastUpdatedAt: string;
  events: ResetEvent[];
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function GET() {
  const filePath = join(process.cwd(), "data", "resets.json");
  const raw = readFileSync(filePath, "utf-8");
  const data: ResetData = JSON.parse(raw);

  const events = [...data.events].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  const items = events
    .map((event) => {
      const descParts = [event.description];
      if (event.affectedPlans.length > 0) {
        descParts.push(`Plans: ${event.affectedPlans.join(", ")}.`);
      }
      if (typeof event.daysEarly === "number") {
        const rounded = Math.round(event.daysEarly * 10) / 10;
        descParts.push(`Reset occurred ${rounded} ${rounded === 1 ? "day" : "days"} early.`);
      }
      return `    <item>
      <title>${escapeXml(event.title)}</title>
      <pubDate>${new Date(event.occurredAt).toUTCString()}</pubDate>
      <description>${escapeXml(descParts.join(" "))}</description>
      <guid isPermaLink="false">${escapeXml(event.id)}</guid>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Codex Reset Tracker</title>
    <description>Community-driven tracker of Codex quota resets.</description>
    <lastBuildDate>${new Date(data.lastUpdatedAt).toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new NextResponse(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
