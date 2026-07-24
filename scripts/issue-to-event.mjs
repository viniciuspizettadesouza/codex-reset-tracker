#!/usr/bin/env node
/**
 * Parses a GitHub issue created via reset-report.yml template and appends
 * a new "suspected" event to data/resets.json.
 *
 * Required env vars (set by issue-to-event.yml workflow):
 *   ISSUE_BODY      — the raw issue body text
 *   ISSUE_NUMBER    — GitHub issue number
 *   ISSUE_URL       — link to the issue
 *
 * Writes GITHUB_OUTPUT: added=true|false
 */

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

function parseOccurredAt(raw) {
  if (!raw) return null;
  // Accept "YYYY-MM-DD HH:MM" or ISO 8601
  const normalized = raw.trim().replace(" ", "T");
  const candidate = normalized.includes("T") ? normalized : `${normalized}:00`;
  const full = candidate.includes("Z") || candidate.includes("+") ? candidate : `${candidate}:00Z`;
  const d = new Date(full);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function main() {
  const body = process.env.ISSUE_BODY ?? "";
  const issueNumber = process.env.ISSUE_NUMBER ?? "0";
  const issueUrl = process.env.ISSUE_URL ?? "";

  const occurredAtRaw = parseField(body, String.raw`When did the reset occur\? \(UTC\)`);
  const occurredAt = parseOccurredAt(occurredAtRaw);
  if (!occurredAt) {
    console.error("Could not parse occurred_at from issue body.");
    setOutput("added", "false");
    process.exit(0);
  }

  const description = parseField(body, "Description");
  if (!description) {
    console.error("Description field missing.");
    setOutput("added", "false");
    process.exit(0);
  }

  const affectedPlans = parsePlans(body);
  const sourceUrl = parseField(body, String.raw`Link to evidence \(optional\)`) || issueUrl;

  const newEvent = {
    id: `issue-${issueNumber}-${occurredAt.slice(0, 10)}`,
    occurredAt,
    reportedAt: new Date().toISOString(),
    status: "suspected",
    title: "Quota reset reported by community",
    affectedPlans,
    reportCount: 1,
    sourceName: `Community report (#${issueNumber})`,
    sourceUrl,
    description,
  };

  const raw = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  raw.events.push(newEvent);
  raw.lastUpdatedAt = new Date().toISOString();

  writeFileSync(DATA_PATH, JSON.stringify(raw, null, 2) + "\n", "utf-8");
  console.log(`Added event: ${newEvent.id}`);
  setOutput("added", "true");
}

main();
