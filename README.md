# Codex Reset Tracker

Know the moment your Codex weekly quota resets — especially when it resets **early**.
See [docs/VISION.md](docs/VISION.md) for the goal, [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md) to continue
the project, and [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) for the data sources.

## ▶️ Start here: run the monitor

On the machine where you're logged into the Codex CLI:

```bash
npm run monitor:raw    # confirm auth + capture the real usage payload
npm run monitor        # one poll: show quota, detect a reset, and publish if configured
```

Details and unattended scheduling are under
[Personal quota monitor](#personal-quota-monitor) below; the full plan is in
[docs/NEXT_STEPS.md](docs/NEXT_STEPS.md).

## Run the website locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Local operations dashboard

The read-only local dashboard shows monitor health, the weekly quota, seven days
of poll history, recent sanitized errors, the upload queue, and optional hosted
snapshot synchronization. It never exposes Codex credentials, raw usage
responses, account identifiers, or queued payload contents.

For development, start it on the loopback interface:

```bash
npm run dashboard:local
```

Open `http://127.0.0.1:3001/local`. The local page and its status API return
`404` unless `LOCAL_DASHBOARD_ENABLED=1`, and the provided command never listens
on a LAN-facing address.

The installed dashboard service uses a separate, optional environment file. It
must not contain the monitor ingest token:

```bash
install -d -m 700 \
  "$HOME/.config/codex-reset-tracker" \
  "$HOME/.config/systemd/user"
umask 077
printf 'CODEX_REMOTE_STATUS_URL=%s\n' \
  'https://codex-reset-tracker.vercel.app/api/quota/latest' \
  > "$HOME/.config/codex-reset-tracker/dashboard.env"

npm run build
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

Run `npm run build` and restart both the monitor and dashboard services after
updating the application so the long-running monitor loads the new telemetry
code. See [docs/OPERATIONS.md](docs/OPERATIONS.md) for health-state and
troubleshooting details.

## Personal quota monitor

`scripts/monitor.mjs` watches your own Codex account and alerts you when the
weekly quota refills — flagging whether it reset early. Run it on the machine
where you're logged into the Codex CLI. See [docs/VISION.md](docs/VISION.md) for the why.

```bash
# 1. First, capture the exact usage payload shape (also confirms auth works):
npm run monitor:raw

# 2. Run a single poll (detects + alerts, then exits):
npm run monitor

# 3. Or keep watching every 15 minutes:
npm run monitor -- --watch --interval 900

# Check the real quota without publishing:
env -u CODEX_INGEST_URL -u CODEX_INGEST_TOKEN npm run monitor

# Run safely with an anonymized offline fixture:
npm run monitor:fixture
```

Configuration via environment variables (all optional):

- `CODEX_HOME` — where `auth.json` lives (default `~/.codex`). Or pass `--auth <path>`.
- `CODEX_WEBHOOK_URL` — POST alerts to a Discord / Slack / Telegram-bot / ntfy webhook. The platform is auto-detected from the URL.
- `CODEX_TELEGRAM_CHAT_ID` — required when `CODEX_WEBHOOK_URL` points to a Telegram bot API URL.
- `CODEX_MONITOR_STATE` — where snapshots are stored (default `~/.codex-reset-tracker/monitor-state.json`).
- `CODEX_INGEST_URL` — hosted ingest endpoint, such as
  `https://example.vercel.app/api/monitor`.
- `CODEX_INGEST_TOKEN` — dedicated ingest secret. Set both ingest variables to
  publish sanitized weekly snapshots.
- `CODEX_PLAN` — your plan (Plus / Pro / Team …), used when emitting events.

Flags:

- `--watch --interval <sec>` — keep polling instead of a single run.
- `--emit-event [--tracker <path>]` — append detected weekly resets to the tracker
  (`data/resets.json`) via the shared merge logic.
- `--all-windows` — also alert on the 5-hour window (off by default; it resets
  normally and would be noisy).
- `--fixture <path>` — read usage from a file instead of the network (offline, no auth).
- `--test-alert` — fire a test notification and exit (no auth needed; useful for verifying webhooks).

On macOS, alerts also fire as native desktop notifications. To run unattended,
schedule the single-poll form with cron or launchd, or leave `--watch` running on
an always-on host.

### Run unattended on Linux with systemd

The repository includes a hardened systemd user-service template. Run these
commands from the repository root. The token prompt is hidden, and the secret
is written only to a local file readable by your user:

```bash
install -d -m 700 "$HOME/.config/codex-reset-tracker" "$HOME/.codex-reset-tracker"
read -rsp "Ingestion token: " CODEX_INGEST_TOKEN; echo
umask 077
printf 'CODEX_INGEST_URL=%s\nCODEX_INGEST_TOKEN=%s\n' \
  'https://codex-reset-tracker.vercel.app/api/monitor' \
  "$CODEX_INGEST_TOKEN" > "$HOME/.config/codex-reset-tracker/monitor.env"
unset CODEX_INGEST_TOKEN

install -d -m 700 "$HOME/.config/systemd/user"
tracker_repository="$(pwd -P)"
node_path="$(command -v node)"
sed \
  -e "s|@REPOSITORY_PATH@|$tracker_repository|g" \
  -e "s|@NODE_PATH@|$node_path|g" \
  ops/systemd/codex-reset-tracker.service.template \
  > "$HOME/.config/systemd/user/codex-reset-tracker.service"

systemctl --user daemon-reload
systemctl --user enable --now codex-reset-tracker.service
systemctl --user status codex-reset-tracker.service
```

Inspect recent output without printing either credential:

```bash
journalctl --user -u codex-reset-tracker.service -n 50 --no-pager
```

After changing the token or URL in `monitor.env`, restart the service with
`systemctl --user restart codex-reset-tracker.service`. Never commit that
environment file. To keep the user service running after logout, enable user
lingering with `loginctl enable-linger "$USER"` if the machine permits it.

On WSL, Windows does not necessarily start the Linux distribution at login,
and systemd services do not keep a WSL instance alive. After restarting
Windows, launch the distribution once and verify the monitor:

```bash
systemctl --user is-active codex-reset-tracker.service
journalctl --user -u codex-reset-tracker.service -n 10 --no-pager
```

If the service is not active, start it with
`systemctl --user start codex-reset-tracker.service`. Use Windows Task
Scheduler to launch the WSL distribution at login when fully automatic Windows
startup is required.

Each successful poll prints both quota representations, for example
`69% remaining (31% used)`. When hosted publishing is configured, failed uploads
do not interrupt local detection: sanitized payloads are queued in the local
monitor state and retried in order on the next poll. The state file is written
atomically with mode `600`; it retains seven days of sanitized poll telemetry
and preserves malformed state as a private `.corrupt-<timestamp>` backup.

### Try it offline (no Codex account needed)

Replay two saved snapshots to see an early weekly reset get detected and recorded:

```bash
S=/tmp/codex-demo-state.json; T=/tmp/codex-demo-tracker.json; echo '{"events":[]}' > "$T"
CODEX_MONITOR_STATE=$S CODEX_PLAN=Plus node scripts/monitor.mjs --fixture scripts/fixtures/usage-weekly-low.json   --emit-event --tracker "$T"
CODEX_MONITOR_STATE=$S CODEX_PLAN=Plus node scripts/monitor.mjs --fixture scripts/fixtures/usage-weekly-reset.json --emit-event --tracker "$T"
```

Run the unit tests for the detection and merge logic with `npm test`.

> The `/wham/usage` JSON shape is not publicly documented. The parser and
> anonymized fixtures are aligned with a real payload captured in July 2026:
> `rate_limit.primary_window` / `secondary_window`, `used_percent`,
> `limit_window_seconds`, `reset_after_seconds`, and Unix-seconds `reset_at`.

## Hosted live dashboard

The hosted pipeline keeps Codex authentication on the personal machine while
publishing only sanitized quota values to the always-online website:

```text
local monitor → authenticated Vercel API → Neon Postgres → live dashboard
```

The hosted API must never receive `auth.json`, access/refresh tokens, email,
`user_id`, or `account_id`. See [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md) for the
implementation phases, [docs/VISION.md](docs/VISION.md) for the architecture,
and [docs/OPERATIONS.md](docs/OPERATIONS.md) for the production runbook.

The home page reads Neon on the server. It shows remaining and used quota, the
scheduled reset in the viewer's timezone, the last monitor update, an explicit
stale state after 30 minutes, and selectable 7/30/90-day history. Without a
configured database or first snapshot, it renders a safe waiting state and
leaves the community timeline available.

Neon Postgres Free is the selected database because it integrates cleanly with
Vercel and keeps the data portable through standard PostgreSQL tools. Sanitized
query results are cached for 15 minutes and invalidated after a newly inserted
snapshot. Chart history is downsampled in SQL while preserving every detected
reset. Provision the Free plan without a payment method or automatic paid
upgrades, monitor compute usage, and keep a weekly `pg_dump`; see
[docs/NEXT_STEPS.md](docs/NEXT_STEPS.md).

### Apply the live quota migration

Set `DATABASE_URL` to a Neon Postgres connection string and apply
`db/migrations/001_live_quota.sql` with the Neon SQL editor or `psql`. Then set
`MONITOR_INGEST_TOKEN` to a random secret of at least 32 characters.

`POST /api/monitor` accepts a strict version 1 JSON payload:

```json
{
  "version": 1,
  "observedAt": "2026-07-25T10:00:00.000Z",
  "usedPercent": 31,
  "resetAt": "2026-08-01T10:00:00.000Z",
  "windowSeconds": 604800,
  "resetDetected": false
}
```

Authenticate with `Authorization: Bearer <MONITOR_INGEST_TOKEN>`. For detected
resets, `resetDetected` is `true` and a matching `resetEvent` object is required.
Unknown fields are rejected so credentials and account identifiers cannot cross
the local-to-hosted trust boundary. `remainingPercent` is always derived from
`usedPercent`; it is never accepted as input or stored. Snapshots older than 90
days are pruned during ingest, while their sanitized reset events are retained.

### Back up the sanitized database

Install PostgreSQL client tools with the same major version as the Neon
database. In the Neon SQL editor, run `SHOW server_version;` to confirm the
required version. Use the unpooled connection string for backups.

Store that connection string in a dedicated local file. Enter it only at the
hidden prompt; never paste it into chat, commit it, or reuse the ingest token:

```bash
install -d -m 700 \
  "$HOME/.config/codex-reset-tracker" \
  "$HOME/.codex-reset-tracker/backups"
read -rsp "Neon unpooled database URL: " BACKUP_DATABASE_URL; echo
umask 077
printf 'BACKUP_DATABASE_URL=%s\n' "$BACKUP_DATABASE_URL" \
  > "$HOME/.config/codex-reset-tracker/backup.env"
unset BACKUP_DATABASE_URL
```

Create and structurally validate a private custom-format backup:

```bash
BACKUP_DATABASE_URL="$(
  sed -n 's/^BACKUP_DATABASE_URL=//p' \
    "$HOME/.config/codex-reset-tracker/backup.env"
)"
export BACKUP_DATABASE_URL
npm run backup:db
unset BACKUP_DATABASE_URL
```

The script includes only `quota_snapshots` and `reset_events`, writes with mode
`0600` under `~/.codex-reset-tracker/backups`, and never places the connection
string in the archive.

To schedule it weekly, install the hardened user units:

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
systemctl --user list-timers codex-reset-tracker-backup.timer --no-pager
```

For a real restore test, create an empty disposable Neon database named
`codex_reset_tracker_restore_<suffix>` and get its unpooled connection string.
The verification script refuses any database with another name or any existing
table:

```bash
read -rsp "Disposable restore database URL: " RESTORE_DATABASE_URL; echo
export RESTORE_DATABASE_URL
npm run backup:verify -- "$HOME/.codex-reset-tracker/backups/<backup>.dump"
unset RESTORE_DATABASE_URL
```

Delete the disposable database after verification. Do not point the restore
script at production. The complete direct-connection, systemd, restore,
rotation, restart, and troubleshooting procedures are documented in
[docs/OPERATIONS.md](docs/OPERATIONS.md).

## Autonomous collector (GitHub Actions)

`scripts/collect.mjs` runs every 4 hours via `.github/workflows/collect.yml`,
polling Reddit (r/codex, r/ChatGPT, r/OpenAI), OpenAI Status, and optionally
the X API. When it finds matching posts it clusters them by time window, builds
events, and commits any changes to `data/resets.json` automatically.

### Zero-cost X monitoring

The primary announcement account is
[Tibo / Thibault Sottiaux (`@thsottiaux`)](https://x.com/thsottiaux), Codex
lead at OpenAI. For free platform-native alerts, follow the account in X, enable
the notification bell for all posts, and allow X notifications on the browser
or phone. This alerts the user directly; it does not feed the autonomous
collector.

### Optional paid X API ingestion

The X API source is off by default and activates as soon as the secret is
present. X currently charges for API reads, so leave this disabled for a
zero-cost deployment. Reddit RSS and OpenAI Status collection continue without
it.

1. If you explicitly accept the cost, create an app in the
   [X Developer Console](https://console.x.com/) and set a strict spending
   limit.
2. Purchase only the credits you intend to use and copy the app's
   **Bearer Token**.
3. In your GitHub repository, go to **Settings → Secrets and variables → Actions**
   and add a secret named `TWITTER_BEARER_TOKEN` with that value.

The next scheduled run (or a manual **Run workflow** dispatch) will pick it up.
No code changes are needed — the workflow already passes the secret to the
collector, and the collector skips X silently when the token is absent.

## Update the timeline

Edit `data/resets.json`, add a new event object, commit, and push. Events are sorted automatically by `occurredAt`.

Before publishing, replace the demonstration entries with verified information and exact source URLs.

## Deploy with GitHub + Vercel

1. Create an empty GitHub repository.
2. In this project folder, run:

```bash
git init
git add .
git commit -m "feat: create Codex reset tracker MVP"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/codex-reset-tracker.git
git push -u origin main
```

3. Sign in to Vercel and select **Add New > Project**.
4. Import the GitHub repository.
5. Vercel should detect Next.js automatically. Keep the default settings and select **Deploy**.
6. Every later push to `main` will deploy a new production version automatically.

## Deploy with Vercel CLI

```bash
npm install -g vercel
vercel
vercel --prod
```

## Production check

```bash
npm run build
npm start
```

## License

This project is available under the [MIT License](LICENSE). Security issues
should be reported privately according to [SECURITY.md](SECURITY.md).
