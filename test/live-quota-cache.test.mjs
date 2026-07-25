import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LIVE_QUOTA_REVALIDATE_SECONDS,
  withLiveQuotaInvalidation,
} from "../app/lib/live-quota-invalidation.ts";

const payload = {
  version: 1,
  observedAt: "2026-07-25T10:00:00.000Z",
  usedPercent: 31,
  resetAt: "2026-08-01T10:00:00.000Z",
  windowSeconds: 604800,
  resetDetected: false,
};

test("live quota cache has a 15-minute fallback", () => {
  assert.equal(LIVE_QUOTA_REVALIDATE_SECONDS, 900);
});

test("a newly stored snapshot invalidates cached public data", async () => {
  const invalidations = [];
  const save = withLiveQuotaInvalidation(
    async () => "created",
    async () => invalidations.push("live-quota"),
  );

  assert.equal(await save(payload), "created");
  assert.deepEqual(invalidations, ["live-quota"]);
});

test("an idempotent duplicate does not invalidate cached data", async () => {
  let invalidated = false;
  const save = withLiveQuotaInvalidation(
    async () => "duplicate",
    async () => {
      invalidated = true;
    },
  );

  assert.equal(await save(payload), "duplicate");
  assert.equal(invalidated, false);
});

test("cache invalidation failure does not turn a stored snapshot into an upload failure", async () => {
  const originalConsoleError = console.error;
  let logged = "";
  console.error = (message) => {
    logged = message;
  };

  try {
    const save = withLiveQuotaInvalidation(
      async () => "created",
      async () => {
        throw new Error("cache unavailable");
      },
    );

    assert.equal(await save(payload), "created");
    assert.match(logged, /fallback will refresh/);
  } finally {
    console.error = originalConsoleError;
  }
});
