export function createLocalStatusHandler({
  isEnabled,
  getStatus,
}: {
  isEnabled: () => boolean;
  getStatus: () => Promise<unknown>;
}) {
  return async function handleGet(): Promise<Response> {
    if (!isEnabled()) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const status = await getStatus();
    return Response.json(status, {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}
