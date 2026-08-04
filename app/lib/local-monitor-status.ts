import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type MonitorHealthStatus = "healthy" | "degraded" | "offline";
export type PollResult = "success" | "partial" | "failure";

export type LocalPollHistory = {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  result: PollResult;
  usedPercent: number | null;
  resetAt: string | null;
  resetDetected: boolean;
  publishStatus: string;
  error: string | null;
};

export type LocalMonitorStatus = {
  generatedAt: string;
  health: {
    status: MonitorHealthStatus;
    intervalSeconds: number;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    lastError: string | null;
    lastDurationMs: number | null;
    ageSeconds: number | null;
    consecutiveFailures: number;
    successRate: number | null;
  };
  quota: {
    observedAt: string;
    usedPercent: number;
    remainingPercent: number;
    resetAt: string;
  } | null;
  publishing: {
    configured: boolean;
    pendingCount: number;
    lastStatus: string;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    lastError: string | null;
    lastPublishedObservedAt: string | null;
    remote: {
      status: "disabled" | "synced" | "lagging" | "ahead" | "unavailable";
      observedAt: string | null;
    };
  };
  lastAlert: {
    at: string;
    title: string;
    desktop: string;
    webhook: string;
  } | null;
  history: LocalPollHistory[];
  recentErrors: Array<{ at: string; result: PollResult; message: string }>;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percent(value: number): number {
  return Math.round(value * 100) / 100;
}

function pollEntry(value: unknown): LocalPollHistory | null {
  const item = record(value);
  const startedAt = text(item.startedAt);
  const completedAt = text(item.completedAt);
  const durationMs = number(item.durationMs);
  const result = item.result;
  if (
    !startedAt ||
    !completedAt ||
    durationMs === null ||
    !["success", "partial", "failure"].includes(String(result))
  ) {
    return null;
  }

  return {
    startedAt,
    completedAt,
    durationMs,
    result: result as PollResult,
    usedPercent: number(item.usedPercent),
    resetAt: text(item.resetAt),
    resetDetected: item.resetDetected === true,
    publishStatus: text(item.publishStatus) ?? "unknown",
    error: text(item.error),
  };
}

export function calculateMonitorHealth({
  now,
  intervalSeconds,
  lastSuccessAt,
  consecutiveFailures,
  pendingCount,
  latestResult,
}: {
  now: number;
  intervalSeconds: number;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  pendingCount: number;
  latestResult: PollResult | null;
}): { status: MonitorHealthStatus; ageSeconds: number | null } {
  const successTimestamp = lastSuccessAt ? Date.parse(lastSuccessAt) : Number.NaN;
  if (!Number.isFinite(successTimestamp)) return { status: "offline", ageSeconds: null };

  const ageSeconds = Math.max(0, (now - successTimestamp) / 1_000);
  if (ageSeconds > intervalSeconds * 2) return { status: "offline", ageSeconds };
  if (
    ageSeconds > intervalSeconds * 1.5 ||
    consecutiveFailures > 0 ||
    pendingCount > 0 ||
    latestResult === "partial" ||
    latestResult === "failure"
  ) {
    return { status: "degraded", ageSeconds };
  }
  return { status: "healthy", ageSeconds };
}

async function remoteComparison(
  remoteUrl: string | undefined,
  localObservedAt: string | null,
  fetchImpl: typeof fetch,
): Promise<LocalMonitorStatus["publishing"]["remote"]> {
  if (!remoteUrl) return { status: "disabled", observedAt: null };

  try {
    const endpoint = new URL(remoteUrl);
    if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("Unsupported protocol");
    const response = await fetchImpl(endpoint, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`Remote status returned HTTP ${response.status}`);
    const payload = record(await response.json());
    const latest = record(payload.latest);
    const observedAt = text(latest.observedAt);
    if (!observedAt || !Number.isFinite(Date.parse(observedAt))) {
      return { status: "unavailable", observedAt: null };
    }
    if (!localObservedAt || !Number.isFinite(Date.parse(localObservedAt))) {
      return { status: "ahead", observedAt };
    }
    const difference = Date.parse(observedAt) - Date.parse(localObservedAt);
    return {
      status: difference === 0 ? "synced" : difference < 0 ? "lagging" : "ahead",
      observedAt,
    };
  } catch {
    return { status: "unavailable", observedAt: null };
  }
}

export async function getLocalMonitorStatus({
  statePath = process.env.CODEX_MONITOR_STATE ??
    join(/* turbopackIgnore: true */ homedir(), ".codex-reset-tracker", "monitor-state.json"),
  remoteUrl = process.env.CODEX_REMOTE_STATUS_URL,
  now = Date.now(),
  fetchImpl = fetch,
}: {
  statePath?: string;
  remoteUrl?: string;
  now?: number;
  fetchImpl?: typeof fetch;
} = {}): Promise<LocalMonitorStatus> {
  let state: UnknownRecord = {};
  try {
    state = record(JSON.parse(await readFile(/* turbopackIgnore: true */ statePath, "utf-8")));
  } catch {
    // A missing or temporarily replaced state file is represented as offline.
  }

  const healthState = record(state.health);
  const publishingState = record(state.publishing);
  const weekly = record(record(state.windows).weekly);
  const history = (Array.isArray(state.history) ? state.history : [])
    .map(pollEntry)
    .filter((entry): entry is LocalPollHistory => entry !== null)
    .slice(-1_000);
  const pendingCount = Array.isArray(state.pendingUploads) ? state.pendingUploads.length : 0;
  const intervalSeconds = number(state.intervalSeconds) ?? 900;
  const legacyLastPollAt = text(state.lastPollAt);
  const lastSuccessAt = text(healthState.lastSuccessAt) ?? legacyLastPollAt;
  const consecutiveFailures = Math.max(0, number(healthState.consecutiveFailures) ?? 0);
  const latestResult = history.at(-1)?.result ?? null;
  const health = calculateMonitorHealth({
    now,
    intervalSeconds,
    lastSuccessAt,
    consecutiveFailures,
    pendingCount,
    latestResult,
  });
  const successfulPolls = history.filter((entry) => entry.result !== "failure").length;
  const usedPercent = number(weekly.usedPercent);
  const resetAt = text(weekly.resetsAt);
  const observedAt = legacyLastPollAt;
  const quota =
    usedPercent !== null && resetAt && observedAt
      ? {
          observedAt,
          usedPercent,
          remainingPercent: percent(100 - usedPercent),
          resetAt,
        }
      : null;
  const lastAlertState = record(state.lastAlert);
  const alertAt = text(lastAlertState.at);
  const alertTitle = text(lastAlertState.title);
  const lastAlert =
    alertAt && alertTitle
      ? {
          at: alertAt,
          title: alertTitle,
          desktop: text(lastAlertState.desktop) ?? "unknown",
          webhook: text(lastAlertState.webhook) ?? "unknown",
        }
      : null;

  return {
    generatedAt: new Date(now).toISOString(),
    health: {
      status: health.status,
      intervalSeconds,
      lastAttemptAt: text(healthState.lastAttemptAt) ?? legacyLastPollAt,
      lastSuccessAt,
      lastFailureAt: text(healthState.lastFailureAt),
      lastError: text(healthState.lastError),
      lastDurationMs: number(healthState.lastDurationMs),
      ageSeconds: health.ageSeconds,
      consecutiveFailures,
      successRate: history.length > 0 ? percent((successfulPolls / history.length) * 100) : null,
    },
    quota,
    publishing: {
      configured: publishingState.configured === true,
      pendingCount,
      lastStatus: text(publishingState.lastStatus) ?? "disabled",
      lastSuccessAt: text(publishingState.lastSuccessAt),
      lastFailureAt: text(publishingState.lastFailureAt),
      lastError: text(publishingState.lastError),
      lastPublishedObservedAt: text(publishingState.lastPublishedObservedAt),
      remote: await remoteComparison(remoteUrl, observedAt, fetchImpl),
    },
    lastAlert,
    history,
    recentErrors: history
      .filter((entry) => entry.error)
      .slice(-8)
      .reverse()
      .map((entry) => ({
        at: entry.completedAt,
        result: entry.result,
        message: entry.error as string,
      })),
  };
}
