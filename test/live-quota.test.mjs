import assert from "node:assert/strict";
import { test } from "node:test";

import { buildLiveQuotaView, STALE_AFTER_MS } from "../app/lib/live-quota.ts";

const NOW = Date.parse("2026-07-25T12:00:00.000Z");

function snapshot(overrides = {}) {
  return {
    observedAt: "2026-07-25T11:50:00.000Z",
    usedPercent: 31,
    resetAt: "2026-08-01T11:50:00.000Z",
    windowSeconds: 604800,
    resetDetected: false,
    ...overrides,
  };
}

test("live quota view exposes an explicit empty state", () => {
  const view = buildLiveQuotaView([], [], NOW);

  assert.equal(view.state, "empty");
  assert.equal(view.latest, null);
  assert.equal(view.remainingPercent, null);
  assert.deepEqual(view.histories, { 7: [], 30: [], 90: [] });
});

test("live quota view derives remaining percent for a current snapshot", () => {
  const view = buildLiveQuotaView([snapshot()], [], NOW);

  assert.equal(view.state, "current");
  assert.equal(view.remainingPercent, 69);
  assert.equal(view.ageMinutes, 10);
  assert.equal(view.histories[7].length, 1);
});

test("live quota view becomes stale after 30 minutes", () => {
  const observedAt = new Date(NOW - STALE_AFTER_MS - 1).toISOString();
  const view = buildLiveQuotaView([snapshot({ observedAt })], [], NOW);

  assert.equal(view.state, "stale");
  assert.ok(view.ageMinutes > 30);
});

test("live quota history highlights detected resets", () => {
  const resetSnapshot = snapshot({
    observedAt: "2026-07-24T12:00:00.000Z",
    usedPercent: 2,
    resetDetected: true,
  });
  const resetEvent = {
    detectedAt: resetSnapshot.observedAt,
    expectedResetAt: "2026-07-25T12:00:00.000Z",
    newResetAt: resetSnapshot.resetAt,
    hoursEarly: 24,
    previousUsedPercent: 96,
    currentUsedPercent: 2,
  };
  const view = buildLiveQuotaView(
    [snapshot({ observedAt: "2026-07-23T12:00:00.000Z" }), resetSnapshot],
    [resetEvent],
    NOW,
  );

  assert.deepEqual(view.latestReset, resetEvent);
  assert.equal(view.histories[7].at(-1).resetDetected, true);
  assert.equal(view.histories[7].at(-1).remainingPercent, 98);
});
