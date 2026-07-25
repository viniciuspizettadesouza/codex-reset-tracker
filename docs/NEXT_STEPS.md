# Next steps

Goal: **tell the user the moment their Codex weekly quota resets, especially
when it resets early.** See [VISION.md](VISION.md) for the product and trust-zone
architecture.

## ▶️ Immediate next milestone: Phase 4 — deploy and operate

1. Re-check the current Vercel Hobby and Neon Free limits before provisioning.
2. Create the Neon Free project and apply
   `db/migrations/001_live_quota.sql`.
3. Configure `DATABASE_URL` and `MONITOR_INGEST_TOKEN` in Vercel.
4. Generate a long random ingest token; never commit it or reuse Codex
   credentials.
5. Deploy the Next.js app to Vercel Hobby.
6. Configure the local machine with `CODEX_INGEST_URL` and
   `CODEX_INGEST_TOKEN`.
7. Run an end-to-end test with anonymized fixtures before sending real data.
8. Run the monitor unattended every 15 minutes using systemd/cron or:

   ```bash
   node scripts/monitor.mjs --watch --interval 900
   ```

9. Confirm that:
   - live snapshots and detected resets reach Neon;
   - the dashboard updates without exposing private fields;
   - duplicate uploads do not create duplicate rows;
   - snapshots older than 90 days are pruned;
   - turning off the monitor leaves the website online but marks it stale after
     30 minutes.

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
- Keep all project code, documentation, comments, and JSON values in English.
- Review current Codex/OpenAI terms before expanding automation beyond reading
  the user's own usage status.
