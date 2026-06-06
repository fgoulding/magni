import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { runMigrations } from "./migrations";

const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), "data", "workouts.db");
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(dbPath);

db.pragma("busy_timeout = 5000");
db.pragma("journal_mode = WAL");
// FULL durability: a committed write survives an OS crash / power loss, not just
// an app crash. Writes here are infrequent, so the extra fsync cost is moot — we
// trade a hair of speed for not losing the last logged set on a power cut.
db.pragma("synchronous = FULL");
db.pragma("foreign_keys = ON");
// Fold the WAL back into the main file periodically so it can't grow unbounded.
db.pragma("wal_autocheckpoint = 1000");

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withInitLock(callback: () => void): void {
  const lockPath = `${dbPath}.init.lock`;
  const startedAt = Date.now();
  let lockHandle: number | undefined;

  while (lockHandle === undefined) {
    try {
      lockHandle = fs.openSync(lockPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      if (Date.now() - startedAt > 30_000) {
        throw new Error(`Timed out waiting for database initialization lock: ${lockPath}`);
      }
      sleep(50);
    }
  }

  try {
    callback();
  } finally {
    fs.closeSync(lockHandle);
    fs.rmSync(lockPath, { force: true });
  }
}

export function initDb(): void {
  const schemaPath = path.join(process.cwd(), "src", "lib", "db", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  withInitLock(() => {
    db.exec(schema);
    runMigrations(db);
  });

  // Surface corruption on boot instead of letting it silently propagate into
  // every backup. quick_check is fast (no per-index scan) and "ok" when healthy.
  try {
    const result = db.pragma("quick_check", { simple: true });
    if (result !== "ok") {
      console.error(`[db] INTEGRITY CHECK FAILED: ${result} — restore from a known-good backup.`);
    }
  } catch (error) {
    console.error("[db] integrity check could not run:", error);
  }
}

initDb();
