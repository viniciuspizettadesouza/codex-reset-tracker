#!/usr/bin/env bash

set -euo pipefail

umask 077

if [[ -z "${BACKUP_DATABASE_URL:-}" ]]; then
  echo "BACKUP_DATABASE_URL is required." >&2
  exit 1
fi

for command_name in pg_dump pg_restore; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is required. Install a PostgreSQL client matching Neon." >&2
    exit 1
  fi
done

connection_parts=()
mapfile -d '' -t connection_parts < <(
  node scripts/lib/postgres-connection.mjs BACKUP_DATABASE_URL
)
if [[ ${#connection_parts[@]} -ne 7 ]]; then
  echo "Could not load the direct PostgreSQL connection." >&2
  exit 1
fi

export PGHOST="${connection_parts[0]}"
export PGPORT="${connection_parts[1]}"
export PGDATABASE="${connection_parts[2]}"
export PGUSER="${connection_parts[3]}"
export PGPASSWORD="${connection_parts[4]}"
export PGSSLMODE="${connection_parts[5]}"
export PGCHANNELBINDING="${connection_parts[6]}"
unset BACKUP_DATABASE_URL connection_parts

backup_directory="${CODEX_BACKUP_DIR:-${HOME}/.codex-reset-tracker/backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="${backup_directory}/codex-reset-tracker-${timestamp}.dump"
temporary_path="${backup_path}.partial"

install -d -m 700 "$backup_directory"

cleanup() {
  rm -f -- "$temporary_path"
  unset PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGSSLMODE PGCHANNELBINDING
}
trap cleanup EXIT

pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --table=public.quota_snapshots \
  --table=public.reset_events \
  --file="$temporary_path"

pg_restore --list "$temporary_path" >/dev/null
chmod 600 "$temporary_path"
mv -- "$temporary_path" "$backup_path"
cleanup
trap - EXIT

echo "Created and validated backup: $backup_path"
