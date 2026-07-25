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

## ▶️ Immediate next milestone: hosted live quota

Build the connection between the local monitor and the always-online website.
Use **Vercel Hobby + Neon Postgres Free** for the first version. Keep
`data/resets.json` for the existing community timeline during this milestone.

### Target flow

```text
scripts/monitor.mjs
  → POST /api/monitor (Bearer ingest token)
  → Neon quota_snapshots / reset_events
  → dynamic quota card and history on the Next.js page
```

### Phase 0 — security baseline

1. Upgrade Next.js from `16.2.10` to at least `16.2.11`. The July 2026
   `npm audit --omit=dev` reported three high-severity production dependency
   groups (`next`, `postcss`, and `sharp`) resolved by that upgrade.
2. Run `npm test`, `npm run lint`, and `npm run build` in a dedicated commit
   before adding the public ingest endpoint.

### Phase 1 — persistence and authenticated ingest

1. Add the Neon database dependency and a committed SQL migration. Current free
   plan references: [Vercel Hobby](https://vercel.com/docs/plans/hobby) and
   [Neon Free](https://neon.com/pricing).
2. Create `quota_snapshots` with at least:
   `id`, `observed_at`, `used_percent`, `reset_at`, `window_seconds`,
   `reset_detected`, and `created_at`.
3. Create `reset_events` for detected refill metadata:
   `detected_at`, `expected_reset_at`, `new_reset_at`, `hours_early`,
   `previous_used_percent`, and `current_used_percent`.
4. Add `POST /api/monitor`:
   - authenticate `Authorization: Bearer <MONITOR_INGEST_TOKEN>`;
   - validate a versioned JSON payload and reject unknown/invalid values;
   - derive `remainingPercent = 100 - usedPercent` on the server/UI;
   - make retries idempotent;
   - never accept or persist Codex tokens, email, `user_id`, or `account_id`.
5. Add route tests for unauthorized, invalid, successful, and duplicate posts.

Recommended environment variables:

```text
DATABASE_URL                 # Vercel and local web development
MONITOR_INGEST_TOKEN         # Vercel API authentication
CODEX_INGEST_URL             # local monitor, e.g. https://…/api/monitor
CODEX_INGEST_TOKEN           # local copy of the ingest token
```

### Phase 2 — local publisher

1. Extend `scripts/monitor.mjs` to POST every successful weekly snapshot when
   `CODEX_INGEST_URL` and `CODEX_INGEST_TOKEN` are configured.
2. Keep the current local `monitor-state.json`; it remains necessary for reset
   comparison and is never committed or uploaded.
3. Treat upload failure as non-fatal: preserve local detection, print a clear
   warning, and retry at the next poll.
4. Show both representations in console output:
   `69% remaining (31% used)`.
5. Add unit/integration tests using a local mock HTTP server.

### Phase 3 — live website

1. Add server-side queries for the latest snapshot and recent history.
2. Add a prominent live quota card with:
   - remaining and used percentages;
   - scheduled reset in the viewer's timezone;
   - `lastSeenAt`;
   - an explicit stale/offline state when no snapshot arrives for 30 minutes.
3. Add a small 7/30/90-day history chart and highlight detected resets.
4. Keep public responses sanitized and disable caching or use a short,
   intentional revalidation interval.

### Phase 4 — deploy and operate

1. Create the Neon Free project and run the migration.
2. Configure Vercel environment variables and deploy on Hobby.
3. Generate a long random ingest token; never commit it.
4. Configure the local machine with `CODEX_INGEST_URL` and
   `CODEX_INGEST_TOKEN`.
5. Run an end-to-end test with fixtures before sending real data.
6. Run the monitor unattended every 15 minutes using systemd/cron or:

   ```bash
   node scripts/monitor.mjs --watch --interval 900
   ```

7. Confirm that turning off the monitor leaves the website online but changes
   the quota card to stale after 30 minutes.

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

## Later backlog

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

- The current website imports/reads `data/resets.json`; a Vercel deployment
  cannot be updated by writing to its local filesystem. Live monitor data must
  go through the hosted database.
- Do not upload the raw `/wham/usage` response. It contains personal account
  fields. Construct an allow-listed payload from the normalized weekly window.
- Vercel Hobby is for personal, non-commercial use. The current expected load
  (about 2,880 monitor requests/month at a 15-minute interval) is small, but
  re-check provider limits when provisioning.
- The `~/.codex` on the original dev machine belongs to a _different_ tool — the
  real OpenAI Codex CLI stores `auth.json`/`config.toml`/`sessions/`.
- Reddit RSS is often blocked from datacenter IPs; the collector can go silent.
- Some "early resets" are OpenAI's user-triggered savable resets, not spontaneous;
  the monitor distinguishes an actual refill from a merely rescheduled date.
- Project rule: all project content (code, docs, comments, JSON values) in English.
