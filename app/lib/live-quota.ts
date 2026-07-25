export const STALE_AFTER_MS = 30 * 60 * 1000;

const MAX_CHART_POINTS = 180;

export type HistoryRange = 7 | 30 | 90;

export type LiveQuotaSnapshot = {
  observedAt: string;
  usedPercent: number;
  resetAt: string;
  windowSeconds: number;
  resetDetected: boolean;
};

export type LiveResetEvent = {
  detectedAt: string;
  expectedResetAt: string | null;
  newResetAt: string;
  hoursEarly: number | null;
  previousUsedPercent: number;
  currentUsedPercent: number;
};

export type LiveQuotaData = {
  status: "ready" | "unconfigured" | "unavailable";
  snapshots: LiveQuotaSnapshot[];
  resetEvents: LiveResetEvent[];
};

export type ChartPoint = {
  observedAt: string;
  remainingPercent: number;
  resetDetected: boolean;
};

export type LiveQuotaView = {
  state: "empty" | "current" | "stale";
  latest: LiveQuotaSnapshot | null;
  latestReset: LiveResetEvent | null;
  remainingPercent: number | null;
  ageMinutes: number | null;
  histories: Record<HistoryRange, ChartPoint[]>;
};

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildHistory(
  snapshots: LiveQuotaSnapshot[],
  rangeDays: HistoryRange,
  now: number,
): ChartPoint[] {
  const cutoff = now - rangeDays * 24 * 60 * 60 * 1000;
  const filtered = snapshots.filter((snapshot) => Date.parse(snapshot.observedAt) >= cutoff);
  if (filtered.length <= MAX_CHART_POINTS) {
    return filtered.map((snapshot) => ({
      observedAt: snapshot.observedAt,
      remainingPercent: roundPercent(100 - snapshot.usedPercent),
      resetDetected: snapshot.resetDetected,
    }));
  }

  const stride = Math.ceil(filtered.length / MAX_CHART_POINTS);
  return filtered
    .filter(
      (snapshot, index) =>
        index === 0 ||
        index === filtered.length - 1 ||
        snapshot.resetDetected ||
        index % stride === 0,
    )
    .map((snapshot) => ({
      observedAt: snapshot.observedAt,
      remainingPercent: roundPercent(100 - snapshot.usedPercent),
      resetDetected: snapshot.resetDetected,
    }));
}

export function buildLiveQuotaView(
  snapshots: LiveQuotaSnapshot[],
  resetEvents: LiveResetEvent[],
  now = Date.now(),
): LiveQuotaView {
  const sortedSnapshots = [...snapshots].sort(
    (a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt),
  );
  const sortedResets = [...resetEvents].sort(
    (a, b) => Date.parse(a.detectedAt) - Date.parse(b.detectedAt),
  );
  const latest = sortedSnapshots.at(-1) ?? null;
  const latestReset = sortedResets.at(-1) ?? null;
  const ageMinutes = latest ? Math.max(0, (now - Date.parse(latest.observedAt)) / 60_000) : null;

  return {
    state:
      latest === null
        ? "empty"
        : ageMinutes !== null && ageMinutes > STALE_AFTER_MS / 60_000
          ? "stale"
          : "current",
    latest,
    latestReset,
    remainingPercent: latest ? roundPercent(100 - latest.usedPercent) : null,
    ageMinutes,
    histories: {
      7: buildHistory(sortedSnapshots, 7, now),
      30: buildHistory(sortedSnapshots, 30, now),
      90: buildHistory(sortedSnapshots, 90, now),
    },
  };
}
