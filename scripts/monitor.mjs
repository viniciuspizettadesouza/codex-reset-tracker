#!/usr/bin/env node
/**
 * Personal Codex quota monitor.
 *
 * Polls the authenticated usage endpoint for the account whose credentials are
 * in auth.json, and alerts you when your weekly quota refills — flagging
 * whether the reset happened BEFORE its scheduled time. Designed to run on the
 * machine where you're logged into Codex (via cron/launchd) or in a `--watch`
 * loop.
 *
 * Usage:
 *   node scripts/monitor.mjs --raw          # print the raw usage payload and exit
 *   node scripts/monitor.mjs                 # one poll, detect + alert
 *   node scripts/monitor.mjs --watch --interval 900
 *   node scripts/monitor.mjs --fixture scripts/fixtures/usage-weekly-low.json
 *                                            # offline: read usage from a file (no auth/network)
 *   node scripts/monitor.mjs --emit-event    # also append detected resets to the tracker
 *   node scripts/monitor.mjs --all-windows   # also alert on the 5h window (noisy; off by default)
 *
 * Auth: reads access_token + account_id from $CODEX_HOME/auth.json or
 *       ~/.codex/auth.json (override with --auth <path>). Skipped with --fixture.
 * Alerts: always logged; also POSTed to $CODEX_WEBHOOK_URL if set, and shown as
 *         a macOS notification when available.
 *
 * Exit codes: 0 = ran ok (no reset or reset handled), 2 = error.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { parseUsage, detectResets } from "./lib/quota.mjs";
import { upsertEvent, computeDaysEarly } from "./lib/events.mjs";
import {
  buildMonitorPayload,
  drainPendingUploads,
  formatQuota,
  publishQuotaSnapshot,
} from "./lib/publisher.mjs";
import {
  appendPollHistory,
  loadMonitorState,
  sanitizeMonitorError,
  saveMonitorState,
} from "./lib/monitor-state.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const USAGE_TIMEOUT_MS = 30_000;
const WEBHOOK_TIMEOUT_MS = 10_000;
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), ".codex");
const AUTH_PATH = opt("--auth", join(CODEX_HOME, "auth.json"));
const STATE_PATH =
  process.env.CODEX_MONITOR_STATE || join(homedir(), ".codex-reset-tracker", "monitor-state.json");
const WEBHOOK_URL = process.env.CODEX_WEBHOOK_URL || "";
const INGEST_URL = process.env.CODEX_INGEST_URL || "";
const INGEST_TOKEN = process.env.CODEX_INGEST_TOKEN || "";
const INTERVAL_SEC = Number(opt("--interval", "900"));
const FIXTURE_PATH = opt("--fixture", "");
const EMIT_EVENT = flag("--emit-event");
// The 5-hour window resets constantly and normally, so only the weekly window is
// surfaced by default. --all-windows opts into alerts for every window.
const ALL_WINDOWS = flag("--all-windows");
const TRACKER_PATH = opt("--tracker", join(__dirname, "../data/resets.json"));
const PLAN = process.env.CODEX_PLAN || "Unknown";

function readAuth() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(AUTH_PATH, "utf-8"));
  } catch {
    throw new Error(
      `Could not read auth.json at ${AUTH_PATH}. Install the Codex CLI and run \`codex login\` first, or pass --auth <path>.`,
    );
  }
  // Token may sit at the top level or nested under `tokens` depending on version.
  const t = raw.tokens ?? raw;
  const accessToken = t.access_token ?? raw.access_token;
  const accountId = t.account_id ?? raw.account_id ?? t.accountId ?? raw.accountId;
  const refreshToken = raw.tokens?.refresh_token ?? raw.refresh_token ?? null;
  if (!accessToken) {
    throw new Error(`No access_token found in ${AUTH_PATH}.`);
  }
  return { accessToken, accountId, refreshToken };
}

async function refreshAccessToken(refreshToken) {
  const body = JSON.stringify({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    // Public client ID used by the Codex CLI.
    client_id: "pdlLIX2Y72MIl2rhLhTE9VV9bN905kBh",
  });
  const headers = { "Content-Type": "application/json" };

  let res = await fetch("https://auth.openai.com/oauth/token", {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
  });
  if (!res.ok) {
    // Fall back to the Auth0 domain used by older CLI versions.
    res = await fetch("https://auth0.openai.com/oauth/token", {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
    });
  }
  if (!res.ok) {
    throw new Error(
      `Token refresh failed (HTTP ${res.status}). Run \`codex login\` to re-authenticate.`,
    );
  }
  const data = await res.json();
  const newToken = data.access_token;
  if (!newToken) {
    throw new Error(
      `Token refresh response did not include an access_token. Run \`codex login\` to re-authenticate.`,
    );
  }
  // Merge the new token back into the existing auth.json, preserving all other fields.
  let existing = {};
  try {
    existing = JSON.parse(readFileSync(AUTH_PATH, "utf-8"));
  } catch {
    // If we cannot read the file, write a minimal replacement.
  }
  if (existing.tokens) {
    existing.tokens.access_token = newToken;
  } else {
    existing.access_token = newToken;
  }
  writeFileSync(AUTH_PATH, JSON.stringify(existing, null, 2) + "\n", "utf-8");
  return newToken;
}

async function fetchUsage({ accessToken, accountId, refreshToken }, { onRefreshed } = {}) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "codex-reset-tracker-monitor/1.0",
    Accept: "application/json",
  };
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;

  let res = await fetch(USAGE_URL, {
    headers,
    signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
  });
  if (res.status === 401 && refreshToken) {
    // Attempt a silent token refresh, then retry once.
    const newToken = await refreshAccessToken(refreshToken);
    headers.Authorization = `Bearer ${newToken}`;
    res = await fetch(USAGE_URL, {
      headers,
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
    });
    if (onRefreshed) onRefreshed(newToken);
  }
  if (res.status === 401) {
    throw new Error(
      `Usage endpoint returned 401 — the access token is expired and could not be refreshed automatically. Run \`codex login\` to re-authenticate.`,
    );
  }
  if (res.status === 403) {
    throw new Error(
      `Usage endpoint returned 403 — this account does not have access to the usage endpoint. Run \`codex\` (or \`codex login\`) on this machine to refresh auth.json, then retry.`,
    );
  }
  if (!res.ok) {
    throw new Error(`Usage endpoint returned HTTP ${res.status}.`);
  }
  return res.json();
}

async function getUsage(auth, opts = {}) {
  if (FIXTURE_PATH) {
    return JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
  }
  return fetchUsage(auth, opts);
}

// Append a detected reset to the community tracker, merging via upsertEvent so a
// reset already recorded (e.g. from a community report) just raises its confidence.
function emitToTracker(ev) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(TRACKER_PATH, "utf-8"));
  } catch {
    raw = { events: [] };
  }
  const occurredAt = ev.detectedAt;
  const scheduledAt = ev.expectedResetAt ?? null;
  const candidate = {
    id: `monitor-${occurredAt.slice(0, 10)}-${ev.window}`,
    occurredAt,
    scheduledAt,
    daysEarly: computeDaysEarly(occurredAt, scheduledAt),
    reportedAt: new Date().toISOString(),
    status: "suspected",
    title: ev.early ? "Quota reset early (personal monitor)" : "Quota reset (personal monitor)",
    affectedPlans: [PLAN],
    reportCount: 1,
    sourceName: "Personal monitor",
    description: ev.early
      ? `Monitor detected a ${ev.window} quota refill at ${occurredAt}, ~${ev.hoursEarly}h before the scheduled reset (${scheduledAt}).`
      : `Monitor detected a ${ev.window} quota refill at ${occurredAt}. Scheduled reset was ${scheduledAt ?? "unknown"}.`,
  };
  const { events, action } = upsertEvent(raw.events ?? [], candidate);
  raw.events = events;
  raw.lastUpdatedAt = new Date().toISOString();
  mkdirSync(dirname(TRACKER_PATH), { recursive: true });
  writeFileSync(TRACKER_PATH, JSON.stringify(raw, null, 2) + "\n", "utf-8");
  console.log(`Tracker updated (${action}): ${candidate.id}`);
}

function notifyMac(title, message) {
  if (process.platform !== "darwin") return "unsupported";
  execFile("/usr/bin/osascript", [
    "-e",
    `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`,
  ]);
  return "attempted";
}

async function notifyWebhook(title, message) {
  if (!WEBHOOK_URL) return "disabled";
  const text = `${title}\n${message}`;
  let payload;

  if (WEBHOOK_URL.includes("discord.com/api/webhooks") || WEBHOOK_URL.includes("discordapp.com")) {
    payload = { embeds: [{ title, description: message, color: 0x55e6a5 }] };
  } else if (WEBHOOK_URL.includes("hooks.slack.com") || WEBHOOK_URL.includes("/slack")) {
    payload = {
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*${title}*\n${message}` },
        },
      ],
    };
  } else if (WEBHOOK_URL.includes("api.telegram.org/bot")) {
    const chatId = process.env.CODEX_TELEGRAM_CHAT_ID;
    if (!chatId) {
      console.warn(
        "Telegram webhook configured but CODEX_TELEGRAM_CHAT_ID is not set — skipping notification.",
      );
      return "misconfigured";
    }
    payload = { chat_id: chatId, text, parse_mode: "HTML" };
  } else {
    // Generic fallback compatible with ntfy, Mattermost, and similar consumers.
    payload = { content: text, text };
  }

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`Webhook notification failed: HTTP ${response.status}`);
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.warn("Webhook notification failed:", err.message);
    return "failed";
  }
}

async function alert(title, message, state) {
  console.log(`\n🔔 ${title}\n${message}\n`);
  const desktop = notifyMac(title, message);
  const webhook = await notifyWebhook(title, message);
  if (state) {
    state.lastAlert = {
      at: new Date().toISOString(),
      title,
      desktop,
      webhook,
    };
  }
}

async function handleEvent(ev, state) {
  const scope = ev.window === "weekly" ? "Weekly quota" : `${ev.window} quota`;
  if (ev.refilled && ev.early) {
    await alert(
      `Codex ${scope} reset EARLY`,
      `Refilled ${ev.hoursEarly}h before its scheduled reset (${ev.expectedResetAt}). Used ${ev.prevPercent}% → ${ev.currPercent}%.`,
      state,
    );
  } else if (ev.refilled) {
    await alert(
      `Codex ${scope} reset`,
      `Quota refilled (${ev.prevPercent}% → ${ev.currPercent}%). Scheduled reset was ${ev.expectedResetAt ?? "unknown"}.`,
      state,
    );
  } else {
    // Only the announced reset time moved earlier — a heads-up, not a refill yet.
    await alert(
      `Codex ${scope} reset time moved earlier`,
      `The scheduled reset was pulled forward from ${ev.expectedResetAt} to ${ev.newResetAt}. Quota still at ${ev.currPercent}%.`,
      state,
    );
  }
  // Only real weekly refills are worth contributing to the tracker.
  if (EMIT_EVENT && ev.refilled && ev.window === "weekly") {
    emitToTracker(ev);
  }
}

async function pollOnce(auth, opts = {}) {
  const startedAt = new Date().toISOString();
  const startedTimestamp = Date.parse(startedAt);
  const state = loadMonitorState(STATE_PATH, startedTimestamp);
  state.intervalSeconds = INTERVAL_SEC;
  state.health.lastAttemptAt = startedAt;

  const raw = await getUsage(auth, opts).catch((error) => {
    recordPollFailure(state, startedAt, startedTimestamp, error);
    throw error;
  });
  if (flag("--raw")) {
    console.log(JSON.stringify(raw, null, 2));
    return;
  }

  let windows;
  try {
    windows = parseUsage(raw);
    if (!windows.weekly) {
      throw new Error(
        "Usage payload did not include a supported weekly quota window. Run with --raw to inspect the shape.",
      );
    }
  } catch (error) {
    recordPollFailure(state, startedAt, startedTimestamp, error);
    throw error;
  }

  const observedAt = new Date().toISOString();
  const events = detectResets(state.windows, windows, {
    now: Date.parse(observedAt),
  });

  for (const ev of events) {
    if (ev.window !== "weekly" && !ALL_WINDOWS) {
      console.log(`(${ev.window} window changed — ignoring; use --all-windows to alert on it)`);
      continue;
    }
    await handleEvent(ev, state);
  }

  const weekly = windows.weekly;
  const weeklyInfo = weekly
    ? `Weekly: ${formatQuota(weekly.usedPercent)}, resets ${weekly.resetsAt}.`
    : "No weekly window in payload.";
  console.log(`Polled OK. ${weeklyInfo}${events.length === 0 ? " No reset detected." : ""}`);

  state.windows = windows;
  state.lastPollAt = observedAt;

  const weeklyReset = events.find((event) => event.window === "weekly" && event.refilled);
  const payload = buildMonitorPayload(weekly, weeklyReset, observedAt);
  const publisherConfigured = Boolean(INGEST_URL && INGEST_TOKEN);
  state.publishing.configured = publisherConfigured;
  if ((INGEST_URL || INGEST_TOKEN) && !publisherConfigured) {
    console.warn(
      "Quota publishing is disabled because both CODEX_INGEST_URL and CODEX_INGEST_TOKEN are required.",
    );
  }

  if (payload && publisherConfigured) {
    const pendingUploads = Array.isArray(state.pendingUploads) ? state.pendingUploads : [];
    if (!pendingUploads.some((pending) => pending.observedAt === payload.observedAt)) {
      pendingUploads.push(payload);
    }
    state.pendingUploads = pendingUploads;
  }
  saveMonitorState(STATE_PATH, state);

  let publishStatus = publisherConfigured ? "not-attempted" : "disabled";
  let publishError = null;
  if (publisherConfigured && state.pendingUploads?.length) {
    const drainResult = await drainPendingUploads({
      pendingUploads: state.pendingUploads,
      publish: (pending) => {
        state.publishing.lastAttemptAt = new Date().toISOString();
        return publishQuotaSnapshot({
          url: INGEST_URL,
          token: INGEST_TOKEN,
          payload: pending,
        });
      },
      onPublished: (pending, result) => {
        console.log(`Published weekly snapshot (${result.status}).`);
        publishStatus = result.status;
        state.publishing.lastSuccessAt = new Date().toISOString();
        state.publishing.lastStatus = result.status;
        state.publishing.lastPublishedObservedAt = pending.observedAt;
        state.publishing.lastError = null;
        saveMonitorState(STATE_PATH, state);
      },
    });
    if (drainResult.error) {
      publishError = sanitizeMonitorError(drainResult.error);
      publishStatus = "failed";
      state.publishing.lastFailureAt = new Date().toISOString();
      state.publishing.lastError = publishError;
      state.publishing.lastStatus = "failed";
      console.warn(
        `Quota snapshot upload failed; local monitoring remains active and the next poll will retry: ${publishError}`,
      );
    }
  }

  const completedAt = new Date().toISOString();
  const durationMs = Math.max(0, Date.parse(completedAt) - startedTimestamp);
  state.health.lastSuccessAt = completedAt;
  state.health.lastError = null;
  state.health.consecutiveFailures = 0;
  state.health.lastDurationMs = durationMs;
  appendPollHistory(state, {
    startedAt,
    completedAt,
    durationMs,
    result: publishError ? "partial" : "success",
    usedPercent: weekly.usedPercent,
    resetAt: weekly.resetsAt,
    resetDetected: Boolean(weeklyReset),
    publishStatus,
    error: publishError,
  });
  saveMonitorState(STATE_PATH, state);
}

function recordPollFailure(state, startedAt, startedTimestamp, error) {
  const completedAt = new Date().toISOString();
  const durationMs = Math.max(0, Date.parse(completedAt) - startedTimestamp);
  const message = sanitizeMonitorError(error);
  state.health.lastFailureAt = completedAt;
  state.health.lastError = message;
  state.health.consecutiveFailures = (state.health.consecutiveFailures ?? 0) + 1;
  state.health.lastDurationMs = durationMs;
  appendPollHistory(state, {
    startedAt,
    completedAt,
    durationMs,
    result: "failure",
    usedPercent: null,
    resetAt: null,
    resetDetected: false,
    publishStatus: "not-attempted",
    error: message,
  });
  saveMonitorState(STATE_PATH, state);
}

function recordUntrackedFailure(error) {
  if (flag("--raw")) return;
  const now = Date.now();
  const message = sanitizeMonitorError(error);
  const state = loadMonitorState(STATE_PATH, now);
  const lastFailure = Date.parse(state.health.lastFailureAt ?? "");
  if (
    state.health.lastError === message &&
    Number.isFinite(lastFailure) &&
    now - lastFailure < 5_000
  ) {
    return;
  }
  const startedAt = new Date(now).toISOString();
  state.intervalSeconds = INTERVAL_SEC;
  state.health.lastAttemptAt = startedAt;
  recordPollFailure(state, startedAt, now, error);
}

async function main() {
  if (flag("--test-alert")) {
    const state = loadMonitorState(STATE_PATH);
    await alert(
      "Test alert",
      "Monitor alert test — if you see this, notifications are working.",
      state,
    );
    saveMonitorState(STATE_PATH, state);
    return;
  }

  // Fixture mode reads usage from a file, so no credentials are needed.
  const auth = FIXTURE_PATH ? null : readAuth();

  // When a live token refresh succeeds, update the in-memory auth object so
  // subsequent polls in --watch mode use the new token without re-reading disk.
  const opts = auth
    ? {
        onRefreshed(newToken) {
          auth.accessToken = newToken;
          console.log("Access token refreshed automatically.");
        },
      }
    : {};

  if (flag("--watch")) {
    console.log(`Watching every ${INTERVAL_SEC}s. State: ${STATE_PATH}`);
    while (true) {
      try {
        await pollOnce(auth, opts);
      } catch (err) {
        recordUntrackedFailure(err);
        console.error("Poll failed:", err.message);
      }
      await new Promise((r) => setTimeout(r, INTERVAL_SEC * 1000));
    }
  } else {
    await pollOnce(auth, opts);
  }
}

try {
  await main();
} catch (err) {
  recordUntrackedFailure(err);
  console.error("Monitor error:", err.message);
  process.exit(2);
}
