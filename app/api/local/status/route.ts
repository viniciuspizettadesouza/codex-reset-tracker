import { getLocalMonitorStatus } from "@/app/lib/local-monitor-status";
import { createLocalStatusHandler } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createLocalStatusHandler({
  isEnabled: () => process.env.LOCAL_DASHBOARD_ENABLED === "1",
  getStatus: getLocalMonitorStatus,
});
