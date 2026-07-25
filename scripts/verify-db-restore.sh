#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <backup.dump>" >&2
  exit 1
fi

if [[ -z "${RESTORE_DATABASE_URL:-}" ]]; then
  echo "RESTORE_DATABASE_URL is required." >&2
  exit 1
fi

for command_name in pg_restore psql; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is required. Install a PostgreSQL client matching Neon." >&2
    exit 1
  fi
done

connection_parts=()
mapfile -d '' -t connection_parts < <(
  node scripts/lib/postgres-connection.mjs RESTORE_DATABASE_URL
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
unset RESTORE_DATABASE_URL connection_parts

backup_path="$1"
if [[ ! -f "$backup_path" ]]; then
  echo "Backup not found: $backup_path" >&2
  exit 1
fi

database_name="$(
  psql \
    --no-psqlrc \
    --tuples-only \
    --no-align \
    --command='SELECT current_database()'
)"

if [[ "$database_name" != codex_reset_tracker_restore_* ]]; then
  echo "Refusing to restore into '$database_name'." >&2
  echo "Use an empty disposable database named codex_reset_tracker_restore_<suffix>." >&2
  exit 1
fi

existing_tables="$(
  psql \
    --no-psqlrc \
    --tuples-only \
    --no-align \
    --command="
      SELECT COUNT(*)
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE';
    "
)"

if [[ "$existing_tables" != "0" ]]; then
  echo "Refusing to restore into a non-empty database." >&2
  exit 1
fi

pg_restore \
  --dbname="$PGDATABASE" \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  "$backup_path"

restored_tables="$(
  psql \
    --no-psqlrc \
    --tuples-only \
    --no-align \
    --command="
      SELECT string_agg(table_name, ',' ORDER BY table_name)
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('quota_snapshots', 'reset_events');
    "
)"

if [[ "$restored_tables" != "quota_snapshots,reset_events" ]]; then
  echo "Restore verification failed: expected sanitized tables were not restored." >&2
  exit 1
fi

unset PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGSSLMODE PGCHANNELBINDING

echo "Restore verified in disposable database: $database_name"
