# Next steps

Goal: **tell the user the moment their Codex weekly quota resets, especially
when it resets early.** See [VISION.md](VISION.md) for the product and trust-zone
architecture and [OPERATIONS.md](OPERATIONS.md) for the production runbook and
completed verification record.

## ▶️ Immediate next milestone: Phase 4 — deploy and operate

1. Establish the first 24-hour Neon Free baseline:
   - record storage, active compute time, network transfer, and branch count;
   - confirm that the production compute still autosuspends after five minutes;
   - inspect query frequency and check for unexpected long-running queries;
   - record the dated results in [OPERATIONS.md](OPERATIONS.md), without
     connection strings, role names, project identifiers, or other secrets.
2. If the baseline projects close to a free-plan limit, optimize in this order:
   - verify that public dashboard reads are using the 15-minute server cache;
   - increase the public cache duration;
   - reduce history resolution or shorten the displayed history;
   - reduce hosted snapshot publishing frequency while keeping authoritative
     local polling at 15 minutes;
   - only reconsider providers after measuring the effect. Do not add billing
     or enable automatic upgrades.
3. Verify the first naturally scheduled weekly backup:
   - confirm the timer fired and the oneshot service succeeded;
   - confirm that a new custom-format dump exists with mode `600`;
   - inspect its catalog without printing the database connection;
   - keep the already tested restore procedure as the recovery check.
4. Observe the next complete Codex weekly-reset cycle end to end. Confirm that
   local detection, sanitized ingest, dashboard history, and any official
   corroboration agree. Do not manufacture another production reset event for
   this check.

## Next functional milestone: Phase 5 — deliver the alert

1. Choose a free notification destination supported by the existing monitor
   (for example ntfy, Discord, Telegram, or Slack) and store its webhook only in
   the private local monitor environment.
2. Run `npm run monitor -- --test-alert` and confirm that the notification
   reaches the intended device without exposing quota authentication or account
   identifiers.
3. Restart `codex-reset-tracker.service`, confirm it receives the webhook
   setting, and document the provider-neutral setup in
   [OPERATIONS.md](OPERATIONS.md). Do not commit the webhook URL.
4. Confirm delivery on the next real reset. Keep the local state and dashboard
   authoritative if notification delivery fails.

## Later backlog

- Add a backup-retention policy only after measuring local storage growth.
  Preserve enough generations to recover from delayed corruption.
- Keep X API ingestion disabled while it requires paid credits. Re-check pricing
  periodically; only add `TWITTER_BEARER_TOKEN` with an explicit spending
  decision and strict cap. Expand `X_ACCOUNTS` if other reliable early-reset
  sources are identified.

## Constraints for all remaining work

- Never upload the raw `/wham/usage` response.
- Never send or persist Codex access/refresh tokens, `auth.json`, email,
  `user_id`, or `account_id`.
- Keep `MONITOR_INGEST_TOKEN` separate from Codex authentication and rotatable.
- Derive remaining quota from `usedPercent`; do not accept or store it as an
  independent value.
- Keep local detection authoritative and functional when hosted publishing
  fails.
- Keep `monitor-state.json` local and uncommitted.
- Keep the database portable: use standard PostgreSQL schema and maintain a
  tested `pg_dump`/`pg_restore` path.
- Do not attach billing or enable automatic paid upgrades for project
  infrastructure.
- Keep all project code, documentation, comments, and JSON values in English.
- Review current Codex/OpenAI terms before expanding automation beyond reading
  the user's own usage status.
