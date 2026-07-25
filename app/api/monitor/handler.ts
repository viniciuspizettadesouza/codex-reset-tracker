import { createHash, timingSafeEqual } from "node:crypto";

const MAX_BODY_BYTES = 4_096;
const MIN_TOKEN_LENGTH = 32;
const WEEKLY_WINDOW_MIN_SECONDS = 6 * 24 * 60 * 60;
const WEEKLY_WINDOW_MAX_SECONDS = 8 * 24 * 60 * 60;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

type ResetEventPayload = {
  detectedAt: string;
  expectedResetAt: string | null;
  newResetAt: string;
  hoursEarly: number | null;
  previousUsedPercent: number;
  currentUsedPercent: number;
};

export type MonitorPayload = {
  version: 1;
  observedAt: string;
  usedPercent: number;
  resetAt: string;
  windowSeconds: number;
  resetDetected: boolean;
  resetEvent?: ResetEventPayload;
};

type HandlerDependencies = {
  getIngestToken: () => string | undefined;
  saveSnapshot: (payload: MonitorPayload) => Promise<"created" | "duplicate">;
};

type ValidationResult =
  { success: true; payload: MonitorPayload } | { success: false; error: string };

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every((key) => key in value) && keys.every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isUtcTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" && ISO_UTC_PATTERN.test(value) && Number.isFinite(Date.parse(value))
  );
}

function parseResetEvent(value: unknown): ResetEventPayload | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "detectedAt",
      "expectedResetAt",
      "newResetAt",
      "hoursEarly",
      "previousUsedPercent",
      "currentUsedPercent",
    ])
  ) {
    return null;
  }

  if (
    !isUtcTimestamp(value.detectedAt) ||
    (value.expectedResetAt !== null && !isUtcTimestamp(value.expectedResetAt)) ||
    !isUtcTimestamp(value.newResetAt) ||
    (value.hoursEarly !== null &&
      (typeof value.hoursEarly !== "number" ||
        !Number.isFinite(value.hoursEarly) ||
        value.hoursEarly < 0)) ||
    !isPercent(value.previousUsedPercent) ||
    !isPercent(value.currentUsedPercent)
  ) {
    return null;
  }

  return {
    detectedAt: value.detectedAt,
    expectedResetAt: value.expectedResetAt,
    newResetAt: value.newResetAt,
    hoursEarly: value.hoursEarly,
    previousUsedPercent: value.previousUsedPercent,
    currentUsedPercent: value.currentUsedPercent,
  };
}

export function validateMonitorPayload(value: unknown): ValidationResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      ["version", "observedAt", "usedPercent", "resetAt", "windowSeconds", "resetDetected"],
      ["resetEvent"],
    )
  ) {
    return { success: false, error: "Payload fields are invalid" };
  }

  if (
    value.version !== 1 ||
    !isUtcTimestamp(value.observedAt) ||
    !isPercent(value.usedPercent) ||
    !isUtcTimestamp(value.resetAt) ||
    !Number.isInteger(value.windowSeconds) ||
    (value.windowSeconds as number) < WEEKLY_WINDOW_MIN_SECONDS ||
    (value.windowSeconds as number) > WEEKLY_WINDOW_MAX_SECONDS ||
    typeof value.resetDetected !== "boolean" ||
    Date.parse(value.resetAt as string) <= Date.parse(value.observedAt as string)
  ) {
    return { success: false, error: "Payload values are invalid" };
  }

  const resetEvent = value.resetEvent === undefined ? undefined : parseResetEvent(value.resetEvent);
  if (
    (value.resetDetected && !resetEvent) ||
    (!value.resetDetected && value.resetEvent !== undefined)
  ) {
    return { success: false, error: "Reset metadata is inconsistent" };
  }

  if (resetEvent) {
    const calculatedHoursEarly = resetEvent.expectedResetAt
      ? Math.max(
          0,
          (Date.parse(resetEvent.expectedResetAt) - Date.parse(resetEvent.detectedAt)) / 3_600_000,
        )
      : null;
    if (
      resetEvent.detectedAt !== value.observedAt ||
      resetEvent.newResetAt !== value.resetAt ||
      resetEvent.currentUsedPercent !== value.usedPercent ||
      resetEvent.previousUsedPercent <= resetEvent.currentUsedPercent ||
      (calculatedHoursEarly === null) !== (resetEvent.hoursEarly === null) ||
      (calculatedHoursEarly !== null &&
        resetEvent.hoursEarly !== null &&
        Math.abs(calculatedHoursEarly - resetEvent.hoursEarly) > 0.05)
    ) {
      return { success: false, error: "Reset metadata values are invalid" };
    }
  }

  return {
    success: true,
    payload: {
      version: 1,
      observedAt: value.observedAt,
      usedPercent: value.usedPercent,
      resetAt: value.resetAt,
      windowSeconds: value.windowSeconds as number,
      resetDetected: value.resetDetected,
      ...(resetEvent ? { resetEvent } : {}),
    },
  };
}

function tokenMatches(supplied: string, expected: string): boolean {
  const suppliedHash = createHash("sha256").update(supplied).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(suppliedHash, expectedHash);
}

export function createMonitorHandler({
  getIngestToken,
  saveSnapshot,
}: HandlerDependencies): (request: Request) => Promise<Response> {
  return async function handleMonitorPost(request: Request): Promise<Response> {
    const ingestToken = getIngestToken();
    if (!ingestToken || ingestToken.length < MIN_TOKEN_LENGTH) {
      return jsonResponse({ error: "Ingest is not configured" }, 503);
    }

    const authorization = request.headers.get("authorization");
    const suppliedToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    if (!suppliedToken || !tokenMatches(suppliedToken, ingestToken)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") {
      return jsonResponse({ error: "Content-Type must be application/json" }, 415);
    }

    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return jsonResponse({ error: "Payload is too large" }, 413);
    }

    let value: unknown;
    try {
      const body = await request.text();
      if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
        return jsonResponse({ error: "Payload is too large" }, 413);
      }
      value = JSON.parse(body);
    } catch {
      return jsonResponse({ error: "Body must be valid JSON" }, 400);
    }

    const validation = validateMonitorPayload(value);
    if (!validation.success) {
      return jsonResponse({ error: validation.error }, 400);
    }

    const result = await saveSnapshot(validation.payload);
    return jsonResponse(
      {
        status: result,
        remainingPercent: 100 - validation.payload.usedPercent,
      },
      result === "created" ? 201 : 200,
    );
  };
}
