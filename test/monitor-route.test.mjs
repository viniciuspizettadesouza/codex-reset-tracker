import assert from "node:assert/strict";
import { test } from "node:test";

import { createMonitorHandler } from "../app/api/monitor/handler.ts";

const INGEST_TOKEN = "test-token-that-is-at-least-32-characters";
const endpoint = "https://quota.example/api/monitor";

function validPayload(overrides = {}) {
  return {
    version: 1,
    observedAt: "2026-07-25T10:00:00.000Z",
    usedPercent: 31,
    resetAt: "2026-08-01T10:00:00.000Z",
    windowSeconds: 604800,
    resetDetected: false,
    ...overrides,
  };
}

function post(payload, token = INGEST_TOKEN) {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

function memoryHandler() {
  const snapshots = new Map();
  const handler = createMonitorHandler({
    getIngestToken: () => INGEST_TOKEN,
    saveSnapshot: async (payload) => {
      if (snapshots.has(payload.observedAt)) return "duplicate";
      snapshots.set(payload.observedAt, payload);
      return "created";
    },
  });
  return { handler, snapshots };
}

test("POST /api/monitor rejects unauthorized requests", async () => {
  const { handler, snapshots } = memoryHandler();
  const response = await handler(post(validPayload(), "wrong-token"));

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(snapshots.size, 0);
});

test("POST /api/monitor rejects invalid and privacy-sensitive fields", async () => {
  const { handler, snapshots } = memoryHandler();
  const response = await handler(
    post({
      ...validPayload(),
      account_id: "must-never-be-accepted",
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Payload fields are invalid",
  });
  assert.equal(snapshots.size, 0);
});

test("POST /api/monitor stores a valid sanitized snapshot", async () => {
  const { handler, snapshots } = memoryHandler();
  const response = await handler(post(validPayload()));

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    status: "created",
    remainingPercent: 69,
  });
  assert.deepEqual([...snapshots.values()], [validPayload()]);
});

test("POST /api/monitor treats a retry as an idempotent duplicate", async () => {
  const { handler, snapshots } = memoryHandler();
  const requestBody = validPayload();

  assert.equal((await handler(post(requestBody))).status, 201);
  const duplicate = await handler(post(requestBody));

  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), {
    status: "duplicate",
    remainingPercent: 69,
  });
  assert.equal(snapshots.size, 1);
});
