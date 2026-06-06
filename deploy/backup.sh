#!/usr/bin/env sh
# Verified, rotated, WAL-safe online backup of the SQLite database to ./backups/.
# Run from this deploy directory:  sh backup.sh
# Cron (daily 03:00):  0 3 * * * cd /path/to/magni-deploy && sh backup.sh >> backups/backup.log 2>&1
#
# Keep N days of local snapshots (override):  KEEP_DAYS=60 sh backup.sh
set -eu

TS=$(date +%Y%m%d-%H%M%S)
OUT_DIR=backups
KEEP_DAYS=${KEEP_DAYS:-30}
mkdir -p "$OUT_DIR"

# 1. Online backup — a consistent snapshot even under concurrent writes (NOT a
#    raw cp, which can copy a torn page mid-write).
docker compose exec -T app node -e "require('better-sqlite3')(process.env.DB_PATH).backup('/data/backup.tmp.db').then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)})"

# 2. Verify the snapshot BEFORE keeping it, so a corrupt source can't quietly
#    rotate away your good backups.
CHECK=$(docker compose exec -T app node -e "process.stdout.write(require('better-sqlite3')('/data/backup.tmp.db',{readonly:true}).pragma('quick_check',{simple:true}))")
if [ "$CHECK" != "ok" ]; then
  echo "ABORT: snapshot failed integrity check ($CHECK). Keeping existing backups." >&2
  docker compose exec -T app rm -f /data/backup.tmp.db
  exit 1
fi

# 3. Copy it to the host, compress, clean up the in-volume temp.
docker compose cp app:/data/backup.tmp.db "$OUT_DIR/workouts-$TS.db"
docker compose exec -T app rm -f /data/backup.tmp.db
gzip -f "$OUT_DIR/workouts-$TS.db"

# 4. Rotate: drop local snapshots older than KEEP_DAYS.
find "$OUT_DIR" -name 'workouts-*.db.gz' -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true

echo "Backup OK: $OUT_DIR/workouts-$TS.db.gz (verified; keeping ${KEEP_DAYS} days locally)"
echo "NOTE: copy $OUT_DIR/ OFF this box — a backup on the same disk won't survive a disk failure."
