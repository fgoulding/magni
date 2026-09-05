#!/usr/bin/env sh
# Verified, rotated, WAL-safe online backup of the SQLite database to ./backups/.
# Run from this deploy directory:  sh backup.sh
# Cron (daily 03:00):  0 3 * * * cd /path/to/magni-deploy && sh backup.sh >> backups/backup.log 2>&1
#
# Keep N days of local snapshots (override):  KEEP_DAYS=60 sh backup.sh
set -eu

TS=$(date +%Y%m%d-%H%M%S)
# Where snapshots land. Default ./backups; override to a path OUTSIDE any folder
# bind-mounted into the container, so the container can never touch your backups:
#   OUT_DIR=/media/Safe-Storage/magni-backups sh backup.sh
OUT_DIR=${OUT_DIR:-backups}
KEEP_DAYS=${KEEP_DAYS:-30}
mkdir -p "$OUT_DIR"

# The same verified maintenance command is exercised by the local recovery tests.
REMOTE="/data/backup-$TS-$$.tmp.db"
cleanup() { docker compose exec -T app rm -f "$REMOTE" "$REMOTE.json" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM
docker compose exec -T app node scripts/database-maintenance.mjs backup --database /data/workouts.db --output "$REMOTE"
docker compose cp "app:$REMOTE" "$OUT_DIR/workouts-$TS-$$.db"
docker compose cp "app:$REMOTE.json" "$OUT_DIR/workouts-$TS-$$.db.json"
gzip -f "$OUT_DIR/workouts-$TS-$$.db"
# Mark success only after the verified snapshot has reached host storage.
docker compose exec -T app cp "$REMOTE.json" /data/backup-status.json

# 4. Rotate: drop local snapshots older than KEEP_DAYS.
find "$OUT_DIR" \( -name 'workouts-*.db.gz' -o -name 'workouts-*.db.json' \) -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true

echo "Backup OK: $OUT_DIR/workouts-$TS-$$.db.gz (verified; keeping ${KEEP_DAYS} days locally)"
echo "NOTE: copy $OUT_DIR/ OFF this box — a backup on the same disk won't survive a disk failure."
