import { neon } from "@neondatabase/serverless";

import type { LiveQuotaData, LiveQuotaSnapshot, LiveResetEvent } from "@/app/lib/live-quota";

function isoTimestamp(value: unknown): string {
  return new Date(value as string | number | Date).toISOString();
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

export async function getLiveQuotaData(): Promise<LiveQuotaData> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return { status: "unconfigured", snapshots: [], resetEvents: [] };
  }

  try {
    const sql = neon(databaseUrl);
    const [snapshotRows, resetRows] = await Promise.all([
      sql`
        SELECT
          observed_at,
          used_percent,
          reset_at,
          window_seconds,
          reset_detected
        FROM quota_snapshots
        WHERE observed_at >= NOW() - INTERVAL '90 days'
        ORDER BY observed_at ASC
      `,
      sql`
        SELECT
          detected_at,
          expected_reset_at,
          new_reset_at,
          hours_early,
          previous_used_percent,
          current_used_percent
        FROM reset_events
        WHERE detected_at >= NOW() - INTERVAL '90 days'
        ORDER BY detected_at ASC
      `,
    ]);

    const snapshots: LiveQuotaSnapshot[] = snapshotRows.map((row) => ({
      observedAt: isoTimestamp(row.observed_at),
      usedPercent: numberValue(row.used_percent),
      resetAt: isoTimestamp(row.reset_at),
      windowSeconds: numberValue(row.window_seconds),
      resetDetected: row.reset_detected === true,
    }));
    const resetEvents: LiveResetEvent[] = resetRows.map((row) => ({
      detectedAt: isoTimestamp(row.detected_at),
      expectedResetAt: row.expected_reset_at === null ? null : isoTimestamp(row.expected_reset_at),
      newResetAt: isoTimestamp(row.new_reset_at),
      hoursEarly: row.hours_early === null ? null : numberValue(row.hours_early),
      previousUsedPercent: numberValue(row.previous_used_percent),
      currentUsedPercent: numberValue(row.current_used_percent),
    }));

    return { status: "ready", snapshots, resetEvents };
  } catch {
    console.error("Live quota query failed.");
    return { status: "unavailable", snapshots: [], resetEvents: [] };
  }
}
