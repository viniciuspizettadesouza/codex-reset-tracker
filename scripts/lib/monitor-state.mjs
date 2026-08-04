import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";

export const MONITOR_STATE_VERSION = 2;
export const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_HISTORY_ENTRIES = 1_000;
const MAX_ERROR_LENGTH = 300;

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function sanitizeMonitorError(error) {
  const raw = error instanceof Error ? error.message : String(error ?? "Unknown monitor error");
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(?:\/[A-Za-z0-9._-]+)+\/auth\.json/g, "auth.json")
    .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(?:access|refresh|id)_token\b\s*[:=]\s*\S+/gi, "token=[redacted]")
    .slice(0, MAX_ERROR_LENGTH);
}

export function createMonitorState() {
  return {
    version: MONITOR_STATE_VERSION,
    windows: {},
    pendingUploads: [],
    lastPollAt: null,
    intervalSeconds: 900,
    health: {
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
      consecutiveFailures: 0,
      lastDurationMs: null,
    },
    publishing: {
      configured: false,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
      lastStatus: "disabled",
      lastPublishedObservedAt: null,
    },
    lastAlert: null,
    history: [],
  };
}

export function normalizeMonitorState(value, now = Date.now()) {
  const source = objectValue(value);
  const base = createMonitorState();
  const health = objectValue(source.health);
  const publishing = objectValue(source.publishing);
  const legacyLastPollAt = stringOrNull(source.lastPollAt);

  const history = Array.isArray(source.history)
    ? source.history.filter((entry) => {
        const completedAt = Date.parse(objectValue(entry).completedAt);
        return Number.isFinite(completedAt) && completedAt >= now - HISTORY_RETENTION_MS;
      })
    : [];

  return {
    ...base,
    version: MONITOR_STATE_VERSION,
    windows: objectValue(source.windows),
    pendingUploads: Array.isArray(source.pendingUploads) ? source.pendingUploads : [],
    lastPollAt: legacyLastPollAt,
    intervalSeconds:
      finiteOrNull(source.intervalSeconds) && source.intervalSeconds > 0
        ? source.intervalSeconds
        : base.intervalSeconds,
    health: {
      lastAttemptAt: stringOrNull(health.lastAttemptAt) ?? legacyLastPollAt,
      lastSuccessAt: stringOrNull(health.lastSuccessAt) ?? legacyLastPollAt,
      lastFailureAt: stringOrNull(health.lastFailureAt),
      lastError: stringOrNull(health.lastError),
      consecutiveFailures: Math.max(0, finiteOrNull(health.consecutiveFailures) ?? 0),
      lastDurationMs: finiteOrNull(health.lastDurationMs),
    },
    publishing: {
      configured: publishing.configured === true,
      lastAttemptAt: stringOrNull(publishing.lastAttemptAt),
      lastSuccessAt: stringOrNull(publishing.lastSuccessAt),
      lastFailureAt: stringOrNull(publishing.lastFailureAt),
      lastError: stringOrNull(publishing.lastError),
      lastStatus: stringOrNull(publishing.lastStatus) ?? "disabled",
      lastPublishedObservedAt: stringOrNull(publishing.lastPublishedObservedAt),
    },
    lastAlert: source.lastAlert && typeof source.lastAlert === "object" ? source.lastAlert : null,
    history: history.slice(-MAX_HISTORY_ENTRIES),
  };
}

function corruptPath(statePath, now) {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  return `${statePath}.corrupt-${stamp}`;
}

function ensureStateDirectory(statePath) {
  const directory = dirname(statePath);
  const existed = existsSync(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!existed || basename(directory) === ".codex-reset-tracker") {
    chmodSync(directory, 0o700);
  }
  return directory;
}

export function loadMonitorState(statePath, now = Date.now()) {
  let raw;
  try {
    raw = readFileSync(statePath, "utf-8");
  } catch (error) {
    if (error?.code === "ENOENT") return createMonitorState();
    throw error;
  }

  try {
    return normalizeMonitorState(JSON.parse(raw), now);
  } catch {
    ensureStateDirectory(statePath);
    const backupPath = corruptPath(statePath, now);
    renameSync(statePath, backupPath);
    chmodSync(backupPath, 0o600);
    console.warn(`Invalid monitor state preserved at ${backupPath}. Starting with a clean state.`);
    return createMonitorState();
  }
}

export function appendPollHistory(state, entry, now = Date.now()) {
  const history = Array.isArray(state.history) ? state.history : [];
  history.push(entry);
  state.history = history
    .filter((item) => Date.parse(item.completedAt) >= now - HISTORY_RETENTION_MS)
    .slice(-MAX_HISTORY_ENTRIES);
}

export function saveMonitorState(statePath, state, now = Date.now()) {
  ensureStateDirectory(statePath);
  const normalized = normalizeMonitorState(state, now);
  const temporaryPath = `${statePath}.tmp-${process.pid}-${now}`;

  try {
    writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, statePath);
    chmodSync(statePath, 0o600);
  } catch (error) {
    try {
      renameSync(temporaryPath, `${temporaryPath}.failed`);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
}
