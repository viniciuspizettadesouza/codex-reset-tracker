import { getLatestLiveQuotaSnapshot } from "@/app/lib/live-quota-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const latest = await getLatestLiveQuotaSnapshot();
    return Response.json(
      { status: latest ? "ready" : "empty", latest },
      {
        headers: {
          "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch {
    return Response.json(
      { status: "unavailable", latest: null },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
