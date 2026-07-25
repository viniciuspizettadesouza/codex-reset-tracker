# Next steps

Goal: **tell the user the moment their Codex weekly quota resets, especially
when it resets early.** See [VISION.md](VISION.md) for the product and trust-zone
architecture.

## ▶️ Immediate next milestone: Phase 4 — deploy and operate

1. Configure `MONITOR_INGEST_TOKEN` in the Vercel production environment.
   `DATABASE_URL` is already provided by the Neon integration.
2. Generate a long random ingest token; never commit it or reuse Codex
   credentials.
3. Redeploy the Next.js app on Vercel Hobby so the production deployment
   receives all configured environment variables.
4. Configure the local machine with `CODEX_INGEST_URL` and
   `CODEX_INGEST_TOKEN`.
5. Run an end-to-end test with anonymized fixtures before sending real data.
6. Run the monitor unattended every 15 minutes using systemd/cron or:

   ```bash
   npm run monitor -- --watch --interval 900
   ```

7. Confirm that:

- live snapshots and detected resets reach Neon;
- the dashboard updates without exposing private fields;
- duplicate uploads do not create duplicate rows;
- snapshots older than 90 days are pruned;
- turning off the monitor leaves the website online but marks it stale after
  30 minutes.

8. Review Neon storage, compute-hour, and network-transfer usage after the
    first day and weekly thereafter. Do not upgrade automatically if a limit is
    approached; optimize or reduce database reads first.
9. Create a weekly `pg_dump` of the sanitized database to private local
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
