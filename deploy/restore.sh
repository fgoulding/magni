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
case "$SRC" in
  *.gz) gzip -dc "$SRC" > "$TMP" ;;
  *)    cp "$SRC" "$TMP" ;;
esac

printf 'Restore %s over the live database? [y/N] ' "$SRC"
read -r ans
[ "$ans" = "y" ] || [ "$ans" = "Y" ] || { echo "Aborted."; rm -f "$TMP"; exit 1; }

echo "Stopping app..."
docker compose stop app

docker compose cp "$TMP" app:/data/workouts.db
# Remove a stale write-ahead log + shared-memory index from the OLD database.
docker compose run --rm --no-deps app sh -c 'rm -f /data/workouts.db-wal /data/workouts.db-shm' >/dev/null 2>&1 || true
rm -f "$TMP"

echo "Starting app..."
docker compose start app
echo "Restored from $SRC. Verify: docker compose logs app | grep -i integrity  (no output = healthy)."
