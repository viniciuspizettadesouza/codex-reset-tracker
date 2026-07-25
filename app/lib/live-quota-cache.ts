import { revalidateTag, unstable_cache } from "next/cache";

import {
  LIVE_QUOTA_CACHE_TAG,
  LIVE_QUOTA_REVALIDATE_SECONDS,
} from "@/app/lib/live-quota-invalidation";
import { getLiveQuotaData } from "@/app/lib/live-quota-store";

export const getCachedLiveQuotaData = unstable_cache(getLiveQuotaData, ["live-quota-data-v1"], {
  revalidate: LIVE_QUOTA_REVALIDATE_SECONDS,
  tags: [LIVE_QUOTA_CACHE_TAG],
});

export function invalidateLiveQuotaCache(): void {
  revalidateTag(LIVE_QUOTA_CACHE_TAG, { expire: 0 });
}
