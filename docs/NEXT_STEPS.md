# Next steps

Goal: **tell the user the moment their Codex weekly quota resets, especially
when it resets early.** See [VISION.md](VISION.md) for the product and trust-zone
architecture.

## ▶️ Immediate next milestone: Phase 2 — local publisher

Connect `scripts/monitor.mjs` to the authenticated hosted ingest endpoint:

```text
scripts/monitor.mjs
  → POST /api/monitor (Bearer ingest token)
  → Neon quota_snapshots / reset_events
  → dynamic quota card and history on the Next.js page
```

1. POST every successful weekly snapshot when both `CODEX_INGEST_URL` and
   `CODEX_INGEST_TOKEN` are configured.
2. Construct the version 1 payload from the normalized weekly window using only
   the fields accepted by `POST /api/monitor`.
3. Keep `monitor-state.json` local. It remains necessary for reset comparison
   and must never be committed or uploaded.
4. Treat upload failure as non-fatal: preserve local detection, print a clear
   warning, and retry with the next poll.
5. Show both quota representations in console output:
   `69% remaining (31% used)`.
6. Add unit and integration tests using a local mock HTTP server, covering:
   - publishing a normal weekly snapshot;
   - publishing detected reset metadata;
   - missing publisher configuration;
   - authentication or server failure;
   - retrying at the next poll without breaking local detection.
7. Run `npm test`, `npm run lint`, `npm run build`, and
   `npm audit --omit=dev`.

Publisher environment variables:

```text
CODEX_INGEST_URL            # e.g. https://…/api/monitor
CODEX_INGEST_TOKEN          # local copy of the dedicated ingest token
```

## Phase 3 — live website

1. Add server-side Neon queries for the latest snapshot and recent history.
2. Add a prominent live quota card with:
   - remaining and used percentages;
   - scheduled reset in the viewer's timezone;
   - `lastSeenAt`;
   - an explicit stale/offline state when no snapshot arrives for 30 minutes.
3. Add a small 7/30/90-day history chart and highlight detected resets.
4. Keep `data/resets.json` as the source for the existing community timeline.
5. Keep public responses sanitized and disable caching or use a short,
   intentional revalidation interval.
6. Add tests for empty, current, stale, and reset-event states.
7. Run `npm test`, `npm run lint`, `npm run build`, and
   `npm audit --omit=dev`.

## Phase 4 — deploy and operate

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
