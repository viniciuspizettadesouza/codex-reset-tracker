import { saveQuotaSnapshot } from "@/app/lib/quota-store";
import { createMonitorHandler } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlePost = createMonitorHandler({
  getIngestToken: () => process.env.MONITOR_INGEST_TOKEN,
  saveSnapshot: saveQuotaSnapshot,
});

export async function POST(request: Request): Promise<Response> {
  return handlePost(request);
}
