#!/usr/bin/env node
/**
 * Parses a GitHub issue created via reset-report.yml and folds it into
 * data/resets.json via the shared upsertEvent logic. A report about an
 * already-tracked reset merges in (raising its confidence) instead of
 * creating a duplicate.
 *
 * Required env vars (set by issue-to-event.yml workflow):
 *   ISSUE_BODY      — the raw issue body text
 *   ISSUE_NUMBER    — GitHub issue number
 *   ISSUE_URL       — link to the issue
 *
 * Writes GITHUB_OUTPUT: added=true|false, action=added|merged|rejected
 */

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { upsertEvent, isEarly, computeDaysEarly } from "./lib/events.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "../data/resets.json");
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT ?? "/dev/null";

function setOutput(key, value) {
  appendFileSync(GITHUB_OUTPUT, `${key}=${value}\n`);
}

function parseField(body, label) {
  // GitHub issue forms render as "### Label\n\nvalue"
  const re = new RegExp(String.raw`### ${label}\s*\n+([^#]+)`, "i");
  const match = body.match(re);
  return match ? match[1].trim() : null;
}

function parsePlans(body) {
  const raw = parseField(body, String.raw`Which plan\(s\) were affected\?`);
  if (!raw) return ["Unknown"];
  const valid = ["Free", "Plus", "Pro", "Team", "Enterprise", "Unknown"];
  const found = valid.filter((p) => raw.includes(p));
  return found.length > 0 ? found : ["Unknown"];
}

function parseDate(raw) {
  if (!raw) return null;
  // Accept "YYYY-MM-DD HH:MM", "YYYY-MM-DD", or ISO 8601
  const trimmed = raw.trim();
  const normalized = trimmed.replace(" ", "T");
  const withTime = normalized.includes("T") ? normalized : `${normalized}T00:00`;
  const full =
    withTime.includes("Z") || withTime.includes("+") ? withTime : `${withTime}:00Z`;
  const d = new Date(full);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function main() {
  const body = process.env.ISSUE_BODY ?? "";
  const issueNumber = process.env.ISSUE_NUMBER ?? "0";
  const issueUrl = process.env.ISSUE_URL ?? "";

  const occurredAt = parseDate(
    parseField(body, String.raw`When did the reset occur\? \(UTC\)`),
  );
  if (!occurredAt) {
    console.error("Could not parse occurred_at from issue body.");
    setOutput("added", "false");
    setOutput("action", "rejected");
    process.exit(0);
  }

  const scheduledAt = parseDate(
    parseField(body, String.raw`What renewal date did Codex show\? \(UTC\)`),
  );
  if (!scheduledAt) {
    console.error("Could not parse the scheduled renewal date from issue body.");
    setOutput("added", "false");
    setOutput("action", "rejected");
    process.exit(0);
  }

  // The tracker only records resets that happened BEFORE the scheduled date.
  if (!isEarly(occurredAt, scheduledAt)) {
    console.error(
      `Report is not an early reset (occurred ${occurredAt} >= scheduled ${scheduledAt}). Ignoring.`,
    );
    setOutput("added", "false");
    setOutput("action", "rejected");
    process.exit(0);
  }

  const description = parseField(body, "Description");
  if (!description) {
    console.error("Description field missing.");
    setOutput("added", "false");
    setOutput("action", "rejected");
    process.exit(0);
  }

  const affectedPlans = parsePlans(body);
  const sourceUrl =
    parseField(body, String.raw`Link to evidence \(optional\)`) || issueUrl;

  const candidate = {
    id: `issue-${issueNumber}-${occurredAt.slice(0, 10)}`,
    occurredAt,
    scheduledAt,
    reportedAt: new Date().toISOString(),
    status: "suspected",
    title: "Quota reset reported by community",
    affectedPlans,
    reportCount: 1,
    sourceName: `Community report (#${issueNumber})`,
    sourceUrl,
    description,
    daysEarly: computeDaysEarly(occurredAt, scheduledAt),
  };

  const raw = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  const { events, action } = upsertEvent(raw.events ?? [], candidate);
  raw.events = events;
  raw.lastUpdatedAt = new Date().toISOString();

  writeFileSync(DATA_PATH, JSON.stringify(raw, null, 2) + "\n", "utf-8");
  console.log(`${action === "merged" ? "Merged into" : "Added"} event for issue #${issueNumber}.`);
  setOutput("added", "true");
  setOutput("action", action);
}

main();
