import { neon } from "@neondatabase/serverless";

import type { MonitorPayload } from "@/app/api/monitor/handler";

export type SaveResult = "created" | "duplicate";

export async function saveQuotaSnapshot(payload: MonitorPayload): Promise<SaveResult> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }

  const sql = neon(databaseUrl);
  const reset = payload.resetEvent;
  const rows = await sql`
    WITH inserted_snapshot AS (
      INSERT INTO quota_snapshots (
        observed_at,
        used_percent,
        reset_at,
        window_seconds,
        reset_detected
      )
      VALUES (
        ${payload.observedAt},
        ${payload.usedPercent},
        ${payload.resetAt},
        ${payload.windowSeconds},
        ${payload.resetDetected}
      )
      ON CONFLICT (observed_at) DO NOTHING
      RETURNING id
    ),
    inserted_event AS (
      INSERT INTO reset_events (
        snapshot_id,
        detected_at,
        expected_reset_at,
        new_reset_at,
        hours_early,
        previous_used_percent,
        current_used_percent
      )
      SELECT
        id,
        ${reset?.detectedAt ?? null},
        ${reset?.expectedResetAt ?? null},
        ${reset?.newResetAt ?? null},
        ${reset?.hoursEarly ?? null},
        ${reset?.previousUsedPercent ?? null},
        ${reset?.currentUsedPercent ?? null}
      FROM inserted_snapshot
      WHERE ${reset !== undefined}
      ON CONFLICT (snapshot_id) DO NOTHING
    ),
    pruned_snapshots AS (
      DELETE FROM quota_snapshots
      WHERE observed_at < NOW() - INTERVAL '90 days'
      RETURNING id
    )
    SELECT EXISTS(SELECT 1 FROM inserted_snapshot) AS inserted
  `;

  return rows[0]?.inserted === true ? "created" : "duplicate";
}
