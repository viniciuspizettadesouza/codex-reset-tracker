import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  HISTORY_RETENTION_MS,
  appendPollHistory,
  loadMonitorState,
  sanitizeMonitorError,
  saveMonitorState,
} from "../scripts/lib/monitor-state.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");

async function temporaryState(t) {
  const directory = await mkdtemp(join(tmpdir(), "monitor-state-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, path: join(directory, "state.json") };
}

test("legacy state migrates without losing windows or pending uploads", async (t) => {
  const location = await temporaryState(t);
  const legacy = {
    windows: { weekly: { usedPercent: 31, resetsAt: "2026-08-08T10:00:00.000Z" } },
    lastPollAt: "2026-08-01T10:00:00.000Z",
    pendingUploads: [{ observedAt: "2026-08-01T10:00:00.000Z" }],
  };
  await writeFile(location.path, JSON.stringify(legacy));

  const state = loadMonitorState(location.path, Date.parse("2026-08-01T10:01:00.000Z"));

  assert.equal(state.version, 2);
  assert.deepEqual(state.windows, legacy.windows);
  assert.deepEqual(state.pendingUploads, legacy.pendingUploads);
  assert.equal(state.health.lastSuccessAt, legacy.lastPollAt);
});

test("poll history is retained for seven days and bounded", () => {
  const now = Date.parse("2026-08-08T10:00:00.000Z");
  const state = { history: [] };
  appendPollHistory(
    state,
    { completedAt: new Date(now - HISTORY_RETENTION_MS - 1).toISOString() },
    now,
  );
  appendPollHistory(state, { completedAt: new Date(now).toISOString() }, now);
  assert.deepEqual(state.history, [{ completedAt: new Date(now).toISOString() }]);
});

test("state saves atomically with private permissions", async (t) => {
  const location = await temporaryState(t);
  saveMonitorState(location.path, { windows: {}, pendingUploads: [] });

  assert.equal((await stat(location.path)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(location.path, "utf8")).version, 2);
});

test("invalid JSON is preserved before a clean state is returned", async (t) => {
  const location = await temporaryState(t);
  await writeFile(location.path, "{invalid", { mode: 0o644 });
  const now = Date.parse("2026-08-08T10:00:00.000Z");

  const state = loadMonitorState(location.path, now);
  const backup = `${location.path}.corrupt-2026-08-08T10-00-00-000Z`;

  assert.equal(state.version, 2);
  assert.equal(await readFile(backup, "utf8"), "{invalid");
  assert.equal((await stat(backup)).mode & 0o777, 0o600);
});

test("stored errors redact common credential forms", () => {
  const message = sanitizeMonitorError(
    "request failed Bearer secret-token?token=abc access_token=very-secret",
  );
  assert.doesNotMatch(message, /secret-token|token=abc|very-secret/);
  assert.match(message, /redacted/);
});

test("authentication failures are recorded without exposing the auth path", async (t) => {
  const location = await temporaryState(t);
  try {
    await execFileAsync(process.execPath, ["scripts/monitor.mjs"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        CODEX_HOME: location.directory,
        CODEX_MONITOR_STATE: location.path,
        CODEX_INGEST_URL: "",
        CODEX_INGEST_TOKEN: "",
      },
    });
    assert.fail("monitor should fail without auth.json");
  } catch (error) {
    assert.equal(error.code, 2);
  }

  const state = JSON.parse(await readFile(location.path, "utf8"));
  assert.equal(state.health.consecutiveFailures, 1);
  assert.match(state.health.lastError, /Could not read auth\.json at auth\.json/);
  assert.doesNotMatch(JSON.stringify(state), new RegExp(location.directory));
});

test("an unsupported usage payload is recorded as a failed poll", async (t) => {
  const location = await temporaryState(t);
  const fixturePath = join(location.directory, "unsupported.json");
  await writeFile(fixturePath, JSON.stringify({ unexpected: true }));
  try {
    await execFileAsync(process.execPath, ["scripts/monitor.mjs", "--fixture", fixturePath], {
      cwd: projectRoot,
      env: { ...process.env, CODEX_MONITOR_STATE: location.path },
    });
    assert.fail("monitor should reject an unsupported payload");
  } catch (error) {
    assert.equal(error.code, 2);
  }

  const state = JSON.parse(await readFile(location.path, "utf8"));
  assert.equal(state.history.at(-1).result, "failure");
  assert.match(state.history.at(-1).error, /supported weekly quota window/);
});
