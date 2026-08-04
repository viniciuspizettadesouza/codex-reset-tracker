import assert from "node:assert/strict";
import { test } from "node:test";

import { createLocalStatusHandler } from "../app/api/local/status/handler.ts";

test("local status API returns 404 unless explicitly enabled", async () => {
  const GET = createLocalStatusHandler({
    isEnabled: () => false,
    getStatus: async () => assert.fail("disabled route must not read local state"),
  });
  const response = await GET();
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Not found" });
});

test("enabled local status API disables caching", async () => {
  const status = { health: { status: "healthy" } };
  const GET = createLocalStatusHandler({
    isEnabled: () => true,
    getStatus: async () => status,
  });
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), status);
});
