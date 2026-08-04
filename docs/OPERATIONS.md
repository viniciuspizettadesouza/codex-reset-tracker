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
- `~/.config/codex-reset-tracker/dashboard.env` contains only the optional
  public hosted-status URL and no credentials.
- `~/.codex-reset-tracker/monitor-state.json` is the local detection state.
- `~/.codex-reset-tracker/backups/` contains private sanitized database dumps.
- No environment file or local data path belongs in Git.

## Local operations dashboard

The dashboard is a separate read-only process. It reads the sanitized local
monitor state, listens only on `127.0.0.1:3001`, and does not receive
`CODEX_INGEST_TOKEN`, Codex authentication, or the database connection string.
Its optional environment file is
`~/.config/codex-reset-tracker/dashboard.env` and may contain only:

```text
CODEX_REMOTE_STATUS_URL=https://codex-reset-tracker.vercel.app/api/quota/latest
```

Build and install the user service from the repository root:

```bash
npm run build
install -d -m 700 "$HOME/.config/codex-reset-tracker" \
  "$HOME/.config/systemd/user"
tracker_repository="$(pwd -P)"
node_path="$(command -v node)"
sed \
  -e "s|@REPOSITORY_PATH@|$tracker_repository|g" \
  -e "s|@NODE_PATH@|$node_path|g" \
  ops/systemd/codex-reset-tracker-dashboard.service.template \
  > "$HOME/.config/systemd/user/codex-reset-tracker-dashboard.service"
systemctl --user daemon-reload
systemctl --user enable --now codex-reset-tracker-dashboard.service
```

Open `http://127.0.0.1:3001/local`. Verify that the service is loopback-only:

```bash
systemctl --user status codex-reset-tracker-dashboard.service
ss -ltnp | grep ':3001'
journalctl --user -u codex-reset-tracker-dashboard.service -n 50 --no-pager
```

After pulling application changes, rebuild before restarting because the
service uses the production Next.js server:

```bash
npm install
npm run build
systemctl --user restart codex-reset-tracker.service
systemctl --user restart codex-reset-tracker-dashboard.service
```

Dashboard health is derived from the monitor's configured polling interval:

- **Healthy:** the last successful local poll is no older than 1.5 polling
  intervals, there are no consecutive failures, and the upload queue is empty.
- **Degraded:** the latest poll is delayed, a poll or upload partially failed,
  or sanitized uploads are waiting to retry.
- **Offline:** no successful poll exists or the latest success is older than two
  polling intervals.

Remote comparison is informational. `Hosted snapshot unavailable` does not
change local health. For `Hosted snapshot behind`, inspect the queue and monitor
logs. For `Degraded` with an empty queue, inspect recent errors and verify Codex
CLI authentication. For `Offline`, check the monitor service before the
dashboard service:

```bash
systemctl --user status codex-reset-tracker.service
journalctl --user -u codex-reset-tracker.service -n 50 --no-pager
```

The monitor retains seven days of local poll telemetry. State writes use a
private temporary file and atomic rename. A malformed state file is moved to a
mode-`600` `.corrupt-<timestamp>` backup before monitoring starts with a clean
state; inspect that backup locally and never publish it.

## Direct Neon connection

The application uses the pooled `DATABASE_URL` supplied to Vercel. Database
maintenance uses a separate direct, or unpooled, connection because
`pg_dump`/`pg_restore` require a normal PostgreSQL session.

To obtain the direct connection:

1. Open the production database project in Neon.
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

## Telegram notifications

Telegram is the selected reset-notification channel. The bot is created through
the official `@BotFather`, and the intended user must open the new bot and send
`/start` before the bot can send messages to that private chat.

The Telegram Bot API `getUpdates` method can then identify the private
`message.chat.id`. Do not paste the API response into chat or documentation
because it can contain Telegram profile and message metadata.

Store these settings only in
`~/.config/codex-reset-tracker/monitor.env`:

```dotenv
CODEX_WEBHOOK_URL=https://api.telegram.org/bot<bot-token>/sendMessage
CODEX_TELEGRAM_CHAT_ID=<private-chat-id>
```

The bot token is embedded in the API URL and grants control of the bot. Never
commit, log, screenshot, or share either real value. Keep the environment file
private:

```bash
chmod 600 "$HOME/.config/codex-reset-tracker/monitor.env"
stat -c '%a %n' "$HOME/.config/codex-reset-tracker/monitor.env"
```

Test the notification inside a subshell so the sourced secrets do not remain in
the interactive shell:

```bash
(
  set -a
  source "$HOME/.config/codex-reset-tracker/monitor.env"
  set +a
  npm run monitor -- --test-alert
)
```

After a successful delivery, restart the monitor and verify its sanitized
status:

```bash
systemctl --user restart codex-reset-tracker.service
systemctl --user is-active codex-reset-tracker.service
journalctl --user -u codex-reset-tracker.service -n 10 --no-pager
```

Telegram receives only the alert title and message: quota percentages, reset
timing, and whether the reset was early. It never receives Codex authentication,
account identifiers, the raw usage payload, the Neon connection, or the ingest
token.

The first Telegram test notification was delivered successfully on 2026-07-25.
The monitor service was then restarted and verified `enabled` and `active`.
Delivery on the next real reset remains the end-to-end notification check.

## Secret rotation

To rotate the ingest token, update the same value in Vercel Production and
`monitor.env`, then restart the continuous monitor:

```bash
systemctl --user restart codex-reset-tracker.service
```

To rotate Neon credentials, replace only `BACKUP_DATABASE_URL` in `backup.env`,
confirm mode `600`, and run an immediate backup through the oneshot service.
Vercel-managed application variables may require a production redeployment.

To rotate the Telegram bot token, regenerate it through the official
`@BotFather`, replace only the token portion of `CODEX_WEBHOOK_URL`, run the test
alert again, and restart the monitor. The previous token must no longer be used.

Never reuse the Codex access token, refresh token, or ingest token as a database
credential.

## Public repository security

The source repository is public at
`https://github.com/viniciuspizettadesouza/codex-reset-tracker`.

Before publication on 2026-07-25:

- an MIT license and private vulnerability-reporting policy were added;
- the production Neon project name was generalized in public documentation;
- all 31 commits were rewritten to use the GitHub noreply author address;
- every commit on the rewritten default branch was scanned for high-confidence
  credential formats and sensitive filenames;
- the rewritten tree passed tests, lint, production build, and `npm audit`;
- the history was force-pushed while the repository was still private;
- GitHub Secret Scanning, Push Protection, and Private Vulnerability Reporting
  were enabled before considering publication complete.

A mode-`600` recovery bundle of the pre-publication history is stored privately
under `~/.codex-reset-tracker/history-backups/`. It contains the former commit
metadata and must never be committed, uploaded, or shared. Any old clone created
before the rewrite must be replaced rather than pushed.

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
- The repository was published with sanitized history and GitHub security
  protections enabled.
- A Telegram test alert reached the intended private chat.
- The continuous monitor restarted with Telegram configured and remained active.

Still pending:

- review Neon free-tier usage after the first full day and weekly thereafter.
- confirm Telegram delivery on the next real reset.
