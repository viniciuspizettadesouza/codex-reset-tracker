# Next steps / project handoff

Continuation notes so this project can be resumed in a fresh session without
re-deriving context. Goal: **tell the user the moment their Codex weekly quota
resets, especially when it resets early.** See [VISION.md](VISION.md) for the why
and [DATA_SOURCES.md](DATA_SOURCES.md) for the source landscape.

## ✅ Completed on the personal machine

The real payload was captured with:

```bash
node scripts/monitor.mjs --raw
```

The confirmed shape is `rate_limit.primary_window` / `secondary_window`, with
`used_percent`, `limit_window_seconds`, `reset_after_seconds`, and a Unix-seconds
`reset_at`. The parser and anonymized fixtures now use that contract. The first
normal poll also succeeded and established the local baseline.

## ▶️ Immediate next action

Run the monitor unattended. Either leave watch mode running:

```bash
node scripts/monitor.mjs --watch --interval 900   # keep watching every 15 min
```

Or schedule `node scripts/monitor.mjs` with cron/launchd on an always-on host.
Full options are in the [README](../README.md#personal-quota-monitor).

## Current state (what works)

- **`scripts/monitor.mjs`** — reads `~/.codex/auth.json`, GETs `/wham/usage`,
  detects resets, alerts (console + `CODEX_WEBHOOK_URL` + macOS notification).
  Suppresses the noisy 5h window by default (`--all-windows` to include it).
  Supports `--fixture <path>` (offline, no auth), `--emit-event` (writes to the
  tracker via `upsertEvent`), and `--test-alert` (fires a test notification and
  exits — useful for verifying webhooks without waiting for a real reset).
- **`scripts/lib/quota.mjs`** — pure detection logic; unit-verified for early
  refill, jitter (ignored), and reset-time-moved-earlier heads-up.
- **`scripts/lib/events.mjs`** — shared `upsertEvent` merge; independent reports
  about the same reset merge and raise confidence (suspected→community→official).
- **`scripts/collect.mjs`** — polls Reddit (r/codex, r/ChatGPT, r/OpenAI), OpenAI
  Status, and the X API (when `TWITTER_BEARER_TOKEN` is set) every 4h; feeds
  events through `upsertEvent`.
- **`scripts/issue-to-event.mjs`** + website form — community reports; both reject
  non-early resets (require `occurredAt < scheduledAt`).
- **`scripts/fixtures/`** + **`test/`** — anonymized real-schema fixtures and an `npm test`
  suite (32 tests) covering the detection, merge, and collector logic.
- **Website** (`app/`) — timeline of events with confidence + "days early" chip,
  stats row (total events, avg days early, most-affected plan, resets in 30 days),
  JSON/RSS feed endpoints at `/api/feed` and `/api/feed/rss`, live 24h banner
  (color-coded by confidence, links to #history), and a custom favicon.

## Backlog

1. **Enable X API ingestion** (code is done — this is an operator/setup step, no
   machine login needed). `scripts/collect.mjs` already has `fetchXApi()` and the
   collect workflow already passes the secret; it just needs the token:
   create a free read-only app at [developer.x.com](https://developer.x.com), then
   add its Bearer Token as the `TWITTER_BEARER_TOKEN` GitHub Actions secret. Full
   steps in the [README](../README.md#enable-x-api-ingestion). Until the secret is
   present the collector skips X silently.

   **Accounts watched** (`X_ACCOUNTS` in `collect.mjs`): `@thsottiaux` — posts
   early-reset observations with timestamps. Expand as you spot other reliable
   signal sources: search `codex quota reset` on X sorted by Latest, and check who
   replies first under OpenAI announcements about Codex.

## Gotchas

- The `~/.codex` on the original dev machine belongs to a _different_ tool — the
  real OpenAI Codex CLI stores `auth.json`/`config.toml`/`sessions/`.
- Reddit RSS is often blocked from datacenter IPs; the collector can go silent.
- Some "early resets" are OpenAI's user-triggered savable resets, not spontaneous;
  the monitor distinguishes an actual refill from a merely rescheduled date.
- Project rule: all project content (code, docs, comments, JSON values) in English.
