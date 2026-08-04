import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { calculateMonitorHealth, getLocalMonitorStatus } from "../app/lib/local-monitor-status.ts";

const now = Date.parse("2026-08-08T10:00:00.000Z");
const intervalSeconds = 900;

test("health thresholds distinguish healthy, degraded, and offline", () => {
  const base = {
    now,
    intervalSeconds,
    consecutiveFailures: 0,
    pendingCount: 0,
    latestResult: "success",
  };
  assert.equal(
    calculateMonitorHealth({
      ...base,
      lastSuccessAt: new Date(now - intervalSeconds * 1_000 * 1.5).toISOString(),
    }).status,
    "healthy",
  );
  assert.equal(
    calculateMonitorHealth({
      ...base,
      lastSuccessAt: new Date(now - intervalSeconds * 1_000 * 1.5 - 1).toISOString(),
    }).status,
    "degraded",
  );
  assert.equal(
    calculateMonitorHealth({
      ...base,
      lastSuccessAt: new Date(now - intervalSeconds * 1_000 * 2 - 1).toISOString(),
    }).status,
    "offline",
  );
  assert.equal(calculateMonitorHealth({ ...base, lastSuccessAt: null }).status, "offline");
});

test("local status exposes sanitized telemetry without pending payloads", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "local-status-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const statePath = join(directory, "state.json");
  await writeFile(
    statePath,
    JSON.stringify({
      version: 2,
      lastPollAt: "2026-08-08T09:55:00.000Z",
      intervalSeconds,
      windows: { weekly: { usedPercent: 31, resetsAt: "2026-08-15T10:00:00.000Z" } },
      pendingUploads: [{ observedAt: "private-payload", account_id: "must-not-leak" }],
      health: {
        lastAttemptAt: "2026-08-08T09:55:00.000Z",
        lastSuccessAt: "2026-08-08T09:55:01.000Z",
        consecutiveFailures: 0,
        lastDurationMs: 1_000,
      },
      publishing: { configured: true, lastStatus: "failed" },
      history: [
        {
          startedAt: "2026-08-08T09:55:00.000Z",
          completedAt: "2026-08-08T09:55:01.000Z",
          durationMs: 1_000,
          result: "partial",
          usedPercent: 31,
          resetAt: "2026-08-15T10:00:00.000Z",
          resetDetected: false,
          publishStatus: "failed",
          error: "HTTP 500",
        },
      ],
    }),
  );

  const status = await getLocalMonitorStatus({ statePath, now });
  const serialized = JSON.stringify(status);

  assert.equal(status.health.status, "degraded");
  assert.equal(status.quota.remainingPercent, 69);
  assert.equal(status.publishing.pendingCount, 1);
  assert.equal(status.recentErrors[0].message, "HTTP 500");
  assert.doesNotMatch(serialized, /account_id|must-not-leak|private-payload/);
});

test("remote comparison failure does not change otherwise healthy local health", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "local-status-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const statePath = join(directory, "state.json");
  await writeFile(
    statePath,
    JSON.stringify({
      lastPollAt: "2026-08-08T09:55:00.000Z",
      intervalSeconds,
      windows: { weekly: { usedPercent: 20, resetsAt: "2026-08-15T10:00:00.000Z" } },
      pendingUploads: [],
      health: { lastSuccessAt: "2026-08-08T09:55:00.000Z", consecutiveFailures: 0 },
      publishing: { configured: true },
      history: [],
    }),
  );

  const status = await getLocalMonitorStatus({
    statePath,
    remoteUrl: "https://example.invalid/status",
    now,
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });

  assert.equal(status.health.status, "healthy");
  assert.equal(status.publishing.remote.status, "unavailable");
});
