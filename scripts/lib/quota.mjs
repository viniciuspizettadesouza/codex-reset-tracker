/**
 * Pure helpers for reading Codex quota state and detecting resets.
 *
 * The exact JSON shape of https://chatgpt.com/backend-api/wham/usage is not
 * publicly documented, so parsing is defensive: it accepts several plausible
 * key names and both absolute (`resets_at`) and relative (`resets_in_seconds`)
 * reset fields. Run the monitor with `--raw` once to capture the real payload
 * and tighten these if needed.
 */

const PERCENT_KEYS = ["used_percent", "usage_percent", "percent_used", "percent"];
const RESET_AT_KEYS = ["resets_at", "reset_at", "reset_time"];
const RESET_IN_KEYS = [
  "resets_in_seconds",
  "reset_after_seconds",
  "seconds_until_reset",
  "reset_in_seconds",
];
const WINDOW_MIN_KEYS = ["window_minutes", "window_size_minutes", "window_size_in_minutes"];

function firstNumber(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function firstString(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

/** Turn one window-like object into { usedPercent, resetsAt, windowMinutes }. */
export function extractWindow(win, now = Date.now()) {
  if (!win || typeof win !== "object") return null;
  const usedPercent = firstNumber(win, PERCENT_KEYS);
  const windowMinutes = firstNumber(win, WINDOW_MIN_KEYS);

  let resetsAt = firstString(win, RESET_AT_KEYS);
  if (!resetsAt) {
    const secs = firstNumber(win, RESET_IN_KEYS);
    if (secs != null) resetsAt = new Date(now + secs * 1000).toISOString();
  }
  if (usedPercent == null && !resetsAt) return null;
  return { usedPercent, resetsAt, windowMinutes };
}

function labelFor(win, fallback) {
  if (win?.windowMinutes != null) {
    return win.windowMinutes >= 24 * 60 ? "weekly" : "5h";
  }
  return fallback;
}

/**
 * Normalize a /wham/usage payload into { weekly, "5h", ...others } windows.
 * Recognizes { primary, secondary }, { rate_limits: {...} }, and arrays.
 */
export function parseUsage(json, now = Date.now()) {
  const out = {};
  if (!json || typeof json !== "object") return out;

  const container = json.rate_limits ?? json.usage ?? json;

  // Shape A: { primary: {...}, secondary: {...} } (Codex's known naming)
  if (container.primary || container.secondary) {
    const primary = extractWindow(container.primary, now);
    const secondary = extractWindow(container.secondary, now);
    if (primary) out[labelFor(primary, "5h")] = primary;
    if (secondary) out[labelFor(secondary, "weekly")] = secondary;
    if (Object.keys(out).length) return out;
  }

  // Shape B: array of windows
  const arr = Array.isArray(container) ? container : container.windows;
  if (Array.isArray(arr)) {
    for (const raw of arr) {
      const win = extractWindow(raw, now);
      if (win) out[labelFor(win, `window_${Object.keys(out).length}`)] = win;
    }
  }
  return out;
}

/**
 * Compare a previous and current snapshot of one window and decide whether a
 * reset happened. A reset is a sharp drop in used percent, or the reset
 * timestamp moving earlier than expected.
 */
export function detectResetForWindow(prev, curr, opts = {}) {
  const dropThreshold = opts.dropThreshold ?? 25;
  // A reset timestamp derived from relative seconds wobbles between polls, so
  // only treat a sizable earlier move (default 1h) as the announced date changing.
  const resetMoveThresholdMs = opts.resetMoveThresholdMs ?? 3_600_000;
  const now = opts.now ?? Date.now();
  if (!prev || !curr) return null;

  const dropped =
    prev.usedPercent != null && curr.usedPercent != null ? prev.usedPercent - curr.usedPercent : 0;

  const refilled =
    dropped >= dropThreshold ||
    (curr.usedPercent != null &&
      prev.usedPercent != null &&
      curr.usedPercent < 5 &&
      prev.usedPercent > 50);

  const resetMovedEarlier =
    prev.resetsAt &&
    curr.resetsAt &&
    new Date(curr.resetsAt).getTime() < new Date(prev.resetsAt).getTime() - resetMoveThresholdMs;

  if (!refilled && !resetMovedEarlier) return null;

  // Was it early? i.e. did it happen before the reset we were previously told.
  const expectedResetAt = prev.resetsAt ?? null;
  const early = expectedResetAt ? now < new Date(expectedResetAt).getTime() : null;
  const msEarly = early ? new Date(expectedResetAt).getTime() - now : 0;

  return {
    refilled,
    resetMovedEarlier,
    early,
    expectedResetAt,
    newResetAt: curr.resetsAt ?? null,
    hoursEarly: early ? Math.round((msEarly / 3_600_000) * 10) / 10 : null,
    prevPercent: prev.usedPercent,
    currPercent: curr.usedPercent,
    detectedAt: new Date(now).toISOString(),
  };
}

/** Run detection across all windows present in both snapshots. */
export function detectResets(prevWindows, currWindows, opts = {}) {
  const events = [];
  for (const key of Object.keys(currWindows ?? {})) {
    const ev = detectResetForWindow(prevWindows?.[key], currWindows[key], opts);
    if (ev) events.push({ window: key, ...ev });
  }
  return events;
}
