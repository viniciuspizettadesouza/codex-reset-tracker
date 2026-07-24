# Next steps / project handoff

Continuation notes so this project can be resumed in a fresh session without
re-deriving context. Goal: **tell the user the moment their Codex weekly quota
resets, especially when it resets early.** See [VISION.md](VISION.md) for the why
and [DATA_SOURCES.md](DATA_SOURCES.md) for the source landscape.

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
[README](../README.md#personal-quota-monitor).

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
- **`scripts/collect.mjs`** — polls Reddit (r/codex, r/ChatGPT, r/OpenAI) + OpenAI
  Status every 4h; feeds events through `upsertEvent`.
- **`scripts/issue-to-event.mjs`** + website form — community reports; both reject
  non-early resets (require `occurredAt < scheduledAt`).
- **`scripts/fixtures/`** + **`test/`** — best-guess usage fixtures and a `npm test`
  suite (15 tests) covering the detection + merge logic.
- **Website** (`app/`) — timeline of events with confidence + "days early" chip,
  stats row (total events, avg days early, most-affected plan, resets in 30 days),
  JSON/RSS feed endpoints at `/api/feed` and `/api/feed/rss`, live 24h banner
  (color-coded by confidence, links to #history), and a custom favicon.

## Backlog

1. **Lock the `/wham/usage` parser** to real field names (needs the `--raw` output).
   Replace the best-guess fixtures in `scripts/fixtures/` with a real snapshot.

2. **X API ingestion** — the collector is Reddit + OpenAI Status only.

   To add X: create an app at [developer.x.com](https://developer.x.com) (free tier, read-only Bearer Token).
   Add `TWITTER_BEARER_TOKEN` as a GitHub Actions secret, then expose it in the collect job:

```yaml
- name: Run collector
  env:
    TWITTER_BEARER_TOKEN: ${{ secrets.TWITTER_BEARER_TOKEN }}
  run: node scripts/collect.mjs
```

   Add `fetchXApi()` to `scripts/collect.mjs` using `GET https://api.twitter.com/2/tweets/search/recent`,
   params `tweet.fields=created_at&expansions=author_id&user.fields=username`, query:

```text
(codex quota reset OR codex limit reset OR from:thsottiaux) -is:retweet lang:en
```

   Map results to the same post shape as Reddit posts and feed into `clusterByWindow`.

   **Accounts to watch** — add these to the `from:` filter in the query above:

   | Handle        | Why                                                    |
   |---------------|--------------------------------------------------------|
   | `@thsottiaux` | Known to post early-reset observations with timestamps |

   Expand this table as you spot other reliable signal sources on X.
   Good places to look: search `codex quota reset` on X sorted by Latest,
   check who replies first under OpenAI announcements about Codex.

## Gotchas

- The `~/.codex` on the original dev machine belongs to a *different* tool — the
  real OpenAI Codex CLI stores `auth.json`/`config.toml`/`sessions/`.
- Reddit RSS is often blocked from datacenter IPs; the collector can go silent.
- Some "early resets" are OpenAI's user-triggered savable resets, not spontaneous;
  the monitor distinguishes an actual refill from a merely rescheduled date.
- Project rule: all project content (code, docs, comments, JSON values) in English.
