# Next steps

Goal: **tell the user the moment their Codex weekly quota resets, especially
when it resets early.** See [VISION.md](VISION.md) for the product and trust-zone
architecture.

## ▶️ Immediate next milestone: Phase 4 — deploy and operate

1. Configure the local machine with `CODEX_INGEST_URL` and
   `CODEX_INGEST_TOKEN`.
2. Run the monitor unattended every 15 minutes using the documented systemd
   user service, cron, or:

   ```bash
   npm run monitor -- --watch --interval 900
   ```

3. Confirm that:

- live snapshots and detected resets reach Neon;
- the dashboard updates without exposing private fields;
- duplicate uploads do not create duplicate rows;
- snapshots older than 90 days are pruned;
- turning off the monitor leaves the website online but marks it stale after
  30 minutes.

4. Review Neon storage, compute-hour, and network-transfer usage after the
    first day and weekly thereafter. Do not upgrade automatically if a limit is
    approached; optimize or reduce database reads first.
5. Create a weekly `pg_dump` of the sanitized database to private local
    storage and verify that it can be restored. Never include the Neon
    connection string or ingest token in the backup.

## Later backlog

Enable X API ingestion by adding `TWITTER_BEARER_TOKEN` as a GitHub Actions
secret. `scripts/collect.mjs` and the collection workflow already support it.
Expand `X_ACCOUNTS` when other reliable early-reset sources are identified.

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
