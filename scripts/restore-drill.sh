#!/bin/sh
# Restore drill: proves a backup can actually be restored, into a SEPARATE scratch database, and
# writes a report with what the launch checklist asks to record (snapshot, tables checked, RTO, RPO).
# It never touches the live database: the scratch name must differ from PGDATABASE, and it is
# dropped afterwards.
#
#   Off-site:  RESTIC_REPOSITORY, RESTIC_PASSWORD, PG* connection variables (a role that can CREATE DATABASE)
#   Local:     DRILL_DUMP_FILE=/path/to/dump.pgcustom instead of the restic variables (for rehearsal)
#   Optional:  DRILL_SNAPSHOT (default: latest), DRILL_SCRATCH_DB (default: restore_drill_<epoch>),
#              DRILL_REPORT (default: ./restore-drill-report.json)
set -eu
: "${PGHOST:?PostgreSQL host required}"
: "${PGUSER:?PostgreSQL user required}"
: "${PGPASSWORD:?PostgreSQL password required}"
: "${PGDATABASE:?Live database name required (only used to refuse restoring over it)}"

started=$(date +%s)
scratch="${DRILL_SCRATCH_DB:-restore_drill_${started}}"
report="${DRILL_REPORT:-./restore-drill-report.json}"
if [ "$scratch" = "$PGDATABASE" ]; then
  echo "Refusing: the scratch database must not be the live database." >&2
  exit 2
fi
case "$scratch" in *[!A-Za-z0-9_]*) echo "Refusing: scratch database name must be letters, digits and underscores." >&2; exit 2 ;; esac
# Never replace an existing database: only a database this script created itself may be dropped.
# Keep this command outside the conditional: POSIX shells ignore `set -e` in
# an if condition, including a failed command substitution. A connection/client
# failure must stop the drill before it assumes the scratch name is unused.
existing=$(psql -d postgres -qAt -c "SELECT 1 FROM pg_database WHERE datname='$scratch'")
if [ "$existing" = "1" ]; then
  echo "Refusing: database $scratch already exists." >&2
  exit 2
fi

workdir=$(mktemp -d)
created=0
cleanup() {
  if [ "$created" = "1" ]; then psql -d postgres -qAt -c "DROP DATABASE IF EXISTS \"$scratch\"" >/dev/null 2>&1 || true; fi
  rm -rf "$workdir"
}
trap cleanup EXIT

snapshot_id="local-file"
snapshot_time=""
if [ -n "${DRILL_DUMP_FILE:-}" ]; then
  dump="$DRILL_DUMP_FILE"
else
  : "${RESTIC_REPOSITORY:?Off-site restic repository required (or set DRILL_DUMP_FILE)}"
  : "${RESTIC_PASSWORD:?Restic encryption password required}"
  want="${DRILL_SNAPSHOT:-latest}"
  meta=$(restic snapshots --json --tag 9sig-production --host 9sig-oracle "$want" | tr -d '\n')
  snapshot_id=$(printf '%s' "$meta" | sed -n 's/.*"short_id":"\([^"]*\)".*/\1/p' | tail -n 1)
  snapshot_time=$(printf '%s' "$meta" | sed -n 's/.*"time":"\([^"]*\)".*/\1/p' | tail -n 1)
  [ -n "$snapshot_id" ] || { echo "No matching snapshot found." >&2; exit 3; }
  dump="$workdir/strategyos.pgcustom"
  restic dump "$snapshot_id" strategyos.pgcustom > "$dump"
fi
[ -s "$dump" ] || { echo "Backup file is empty." >&2; exit 3; }

psql -d postgres -qAt -c "CREATE DATABASE \"$scratch\""
created=1
pg_restore --no-owner --no-acl --exit-on-error -d "$scratch" "$dump"

# Evidence that the restore is usable, not merely that pg_restore exited 0.
q() { psql -d "$scratch" -qAt -c "$1"; }
migrations=$(q "SELECT count(*) FROM schema_migrations" 2>/dev/null || q "SELECT 0")
tables=$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
users=$(q "SELECT count(*) FROM users")
plans=$(q "SELECT count(*) FROM plans")
versions=$(q "SELECT count(*) FROM strategy_versions")
ledger=$(q "SELECT count(*) FROM ledger_events")
[ "$tables" -gt 10 ] && [ "$plans" -gt 0 ] && [ "$versions" -gt 0 ] || { echo "Restored database looks empty or incomplete." >&2; exit 4; }

finished=$(date +%s)
cat > "$report" <<JSON
{
  "snapshotId": "$snapshot_id",
  "snapshotTime": "$snapshot_time",
  "restoredAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "rtoSeconds": $((finished - started)),
  "tablesChecked": {"tables": $tables, "migrations": $migrations, "users": $users, "plans": $plans, "strategyVersions": $versions, "ledgerEvents": $ledger},
  "scratchDatabase": "$scratch",
  "result": "PASS"
}
JSON
echo "Restore drill passed. Report written to $report"
cat "$report"
echo "Record this report, then set BACKUPS_RESTORE_VERIFIED=true. RPO = time since snapshotTime when the incident would occur (backups run daily)."
