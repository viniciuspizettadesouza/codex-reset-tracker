import type { Metadata } from "next";
import { notFound } from "next/navigation";

import LocalDashboard from "@/app/components/LocalDashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Local monitor — Codex Reset Tracker",
  robots: { index: false, follow: false },
};

export default function LocalDashboardPage() {
  if (process.env.LOCAL_DASHBOARD_ENABLED !== "1") notFound();
  return <LocalDashboard />;
}
