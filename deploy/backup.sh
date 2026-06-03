#!/usr/bin/env sh
# WAL-safe online backup of the SQLite database to ./backups/ on the host.
# Run from this deploy directory:  sh backup.sh
# Cron (daily 03:00):  0 3 * * * cd /srv/workouts && sh backup.sh >> backups/backup.log 2>&1
set -eu

TS=$(date +%Y%m%d-%H%M%S)
OUT_DIR=backups
mkdir -p "$OUT_DIR"

# Online backup (consistent even under concurrent writes) into the volume...
docker compose exec -T app node -e "require('better-sqlite3')(process.env.DB_PATH).backup('/data/backup.tmp.db').then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)})"
# ...then copy it out to the host and clean up.
docker compose cp app:/data/backup.tmp.db "$OUT_DIR/workouts-$TS.db"
docker compose exec -T app rm -f /data/backup.tmp.db

echo "Backup written to $OUT_DIR/workouts-$TS.db"
