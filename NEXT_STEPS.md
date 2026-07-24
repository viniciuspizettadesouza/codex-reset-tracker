# Next steps / project handoff

Continuation notes so this project can be resumed in a fresh session without
re-deriving context. Goal: **tell the user the moment their Codex weekly quota
resets, especially when it resets early.** See [VISION.md](VISION.md) for the why
and [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) for the source landscape.

## ▶️ Immediate next action (do this first)

Run the personal monitor on the machine where you're logged into the Codex CLI
(your personal machine — Codex is **not** on the dev machine this repo was built on):

```bash
# Confirms auth works AND prints the real /wham/usage JSON:
node scripts/monitor.mjs --raw
```

Then **paste that JSON back** so the parser in `scripts/lib/quota.mjs` can be
locked to the exact field names (`used_percent`, `resets_at` / `resets_in_seconds`,
`window_minutes`, and how the primary/secondary windows are nested). Right now the
parser is defensive/best-effort because the payload shape is unconfirmed.

Once confirmed, run it for real:

```bash
node scripts/monitor.mjs                      # one poll, detect + alert, exit
node scripts/monitor.mjs --watch --interval 900   # keep watching every 15 min
```

To run unattended, schedule the one-shot form with cron/launchd, or leave the
`--watch` form running on an always-on host. Full options are in the
[README](README.md#personal-quota-monitor).

## Current state (what works)

- **`scripts/monitor.mjs`** — reads `~/.codex/auth.json`, GETs `/wham/usage`,
  detects resets, alerts (console + `CODEX_WEBHOOK_URL` + macOS notification).
  Suppresses the noisy 5h window by default (`--all-windows` to include it).
  Supports `--fixture <path>` (offline, no auth) and `--emit-event` (writes to the
  tracker via `upsertEvent`).
- **`scripts/lib/quota.mjs`** — pure detection logic; unit-verified for early
  refill, jitter (ignored), and reset-time-moved-earlier heads-up.
- **`scripts/lib/events.mjs`** — shared `upsertEvent` merge; independent reports
  about the same reset merge and raise confidence (suspected→community→official).
- **`scripts/collect.mjs`** — polls Reddit (r/codex, r/ChatGPT, r/OpenAI) + OpenAI
  Status every 4h; feeds events through `upsertEvent`.
- **`scripts/issue-to-event.mjs`** + website form — community reports; both reject
  non-early resets (require `occurredAt < scheduledAt`).
- **`scripts/fixtures/`** + **`test/`** — best-guess usage fixtures and a `npm test`
  suite (15 tests) covering the detection + merge logic.
- **Website** (`app/`) — timeline of events with confidence + "days early".

## Backlog (in priority order)

1. **Lock the `/wham/usage` parser** to real field names (needs the `--raw` output).
   Replace the best-guess fixtures in `scripts/fixtures/` with a real snapshot.
2. **Token refresh** — on 401 the monitor currently tells you to re-login. Add
   automatic refresh using `refresh_token` from `auth.json` (OpenAI OAuth token
   endpoint) so an unattended monitor survives token expiry.
3. **Alert channel** — pick the real one (Telegram bot / Discord / email). Generic
   webhook (`CODEX_WEBHOOK_URL`) already covers Discord/Slack/ntfy/Telegram-bot.
4. **Website analytics** (VISION #3) — stats row (total events, avg days early,
   most-affected plan, frequency) + live banner + RSS/JSON feed; style the
   `.daysEarly` span (currently unstyled).
5. **X/@thsottiaux ingestion** — hard to automate (API/auth); keep as a manual
   watch source unless a feasible feed is found.

### Done

- Feed detected resets into the tracker — `monitor.mjs --emit-event`.
- Offline testing — `--fixture` mode + `npm test`.

## Gotchas

- The `~/.codex` on the original dev machine belongs to a *different* tool — the
  real OpenAI Codex CLI stores `auth.json`/`config.toml`/`sessions/`.
- Reddit RSS is often blocked from datacenter IPs; the collector can go silent.
- Some "early resets" are OpenAI's user-triggered savable resets, not spontaneous;
  the monitor distinguishes an actual refill from a merely rescheduled date.
- Project rule: all project content (code, docs, comments, JSON values) in English.
