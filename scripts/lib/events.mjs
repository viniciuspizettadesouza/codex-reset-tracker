/**
 * Shared event model and merge logic.
 *
 * This is the single place where any source (website reports, GitHub issues,
 * the autonomous collector, and future canary sensors) turns an observation
 * into a tracked event. All of them call `upsertEvent`, so independent reports
 * about the same reset merge into one event whose confidence rises as more
 * reports arrive — the core mechanism described in VISION.md.
 */

export const PLANS = ["Free", "Plus", "Pro", "Team", "Enterprise", "Unknown"];

// Reports whose observed reset times fall within this window are treated as the
// same real-world event and merged together.
export const SAME_EVENT_WINDOW_MS = 24 * 60 * 60 * 1000;

// Minimum independent reports before an event is upgraded to "community".
export const COMMUNITY_THRESHOLD = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How many days before its scheduled date a reset actually occurred.
 * Returns a number rounded to one decimal, or null when it cannot be computed
 * or the reset was not actually early (occurred on/after the scheduled date).
 */
export function computeDaysEarly(occurredAt, scheduledAt) {
  if (!occurredAt || !scheduledAt) return null;
  const occurred = new Date(occurredAt).getTime();
  const scheduled = new Date(scheduledAt).getTime();
  if (Number.isNaN(occurred) || Number.isNaN(scheduled)) return null;
  const diff = scheduled - occurred;
  if (diff <= 0) return null;
  return Math.round((diff / MS_PER_DAY) * 10) / 10;
}

/** Whether an observation describes an early reset at all. */
export function isEarly(occurredAt, scheduledAt) {
  return computeDaysEarly(occurredAt, scheduledAt) !== null;
}

export function deriveStatus(reportCount, isOfficial) {
  if (isOfficial) return "official";
  return reportCount >= COMMUNITY_THRESHOLD ? "community" : "suspected";
}

/** Two observations refer to the same reset if their times are within the window. */
export function isSameEvent(a, b) {
  const ta = new Date(a.occurredAt).getTime();
  const tb = new Date(b.occurredAt).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return Math.abs(ta - tb) < SAME_EVENT_WINDOW_MS;
}

function unionPlans(a = [], b = []) {
  const set = new Set([...a, ...b].filter(Boolean));
  set.delete("Unknown");
  return set.size > 0 ? [...set] : ["Unknown"];
}

function mergeSources(existing, candidate) {
  const sources = Array.isArray(existing.sources) ? [...existing.sources] : [];
  // Seed with the primary source of the existing event if not already tracked.
  if (
    existing.sourceName &&
    !sources.some(
      (source) =>
        (existing.sourceUrl && source.url === existing.sourceUrl) ||
        (!existing.sourceUrl && source.name === existing.sourceName),
    )
  ) {
    sources.unshift({ name: existing.sourceName, url: existing.sourceUrl });
  }
  const candidates = Array.isArray(candidate.sources)
    ? candidate.sources
    : [{ name: candidate.sourceName, url: candidate.sourceUrl }];
  for (const source of candidates) {
    if (!source?.name) continue;
    const already = sources.some(
      (existingSource) =>
        (source.url && existingSource.url === source.url) ||
        (!source.url && existingSource.name === source.name),
    );
    if (!already) sources.push(source);
  }
  return sources;
}

/**
 * Fold `candidate` into `existing`, producing an upgraded event.
 * The earliest observed time wins; report counts add up; plans union;
 * an official source promotes the headline source and status.
 */
function mergeInto(existing, candidate) {
  const isOfficial = existing.status === "official" || candidate.status === "official";
  const reportCount = (existing.reportCount ?? 1) + (candidate.reportCount ?? 1);

  const earliest =
    new Date(candidate.occurredAt) < new Date(existing.occurredAt)
      ? candidate.occurredAt
      : existing.occurredAt;

  const scheduledAt = existing.scheduledAt ?? candidate.scheduledAt ?? null;
  const sources = mergeSources(existing, candidate);

  // An official source takes over the headline; otherwise keep the earliest one.
  const headline = candidate.status === "official" ? candidate : existing;
  const automated =
    existing.automated === true ||
    candidate.automated === true ||
    existing.id?.startsWith("auto-") ||
    candidate.id?.startsWith("auto-");
  const communityNoun = reportCount === 1 ? "report" : "reports";

  return {
    ...existing,
    occurredAt: earliest,
    scheduledAt,
    daysEarly: computeDaysEarly(earliest, scheduledAt),
    status: deriveStatus(reportCount, isOfficial),
    title: isOfficial ? headline.title : existing.title,
    affectedPlans: unionPlans(existing.affectedPlans, candidate.affectedPlans),
    reportCount,
    sourceName:
      !isOfficial && automated
        ? `${reportCount} community ${communityNoun}`
        : (headline.sourceName ?? existing.sourceName),
    sourceUrl: headline.sourceUrl ?? existing.sourceUrl,
    sources,
    description:
      !isOfficial && automated
        ? `${reportCount} independent community ${communityNoun} suggest a quota reset occurred around this time.`
        : headline.description,
    automated,
  };
}

/**
 * Add `candidate` to `events`, merging into an existing event when one refers
 * to the same reset. Returns { events, action } where action is
 * "added" | "merged". Does not mutate the input array.
 */
export function upsertEvent(events, candidate) {
  const normalized = {
    ...candidate,
    daysEarly: computeDaysEarly(candidate.occurredAt, candidate.scheduledAt),
  };
  const idx = events.findIndex((e) => isSameEvent(normalized, e));
  if (idx === -1) {
    return { events: [...events, normalized], action: "added" };
  }
  const copy = [...events];
  copy[idx] = mergeInto(events[idx], normalized);
  return { events: copy, action: "merged" };
}
