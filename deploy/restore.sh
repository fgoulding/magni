#!/usr/bin/env sh
# Restore the database from a backup snapshot (.db or .db.gz).
# Run from this deploy directory:  sh restore.sh backups/workouts-YYYYMMDD-HHMMSS.db.gz
#
# It stops the app, swaps in the snapshot, drops the stale WAL/SHM (so SQLite
# can't replay an old write-ahead log onto the restored file), and restarts.
set -eu

SRC=${1:?Usage: sh restore.sh <backup.db | backup.db.gz>}
[ -f "$SRC" ] || { echo "No such file: $SRC" >&2; exit 1; }

TMP=$(mktemp)
REMOTE="/data/restore-$(date +%Y%m%d-%H%M%S)-$$.db"
cleanup() { rm -f "$TMP"; docker compose run --rm --no-deps app rm -f "$REMOTE" "$REMOTE.json" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM
case "$SRC" in
  *.gz) gzip -dc "$SRC" > "$TMP" ;;
  *)    cp "$SRC" "$TMP" ;;
esac
# Validate before downtime. Corrupt input never replaces the live database.
docker compose cp "$TMP" "app:$REMOTE"
RECEIPT=${SRC%.gz}.json
if [ -f "$RECEIPT" ]; then docker compose cp "$RECEIPT" "app:$REMOTE.json"; fi
docker compose exec -T app node scripts/database-maintenance.mjs verify --database "$REMOTE"
printf 'Restore %s over the live database? [y/N] ' "$SRC"
read -r ans
[ "$ans" = "y" ] || [ "$ans" = "Y" ] || { echo "Aborted."; exit 1; }
echo "Stopping app..."
docker compose stop app
# The restore verifies checksums, backs up the current database, and swaps the
# file atomically while every writer is stopped. A failure leaves the app stopped.
docker compose run --rm --no-deps app node scripts/database-maintenance.mjs restore --source "$REMOTE" --database /data/workouts.db --offline
echo "Starting app..."
docker compose start app
docker compose exec -T app node scripts/database-maintenance.mjs verify --database /data/workouts.db
echo "Restored from $SRC. Check the health endpoint and your latest workout before resuming training."
