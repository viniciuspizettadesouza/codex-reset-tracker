const WEEKLY_WINDOW_MIN_SECONDS = 6 * 24 * 60 * 60;
const WEEKLY_WINDOW_MAX_SECONDS = 8 * 24 * 60 * 60;
const DEFAULT_TIMEOUT_MS = 10_000;

function roundedPercent(value) {
  return Math.round(value * 100) / 100;
}

function normalizeResetHoursEarly(payload) {
  const resetEvent = payload?.resetEvent;
  if (!resetEvent) return payload;

  const detectedTimestamp = Date.parse(resetEvent.detectedAt);
  const expectedTimestamp = Date.parse(resetEvent.expectedResetAt ?? "");
  const hoursEarly =
    Number.isFinite(expectedTimestamp) && Number.isFinite(detectedTimestamp)
      ? Math.max(0, (expectedTimestamp - detectedTimestamp) / 3_600_000)
      : null;

  return {
    ...payload,
    resetEvent: {
      ...resetEvent,
      hoursEarly,
    },
  };
}

export function formatQuota(usedPercent) {
  return `${roundedPercent(100 - usedPercent)}% remaining (${usedPercent}% used)`;
}

export function buildMonitorPayload(weekly, reset, observedAt) {
  const observedTimestamp = Date.parse(observedAt);
  const resetTimestamp = Date.parse(weekly?.resetsAt);
  if (
    !weekly ||
    typeof weekly.usedPercent !== "number" ||
    !Number.isFinite(weekly.usedPercent) ||
    weekly.usedPercent < 0 ||
    weekly.usedPercent > 100 ||
    typeof weekly.resetsAt !== "string" ||
    !Number.isFinite(observedTimestamp) ||
    !Number.isFinite(resetTimestamp) ||
    resetTimestamp <= observedTimestamp ||
    typeof weekly.windowMinutes !== "number"
  ) {
    return null;
  }

  const windowSeconds = Math.round(weekly.windowMinutes * 60);
  if (windowSeconds < WEEKLY_WINDOW_MIN_SECONDS || windowSeconds > WEEKLY_WINDOW_MAX_SECONDS) {
    return null;
  }

  const payload = {
    version: 1,
    observedAt,
    usedPercent: weekly.usedPercent,
    resetAt: new Date(weekly.resetsAt).toISOString(),
    windowSeconds,
    resetDetected: Boolean(reset?.refilled),
  };

  if (reset?.refilled) {
    payload.resetEvent = {
      detectedAt: observedAt,
      expectedResetAt: reset.expectedResetAt ? new Date(reset.expectedResetAt).toISOString() : null,
      newResetAt: payload.resetAt,
      hoursEarly: reset.hoursEarly ?? null,
      previousUsedPercent: reset.prevPercent,
      currentUsedPercent: weekly.usedPercent,
    };
  }

  return normalizeResetHoursEarly(payload);
}

export async function publishQuotaSnapshot({
  url,
  token,
  payload,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!url || !token) return { status: "disabled" };

  let endpoint;
  try {
    endpoint = new URL(url);
  } catch {
    throw new Error("CODEX_INGEST_URL is not a valid URL");
  }
  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new Error("CODEX_INGEST_URL must use HTTP or HTTPS");
  }

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    // Canonicalize queued payloads too, so snapshots created by an older
    // monitor version cannot permanently block the upload queue.
    body: JSON.stringify(normalizeResetHoursEarly(payload)),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`ingest endpoint returned HTTP ${response.status}`);
  }

  return { status: response.status === 201 ? "created" : "accepted" };
}

export async function drainPendingUploads({ pendingUploads, publish, onPublished = () => {} }) {
  const published = [];
  while (pendingUploads.length > 0) {
    const payload = pendingUploads[0];
    try {
      const result = await publish(payload);
      pendingUploads.shift();
      published.push({ payload, result });
      await onPublished(payload, result);
    } catch (error) {
      return { published, error };
    }
  }
  return { published, error: null };
}
