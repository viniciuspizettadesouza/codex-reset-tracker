import type { MonitorPayload } from "@/app/api/monitor/handler";
import type { SaveResult } from "@/app/lib/quota-store";

export const LIVE_QUOTA_CACHE_TAG = "live-quota";
export const LIVE_QUOTA_REVALIDATE_SECONDS = 15 * 60;

export function withLiveQuotaInvalidation(
  saveSnapshot: (payload: MonitorPayload) => Promise<SaveResult>,
  invalidate: () => void | Promise<void>,
): (payload: MonitorPayload) => Promise<SaveResult> {
  return async (payload) => {
    const result = await saveSnapshot(payload);
    if (result === "created") {
      try {
        await invalidate();
      } catch {
        console.error("Live quota cache invalidation failed; the fallback will refresh it.");
      }
    }
    return result;
  };
}
