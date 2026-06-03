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
db.pragma("foreign_keys = ON");

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
}

initDb();
