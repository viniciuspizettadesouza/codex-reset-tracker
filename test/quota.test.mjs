import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseUsage,
  extractWindow,
  detectResetForWindow,
  detectResets,
} from "../scripts/lib/quota.mjs";

const NOW = Date.parse("2026-07-24T12:00:00Z");

test("parseUsage handles the primary/secondary shape", () => {
  const w = parseUsage(
    {
      primary: { used_percent: 40, window_minutes: 300, resets_in_seconds: 3600 },
      secondary: { used_percent: 96, window_minutes: 10080, resets_in_seconds: 259200 },
    },
    NOW,
  );
  assert.equal(w.weekly.usedPercent, 96);
  assert.equal(w.weekly.resetsAt, "2026-07-27T12:00:00.000Z");
  assert.equal(w["5h"].usedPercent, 40);
});

test("parseUsage handles an array of windows", () => {
  const w = parseUsage(
    { windows: [{ used_percent: 10, window_minutes: 10080, resets_at: "2026-08-01T00:00:00Z" }] },
    NOW,
  );
  assert.equal(w.weekly.usedPercent, 10);
  assert.equal(w.weekly.resetsAt, "2026-08-01T00:00:00Z");
});

test("extractWindow prefers absolute reset over relative", () => {
  const win = extractWindow(
    { used_percent: 5, resets_at: "2026-08-01T00:00:00Z", resets_in_seconds: 999 },
    NOW,
  );
  assert.equal(win.resetsAt, "2026-08-01T00:00:00Z");
});

test("detects an early refill with hours-early", () => {
  const ev = detectResetForWindow(
    { usedPercent: 96, resetsAt: "2026-07-27T12:00:00Z" },
    { usedPercent: 2, resetsAt: "2026-08-03T12:00:00Z" },
    { now: Date.parse("2026-07-26T12:00:00Z") },
  );
  assert.equal(ev.refilled, true);
  assert.equal(ev.early, true);
  assert.equal(ev.hoursEarly, 24);
});

test("ignores small jitter in the reset time (no false positive)", () => {
  const ev = detectResetForWindow(
    { usedPercent: 30, resetsAt: "2026-08-02T12:00:00Z" },
    { usedPercent: 31, resetsAt: "2026-08-02T11:55:00Z" },
    { now: NOW },
  );
  assert.equal(ev, null);
});

test("flags a reset time pulled forward without a refill (heads-up)", () => {
  const ev = detectResetForWindow(
    { usedPercent: 80, resetsAt: "2026-07-30T12:00:00Z" },
    { usedPercent: 80, resetsAt: "2026-07-28T12:00:00Z" },
    { now: NOW },
  );
  assert.equal(ev.refilled, false);
  assert.equal(ev.resetMovedEarlier, true);
  assert.equal(ev.newResetAt, "2026-07-28T12:00:00Z");
});

test("no previous snapshot yields no event (baseline poll)", () => {
  assert.equal(detectResetForWindow(undefined, { usedPercent: 10 }, { now: NOW }), null);
});

test("detectResets runs across all windows", () => {
  const prev = {
    weekly: { usedPercent: 96, resetsAt: "2026-07-27T12:00:00Z" },
    "5h": { usedPercent: 90, resetsAt: "2026-07-24T13:00:00Z" },
  };
  const curr = {
    weekly: { usedPercent: 3, resetsAt: "2026-08-03T12:00:00Z" },
    "5h": { usedPercent: 88, resetsAt: "2026-07-24T13:30:00Z" },
  };
  const events = detectResets(prev, curr, { now: Date.parse("2026-07-26T12:00:00Z") });
  assert.equal(events.length, 1);
  assert.equal(events[0].window, "weekly");
});
