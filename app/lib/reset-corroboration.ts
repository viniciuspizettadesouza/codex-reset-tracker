export const OFFICIAL_CORROBORATION_WINDOW_MS = 6 * 60 * 60 * 1000;

export type PublicResetEvidence = {
  occurredAt: string;
  status: "official" | "community" | "suspected";
  title: string;
  sourceName: string;
  sourceUrl?: string;
};

export type OfficialResetConfirmation = {
  occurredAt: string;
  title: string;
  sourceName: string;
  sourceUrl: string;
};

export function findOfficialResetConfirmation(
  detectedAt: string | null | undefined,
  events: PublicResetEvidence[],
  windowMs = OFFICIAL_CORROBORATION_WINDOW_MS,
): OfficialResetConfirmation | null {
  const detectedTimestamp = detectedAt ? Date.parse(detectedAt) : Number.NaN;
  if (!Number.isFinite(detectedTimestamp)) return null;

  const candidates = events
    .filter(
      (event): event is PublicResetEvidence & { sourceUrl: string } =>
        event.status === "official" &&
        typeof event.sourceUrl === "string" &&
        event.sourceUrl.length > 0 &&
        Number.isFinite(Date.parse(event.occurredAt)),
    )
    .map((event) => ({
      event,
      distance: Math.abs(Date.parse(event.occurredAt) - detectedTimestamp),
    }))
    .filter(({ distance }) => distance <= windowMs)
    .sort((a, b) => a.distance - b.distance);

  const match = candidates[0]?.event;
  if (!match) return null;

  return {
    occurredAt: match.occurredAt,
    title: match.title,
    sourceName: match.sourceName,
    sourceUrl: match.sourceUrl,
  };
}
