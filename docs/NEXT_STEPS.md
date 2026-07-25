# Next steps

Goal: **tell the user the moment their Codex weekly quota resets, especially
when it resets early.** See [VISION.md](VISION.md) for the product and trust-zone
architecture.

## ▶️ Immediate next milestone: Phase 4 — deploy and operate

1. Review Neon storage, compute-hour, and network-transfer usage after the
   first day and weekly thereafter. Do not upgrade automatically if a limit is
   approached; optimize or reduce database reads first.
2. Create a weekly `pg_dump` of the sanitized database to private local storage
   and verify that it can be restored. Never include the Neon connection string
   or ingest token in the backup.

## Later backlog

Keep X API ingestion disabled while it requires paid credits. Re-check pricing
periodically; only add `TWITTER_BEARER_TOKEN` with an explicit spending decision
and strict cap. Expand `X_ACCOUNTS` if other reliable early-reset sources are
identified.

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
