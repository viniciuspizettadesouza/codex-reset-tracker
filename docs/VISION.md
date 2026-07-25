# Codex Quota Watch — Project Vision

## The problem

Codex enforces a weekly usage quota. When it runs out, the app shows a scheduled
renewal date — "your quota renews on July 27" — and the user is blocked until then.

The catch: this renewal **sometimes happens before the stated deadline**, with no
warning. You only find out by accident — you happen to open Codex days later and
the quota is already full. So you either waste days you could have been working,
or you keep manually checking. Neither is acceptable.

## The mission

**Tell me the moment my Codex quota comes back — especially if it comes back early —
so I stop guessing and get back to work.**

Concretely, a monitor that:

1. Watches my own Codex account's quota state on a schedule.
2. Detects the instant the weekly quota refills.
3. Alerts me immediately, and flags whether the reset beat its scheduled date
   (and by how much).
4. Keeps a personal history so I can see whether early resets are a pattern for
   my account, how early they tend to be, and whether it's worth waiting.
5. Publishes sanitized quota snapshots to an always-online dashboard without
   exposing Codex credentials or account identifiers.

## The data source — this is the point

Rumors (Reddit, forums) and the OpenAI status page cannot answer this: OpenAI does
not announce early renewals, and a stranger's report is not my account. The only
authoritative source is **Codex itself**.

The monitor reads the quota the same way the Codex client does:

- **Endpoint:** `GET https://chatgpt.com/backend-api/wham/usage` — returns the
  current rate-limit windows with percent used and reset timing. The observed
  payload uses `rate_limit.primary_window` / `secondary_window`; the weekly
  window is identified by its seven-day `limit_window_seconds`, not by assuming
  that "primary" or "secondary" always means a particular duration.
- **Auth:** `Authorization: Bearer <access_token>` + `ChatGPT-Account-Id: <account_id>`,
  both read from the `auth.json` that the Codex CLI writes at login
  (`$CODEX_HOME/auth.json`, default `~/.codex/auth.json`).
- **Detection:** compare consecutive snapshots. A sharp drop in "percent used" is
  a refill; if it happens before the reset time we were previously told, it was
  early — with an exact "hours early" figure.

This gives first-party, precise data. Public sources are demoted to optional
corroboration, not the primary signal.

## How it runs

One account is enough. The monitor runs where I'm logged into Codex — my personal
machine, or a small always-on host I've run `codex login` on once — on a schedule
(cron / launchd) or in a `--watch` loop. When it detects a reset it notifies me
via console, a webhook (Discord / Slack / ntfy / Telegram bot), and a native
desktop notification.

The product is split into two trust zones:

```text
Personal machine                   Public cloud
Codex CLI auth                     Vercel-hosted Next.js app
      ↓                                      ↓
Local monitor ── sanitized POST ──→ authenticated ingest API
      ↓                                      ↓
Local detection state                    Neon Postgres
                                             ↓
                                      Online dashboard
```

- **Local monitor:** owns Codex authentication, polls `/wham/usage`, keeps the
  previous snapshot needed for reset detection, and remains authoritative.
- **Hosted API:** accepts a small versioned payload authenticated with a
  dedicated ingest secret. It never receives `auth.json`, access/refresh tokens,
  email, `user_id`, or `account_id`.
- **Hosted database:** stores sanitized snapshots and detected reset events.
  Initial target: Neon Postgres Free with a 90-day snapshot retention policy.
- **Online dashboard:** runs continuously on Vercel Hobby, reads the latest
  snapshot dynamically, and shows remaining quota, reset time, last update,
  stale/offline state, and recent history.

The existing `data/resets.json` community timeline remains in place during the
first hosted-data milestone. Moving that timeline into Postgres can happen
later, after the personal live dashboard is working end to end.

At a 15-minute polling interval the monitor sends about 2,880 snapshots per
month, comfortably within the expected free-tier scale of this personal,
non-commercial project. Free-plan limits can change and should be checked again
before production setup.

## Why early resets happen (context)

These resets are real and mostly deliberate. In recent weeks OpenAI performed
early resets — sometimes for specific users, sometimes for _all_ paid plans — to
compensate for problems in the usage-accounting system (e.g. Codex depleting
quota faster than it should). The common causes:

- **Global reset by OpenAI** to make up for a usage/accounting problem.
- **Bug fixes** in the credit-accounting system.
- **Temporary limit-policy changes** during infra testing or adjustments.

So the scheduled date shown in the usage panel is the best reference, but it is
**not a guarantee** — OpenAI can pull it forward without notice. That unpredictability
is exactly what this project exists to catch.

## The wider data-source landscape

The personal monitor (`/wham/usage`) is the authoritative, first-party signal.
Everything below is **secondary / corroboration** — useful to explain _why_ a
reset happened or to catch resets on accounts we don't monitor:

- **Codex usage panel** — `https://chatgpt.com/codex/settings/usage` — the most
  complete view: weekly usage, next reset time, other limits. This is what
  `/wham/usage` backs.
- **Limit banner** in the app, e.g. _"Your rate limit resets on Jul 23, 2026,
  1:13 PM."_ Same data, shown when near/at the limit.
- **@thsottiaux on X** (Thibault Sottiaux, Codex lead) — ⭐ where extraordinary
  global resets are usually announced _first_, e.g. _"I have reset Codex rate
  limits for ALL paid plans…"_. There is no official reset changelog, so this is
  the closest thing to an announcement channel.
- **OpenAI Status** — `https://status.openai.com` — when a reset is tied to an
  incident (e.g. the June 2026 "usage limits depleting faster than expected"),
  it shows up here. Polled by `scripts/collect.mjs`.
- **Reddit r/codex** (primary), r/ChatGPT, r/OpenAI — the community often notices
  a reset within minutes, frequently before any official word. Polled by
  `scripts/collect.mjs`.
- **openai/codex GitHub issues** — users have requested that the usage UI show
  special reset events and affected intervals (issues #20395, #20583); these are
  not implemented, which is the gap this project fills.

What does **not** exist anywhere today: a reset changelog, a per-account reset
history, an in-app "your quota was reset" notification, or a page listing all
extraordinary resets. Reference links are collected in [DATA_SOURCES.md](DATA_SOURCES.md).

## Where the community tracker fits

The public tracker (this repo's website) has two related views:

1. A live, sanitized view of the monitored account's quota and recent history.
2. A community timeline where anonymized early-reset events and independent
   reports merge to raise confidence.

The live view is the next implementation milestone. The community timeline
already exists and can continue using `data/resets.json` until a later database
migration.

## Known caveats

- **One account, one machine.** The monitor needs valid Codex credentials on the
  host it runs on; it cannot see accounts it isn't logged into.
- **Public quota visibility.** The first dashboard is public by design and must
  contain only the explicitly sanitized fields. If exact personal quota usage
  should become private, add viewer authentication before publishing it.
- **Monitor availability.** The hosted page stays online when the personal
  machine is off, but its data stops changing. The UI must display `lastSeenAt`
  and clearly mark data stale after a configurable threshold.
- **Ingest authentication.** `MONITOR_INGEST_TOKEN` is separate from Codex auth,
  stored only in the local monitor environment and Vercel environment variables,
  and must be rotatable without changing Codex credentials.
- **Token expiry.** `auth.json`'s access token expires periodically. The monitor
  attempts an automatic refresh using the `refresh_token` from `auth.json` before
  giving up; if refresh fails, it reports a clear error and asks you to run
  `codex login`.
- **Official resets exist.** OpenAI shipped a savable rate-limit reset feature
  (`/wham/rate-limit-reset-credits`) on 2026-06-12. Some "early renewals" people
  report may be these user-triggered resets rather than spontaneous ones — the
  monitor distinguishes an actual refill from a merely rescheduled reset date.
- **Terms of service.** Polling your own account's usage status periodically is
  low-risk, but review current Codex/OpenAI terms before automating anything
  beyond reading.

## What this project is not

- Not a real-time Codex availability or latency monitor.
- It stores quota snapshots, but only creates public timeline events for
  noteworthy/early resets rather than routine on-schedule renewals.
- Not affiliated with OpenAI and has no access to internal data.
