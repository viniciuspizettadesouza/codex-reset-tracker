# Operations runbook

This runbook covers the production monitor, hosted dashboard, direct Neon
maintenance connection, private backups, restore verification, and routine
checks. It intentionally contains no real connection strings, passwords,
tokens, account identifiers, or Codex authentication data.

## Production layout

```text
Codex auth and quota endpoint (personal WSL machine)
  → codex-reset-tracker.service
  → sanitized authenticated POST
  → https://codex-reset-tracker.vercel.app/api/monitor
  → Neon Postgres
  → https://codex-reset-tracker.vercel.app/

Neon Postgres
  → direct TLS connection used only by pg_dump/pg_restore
  → codex-reset-tracker-backup.service
  → private local custom-format dumps
```

The monitor and backup paths are deliberately separate:

- `~/.config/codex-reset-tracker/monitor.env` contains only the hosted ingest
  URL and dedicated ingest token.
- `~/.config/codex-reset-tracker/backup.env` contains only
  `BACKUP_DATABASE_URL`, using the direct Neon connection.
- `~/.codex-reset-tracker/monitor-state.json` is the local detection state.
- `~/.codex-reset-tracker/backups/` contains private sanitized database dumps.
- Neither environment file nor either local data path belongs in Git.

## Direct Neon connection

The application uses the pooled `DATABASE_URL` supplied to Vercel. Database
maintenance uses a separate direct, or unpooled, connection because
`pg_dump`/`pg_restore` require a normal PostgreSQL session.

To obtain the direct connection:

1. Open the `codex-tracker-db` project in Neon.
2. Select the `main` branch.
3. Select the production database and owner role.
4. Click **Connect** in the upper-left project navigation.
5. Select **Direct connection**, or disable **Connection pooling**.
6. Copy the connection string without displaying or sharing it elsewhere.

The direct hostname must not contain `-pooler`. The backup helper rejects pooled
hostnames. Both kinds of connection are TLS-protected, but the direct URL grants
database-owner access and must be treated as a secret.

Store it locally through a hidden prompt:

```bash
install -d -m 700 \
  "$HOME/.config/codex-reset-tracker" \
  "$HOME/.codex-reset-tracker/backups"
read -rsp "Neon unpooled database URL: " BACKUP_DATABASE_URL; echo
umask 077
printf 'BACKUP_DATABASE_URL=%s\n' "$BACKUP_DATABASE_URL" \
  > "$HOME/.config/codex-reset-tracker/backup.env"
unset BACKUP_DATABASE_URL
stat -c '%a %n' "$HOME/.config/codex-reset-tracker/backup.env"
```

The expected file mode is `600`. Never put the direct URL in `.env.local`,
command history, issue text, chat, logs, or a committed file.

`scripts/lib/postgres-connection.mjs` validates and splits the URL into libpq
environment variables. This keeps the full URL and password out of
`pg_dump`/`pg_restore` command arguments. Those variables exist only for the
maintenance process.

## PostgreSQL client

The Neon database was verified as PostgreSQL 17.10 on 2026-07-25:

```sql
SHOW server_version;
```

The WSL machine uses the matching PostgreSQL 17.10 client from the official
PostgreSQL APT repository. Check it with:

```bash
pg_dump --version
pg_restore --version
psql --version
```

All three tools should report PostgreSQL 17. Major versions must remain
compatible after a future Neon upgrade.

## Manual backup

Run a backup without printing the secret:

```bash
BACKUP_DATABASE_URL="$(
  sed -n 's/^BACKUP_DATABASE_URL=//p' \
    "$HOME/.config/codex-reset-tracker/backup.env"
)"
export BACKUP_DATABASE_URL
npm run backup:db
unset BACKUP_DATABASE_URL
```

`scripts/backup-db.sh`:

- sets `umask 077`;
- requires a direct PostgreSQL URL;
- dumps only `public.quota_snapshots` and `public.reset_events`;
- includes their owned sequences, constraints, indexes, and foreign key;
- uses PostgreSQL custom format;
- excludes ownership and privilege restoration;
- validates the archive catalog with `pg_restore --list`;
- writes through a `.partial` file and removes it on failure;
- moves a successful dump into
  `~/.codex-reset-tracker/backups/codex-reset-tracker-<UTC timestamp>.dump`;
- sets the completed file to mode `600`.

No Codex token, `auth.json`, email, account identifier, raw `/wham/usage`
payload, ingest token, or Neon connection string is present in the dump.

Inspect backups without exposing credentials:

```bash
find "$HOME/.codex-reset-tracker/backups" \
  -maxdepth 1 -type f -printf '%m %s %f\n' | sort
pg_restore --list \
  "$HOME/.codex-reset-tracker/backups/<backup>.dump"
```

Backups are not deleted automatically. Review local storage periodically and
retain enough generations to recover from delayed corruption or accidental
deletion.

## Weekly systemd backup

Installed user units:

- `~/.config/systemd/user/codex-reset-tracker-backup.service`
- `~/.config/systemd/user/codex-reset-tracker-backup.timer`

Repository sources:

- `ops/systemd/codex-reset-tracker-backup.service.template`
- `ops/systemd/codex-reset-tracker-backup.timer`

Install or refresh them from the repository root:

```bash
tracker_repository="$(pwd -P)"
sed "s|@REPOSITORY_PATH@|$tracker_repository|g" \
  ops/systemd/codex-reset-tracker-backup.service.template \
  > "$HOME/.config/systemd/user/codex-reset-tracker-backup.service"
install -m 600 \
  ops/systemd/codex-reset-tracker-backup.timer \
  "$HOME/.config/systemd/user/codex-reset-tracker-backup.timer"

systemctl --user daemon-reload
systemctl --user enable --now codex-reset-tracker-backup.timer
```

The timer is weekly, persistent, and adds up to one hour of randomized delay.
If WSL was offline at the scheduled time, systemd runs the missed timer after
the user manager starts.

Check it with:

```bash
systemctl --user is-enabled codex-reset-tracker-backup.timer
systemctl --user is-active codex-reset-tracker-backup.timer
systemctl --user list-timers codex-reset-tracker-backup.timer --no-pager
journalctl --user -u codex-reset-tracker-backup.service -n 20 --no-pager
```

The timer should be `enabled` and `active`. The service normally shows
`inactive (dead)` after a successful run because it is a `Type=oneshot` unit.
The journal must show `Finished ... Back up sanitized Codex quota data`.

Run an immediate backup through the hardened unit:

```bash
systemctl --user start codex-reset-tracker-backup.service
journalctl --user -u codex-reset-tracker-backup.service -n 10 --no-pager
```

## Restore verification

A catalog check proves that an archive is readable; a disposable database
restore proves that it is actually restorable.

Create an empty Neon database named
`codex_reset_tracker_restore_<suffix>`. Build a direct connection string that
points to that database, then run:

```bash
read -rsp "Disposable restore database URL: " RESTORE_DATABASE_URL; echo
export RESTORE_DATABASE_URL
npm run backup:verify -- \
  "$HOME/.codex-reset-tracker/backups/<backup>.dump"
unset RESTORE_DATABASE_URL
```

`scripts/verify-db-restore.sh` refuses to continue unless:

- the destination database name starts with `codex_reset_tracker_restore_`;
- the destination contains no existing public tables;
- the connection is direct rather than pooled;
- the expected sanitized tables exist after restoration.

Never point this command at production. Delete the disposable database only
after the script reports a successful restore.

The first full restore test completed successfully on 2026-07-25. It restored
both sanitized tables into `codex_reset_tracker_restore_20260725`; that database
was then deleted. Production was not modified.

## Monitor operations

Check the continuous monitor after starting WSL:

```bash
systemctl --user is-enabled codex-reset-tracker.service
systemctl --user is-active codex-reset-tracker.service
journalctl --user -u codex-reset-tracker.service -n 10 --no-pager
```

Expected state is `enabled` and `active`. If it is inactive:

```bash
systemctl --user start codex-reset-tracker.service
```

The monitor publishes every 15 minutes. Its journal logs sanitized percentages,
scheduled reset time, reset detection, and publish result, but no authentication
values.

On 2026-07-25, a controlled production test stopped the monitor for more than 30
minutes. The public page stayed online, changed to `Monitor offline`, displayed
the stale-data warning, and recovered after the service restarted and published
the next snapshot.

## Secret rotation

To rotate the ingest token, update the same value in Vercel Production and
`monitor.env`, then restart the continuous monitor:

```bash
systemctl --user restart codex-reset-tracker.service
```

To rotate Neon credentials, replace only `BACKUP_DATABASE_URL` in `backup.env`,
confirm mode `600`, and run an immediate backup through the oneshot service.
Vercel-managed application variables may require a production redeployment.

Never reuse the Codex access token, refresh token, or ingest token as a database
credential.

## Neon free-tier review

After the first 24 hours and weekly thereafter, open the Neon project and review:

- storage used by the two sanitized tables and indexes;
- active compute time and autosuspend behavior;
- network transfer;
- query frequency and long-running queries.

Do not add billing or enable automatic upgrades. If usage approaches a free
limit, first reduce dashboard read frequency, increase cache duration, reduce
history resolution, or lower monitor publish frequency while keeping local
detection at 15 minutes.

## Operational verification record

Completed on 2026-07-25:

- Vercel production deployment returned the live dashboard.
- Neon production variables were applied.
- A live sanitized snapshot was created and duplicate ingest was idempotent.
- The monitor survived a Windows/WSL restart and resumed publishing.
- An early weekly reset was detected locally and published.
- The reset was corroborated with an official public X post.
- A controlled pause produced the expected stale/offline website state.
- PostgreSQL 17.10 client tools were installed.
- Two private custom-format backups were created with mode `600`.
- The backup catalog contained only the two sanitized tables and dependencies.
- A real disposable-database restore succeeded.
- The disposable restore database was deleted.
- The weekly backup timer was enabled and verified active.

Still pending:

- review Neon free-tier usage after the first full day and weekly thereafter.
