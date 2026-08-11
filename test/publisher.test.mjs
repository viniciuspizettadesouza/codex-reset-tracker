import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

import {
  buildMonitorPayload,
  drainPendingUploads,
  formatQuota,
  publishQuotaSnapshot,
} from "../scripts/lib/publisher.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");

const weekly = {
  usedPercent: 31,
  resetsAt: "2026-08-01T10:00:00.000Z",
  windowMinutes: 10080,
};
const observedAt = "2026-07-25T10:00:00.000Z";

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}/api/monitor`,
  };
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return JSON.parse(body);
}

test("buildMonitorPayload allow-lists a normal weekly snapshot", () => {
  assert.deepEqual(buildMonitorPayload(weekly, null, observedAt), {
    version: 1,
    observedAt,
    usedPercent: 31,
    resetAt: "2026-08-01T10:00:00.000Z",
    windowSeconds: 604800,
    resetDetected: false,
  });
  assert.equal(formatQuota(31), "69% remaining (31% used)");
});

test("buildMonitorPayload includes only sanitized refill metadata", () => {
  const payload = buildMonitorPayload(
    { ...weekly, usedPercent: 2 },
    {
      refilled: true,
      expectedResetAt: "2026-07-26T10:00:00.000Z",
      hoursEarly: 24,
      prevPercent: 96,
    },
    observedAt,
  );

  assert.deepEqual(payload.resetEvent, {
    detectedAt: observedAt,
    expectedResetAt: "2026-07-26T10:00:00.000Z",
    newResetAt: "2026-08-01T10:00:00.000Z",
    hoursEarly: 24,
    previousUsedPercent: 96,
    currentUsedPercent: 2,
  });
  assert.deepEqual(Object.keys(payload).sort(), [
    "observedAt",
    "resetAt",
    "resetDetected",
    "resetEvent",
    "usedPercent",
    "version",
    "windowSeconds",
  ]);
});

test("buildMonitorPayload records zero hours early for a late refill", () => {
  const payload = buildMonitorPayload(
    { ...weekly, usedPercent: 0 },
    {
      refilled: true,
      expectedResetAt: "2026-07-24T10:00:00.000Z",
      hoursEarly: null,
      prevPercent: 100,
    },
    observedAt,
  );

  assert.equal(payload.resetEvent.hoursEarly, 0);
});

test("publishQuotaSnapshot repairs legacy queued reset metadata", async () => {
  let postedPayload;
  const payload = buildMonitorPayload(
    { ...weekly, usedPercent: 0 },
    {
      refilled: true,
      expectedResetAt: "2026-07-24T10:00:00.000Z",
      prevPercent: 100,
    },
    observedAt,
  );
  payload.resetEvent.hoursEarly = null;

  const result = await publishQuotaSnapshot({
    url: "https://quota.example/api/monitor",
    token: "private-token",
    payload,
    fetchImpl: async (_url, options) => {
      postedPayload = JSON.parse(options.body);
      return new Response(null, { status: 201 });
    },
  });

  assert.equal(postedPayload.resetEvent.hoursEarly, 0);
  assert.deepEqual(result, { status: "created" });
});

test("publishQuotaSnapshot stays disabled unless both settings exist", async () => {
  let called = false;
  const result = await publishQuotaSnapshot({
    url: "https://quota.example/api/monitor",
    token: "",
    payload: buildMonitorPayload(weekly, null, observedAt),
    fetchImpl: async () => {
      called = true;
    },
  });

  assert.deepEqual(result, { status: "disabled" });
  assert.equal(called, false);
});

test("publishQuotaSnapshot surfaces transport timeouts without leaking response data", async () => {
  await assert.rejects(
    publishQuotaSnapshot({
      url: "https://quota.example/api/monitor",
      token: "private-token",
      payload: buildMonitorPayload(weekly, null, observedAt),
      fetchImpl: async () => {
        throw new DOMException("The operation timed out", "TimeoutError");
      },
    }),
    (error) => error.name === "TimeoutError" && !error.message.includes("private-token"),
  );
});

test("pending uploads stay ordered after a failure and drain on retry", async () => {
  const pendingUploads = [
    buildMonitorPayload(weekly, null, observedAt),
    buildMonitorPayload(weekly, null, "2026-07-25T10:15:00.000Z"),
  ];
  let shouldFail = true;
  const attempts = [];
  const publish = async (payload) => {
    attempts.push(payload.observedAt);
    if (shouldFail) throw new Error("temporary upload failure");
    return { status: "created" };
  };

  const failed = await drainPendingUploads({ pendingUploads, publish });
  assert.match(failed.error.message, /temporary upload failure/);
  assert.equal(failed.published.length, 0);
  assert.equal(pendingUploads.length, 2);

  shouldFail = false;
  const retried = await drainPendingUploads({ pendingUploads, publish });
  assert.equal(retried.error, null);
  assert.deepEqual(
    retried.published.map(({ payload }) => payload.observedAt),
    [observedAt, "2026-07-25T10:15:00.000Z"],
  );
  assert.deepEqual(pendingUploads, []);
  assert.deepEqual(attempts, [observedAt, observedAt, "2026-07-25T10:15:00.000Z"]);
});

test(
  "monitor preserves local detection after upload failure and retries next poll",
  { skip: process.env.RUN_NETWORK_TESTS !== "1" },
  async (t) => {
    const requests = [];
    const { server, url } = await listen(async (request, response) => {
      requests.push({
        authorization: request.headers.authorization,
        body: await readJson(request),
      });
      response.writeHead(requests.length === 1 ? 500 : 201, {
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify({ status: requests.length === 1 ? "error" : "created" }));
    });
    t.after(() => new Promise((resolveClose) => server.close(resolveClose)));

    const tempDirectory = await mkdtemp(join(tmpdir(), "quota-publisher-"));
    t.after(() => rm(tempDirectory, { recursive: true, force: true }));
    const statePath = join(tempDirectory, "monitor-state.json");
    const token = "publisher-test-token";
    const env = {
      ...process.env,
      CODEX_INGEST_URL: url,
      CODEX_INGEST_TOKEN: token,
      CODEX_MONITOR_STATE: statePath,
      CODEX_WEBHOOK_URL: "",
    };

    const first = await execFileAsync(
      process.execPath,
      ["scripts/monitor.mjs", "--fixture", "scripts/fixtures/usage-weekly-low.json"],
      { cwd: projectRoot, env },
    );
    const stateAfterFailure = JSON.parse(await readFile(statePath, "utf8"));

    assert.match(first.stdout, /4% remaining \(96% used\)/);
    assert.match(first.stderr, /upload failed; local monitoring remains active/);
    assert.equal(stateAfterFailure.windows.weekly.usedPercent, 96);

    const second = await execFileAsync(
      process.execPath,
      ["scripts/monitor.mjs", "--fixture", "scripts/fixtures/usage-weekly-reset.json"],
      { cwd: projectRoot, env },
    );
    const stateAfterRetry = JSON.parse(await readFile(statePath, "utf8"));

    assert.match(second.stdout, /reset EARLY/);
    assert.match(second.stdout, /98% remaining \(2% used\)/);
    assert.match(second.stdout, /Published weekly snapshot \(created\)/);
    assert.equal(stateAfterRetry.windows.weekly.usedPercent, 2);
    assert.equal(requests.length, 3);
    assert.equal(requests[0].authorization, `Bearer ${token}`);
    assert.equal(requests[0].body.resetDetected, false);
    assert.deepEqual(requests[1].body, requests[0].body);
    assert.equal(requests[2].body.resetDetected, true);
    assert.equal(requests[2].body.resetEvent.previousUsedPercent, 96);
    assert.equal(requests[2].body.resetEvent.currentUsedPercent, 2);
    assert.deepEqual(stateAfterRetry.pendingUploads, []);
  },
);
