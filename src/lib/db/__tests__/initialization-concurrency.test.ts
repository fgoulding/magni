import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { runMigrations } from "../migrations";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function databasePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "magni-init-concurrency-")), "test.sqlite");
}

function openDatabase(dbPath: string) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 0");
  return db;
}

function populateLegacy(db: Database.Database) {
  db.exec(schema);
  db.exec(`INSERT INTO users(id,email,password_hash) VALUES(1,'migration@example.test','hash');
    INSERT INTO programs(id,user_id,name,num_weeks) VALUES(1,1,'Existing program',2);
    INSERT INTO days(id,program_id,name,day_number) VALUES(1,1,'Lower',1);
    INSERT INTO exercises(id,day_id,name,training_max) VALUES(1,1,'Squat',200);
    INSERT INTO week_settings(id,exercise_id,week_number,intensity_pct,reps,sets,rep_out_target,calculated_weight) VALUES(1,1,1,1,5,3,5,200);
    INSERT INTO sessions(id,program_id,user_id,day_id,week_number,completed,date) VALUES(1,1,1,1,1,1,'2026-09-01');
    INSERT INTO session_sets(id,session_id,week_setting_id,actual_reps,actual_weight) VALUES(1,1,1,5,200);`);
}

describe("database initialization under concurrent requests", () => {
  it.each(["holding", "committed"])("backfills linked programs safely with a %s request writer after its read", mode => {
    const dbPath = databasePath();
    const db = openDatabase(dbPath);
    populateLegacy(db);
    runMigrations(db);
    const originalProgram = db.prepare("SELECT program_definition_id,program_run_id FROM programs WHERE id=1").get();
    const other = openDatabase(dbPath);
    const writeOther = () => other.prepare("INSERT INTO user_settings(user_id,key,value) VALUES(1,'concurrent-request','saved')").run();
    const originalPrepare = db.prepare.bind(db);
    let interleaved = false;
    let waitingWriter = false;
    const prepare = vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (!interleaved && sql === "UPDATE programs SET program_definition_id = ?, program_run_id = ? WHERE id = ?") {
        interleaved = true;
        try {
          other.exec("BEGIN IMMEDIATE");
          writeOther();
          if (mode === "committed") other.exec("COMMIT");
        } catch (error) {
          if ((error as { code?: string }).code !== "SQLITE_BUSY") throw error;
          waitingWriter = true;
        }
      }
      return originalPrepare(sql);
    });
    try {
      let failure: { code?: string; message: string } | undefined;
      try { runMigrations(db); }
      catch (error) { failure = { code: (error as { code?: string }).code, message: (error as Error).message }; }
      expect(failure).toBeUndefined();
      expect(interleaved).toBe(true);
      expect(waitingWriter).toBe(true);
      writeOther();
      expect(db.prepare("SELECT program_definition_id,program_run_id FROM programs WHERE id=1").get()).toEqual(originalProgram);
      expect(db.prepare("SELECT actual_reps,actual_weight FROM session_sets WHERE id=1").get()).toEqual({ actual_reps: 5, actual_weight: 200 });
      expect(db.prepare("SELECT value FROM user_settings WHERE key='concurrent-request'").get()).toEqual({ value: "saved" });
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally {
      prepare.mockRestore();
      if (other.inTransaction) other.exec("ROLLBACK");
      other.close();
      db.close();
    }
  });

  it("opens another current-revision module without schema writes while a request writer is active", async () => {
    const dbPath = databasePath();
    const previousPath = process.env.DB_PATH;
    process.env.DB_PATH = dbPath;
    vi.resetModules();
    const first = await import("../index");
    const other = openDatabase(dbPath);
    let second: typeof first | undefined;
    try {
      first.db.exec("INSERT INTO users(id,email,password_hash) VALUES(1,'current@example.test','hash')");
      const catalog = first.db.prepare("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all();
      other.exec("BEGIN IMMEDIATE");
      other.prepare("INSERT INTO user_settings(user_id,key,value) VALUES(1,'active-request','saved')").run();
      vi.resetModules();
      let failure: { code?: string; message: string } | undefined;
      try { second = await import("../index"); }
      catch (error) { failure = { code: (error as { code?: string }).code, message: (error as Error).message }; }
      expect(failure).toBeUndefined();
      expect(second!.db).not.toBe(first.db);
      expect(second!.db.prepare("SELECT total_changes() AS changes").get()).toEqual({ changes: 0 });
      expect(second!.db.prepare("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all()).toEqual(catalog);
      other.exec("COMMIT");
      expect(second!.db.prepare("SELECT value FROM user_settings WHERE key='active-request'").get()).toEqual({ value: "saved" });
    } finally {
      if (other.inTransaction) other.exec("ROLLBACK");
      other.close();
      second?.db.close();
      first.db.close();
      process.env.DB_PATH = previousPath;
      vi.resetModules();
    }
  }, 15_000);

  it("fully upgrades a populated revision-zero database and records completion only after success", () => {
    const db = openDatabase(databasePath());
    try {
      populateLegacy(db);
      db.exec("CREATE TRIGGER reject_migration BEFORE UPDATE ON programs BEGIN SELECT RAISE(ABORT,'injected migration failure'); END");
      expect(() => runMigrations(db)).toThrow("injected migration failure");
      expect(db.pragma("user_version", { simple: true })).toBe(0);
      db.exec("DROP TRIGGER reject_migration");
      runMigrations(db);
      expect(db.pragma("user_version", { simple: true })).toBe(1);
      expect(db.prepare("SELECT training_max FROM exercises WHERE id=1").get()).toEqual({ training_max: 200 });
      expect(db.prepare("SELECT actual_reps,actual_weight FROM session_sets WHERE id=1").get()).toEqual({ actual_reps: 5, actual_weight: 200 });
      expect(db.prepare("SELECT program_name,day_name,status FROM sessions WHERE id=1").get()).toEqual({ program_name: "Existing program", day_name: "Lower", status: "completed" });
      expect(db.prepare("SELECT COUNT(*) AS n FROM program_definitions").get()).toEqual({ n: 1 });
      expect(db.prepare("SELECT COUNT(*) AS n FROM program_runs").get()).toEqual({ n: 1 });
      expect(db.pragma("foreign_key_check")).toEqual([]);
      expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    } finally { db.close(); }
  });

  it("retries an interrupted current-revision repair on the next module initialization", async () => {
    const dbPath = databasePath();
    const previousPath = process.env.DB_PATH;
    process.env.DB_PATH = dbPath;
    vi.resetModules();
    const first = await import("../index");
    let second: typeof first | undefined;
    try {
      populateLegacy(first.db);
      runMigrations(first.db);
      expect(first.db.pragma("user_version", { simple: true })).toBe(1);
      first.db.exec("CREATE TRIGGER reject_repair BEFORE UPDATE ON programs BEGIN SELECT RAISE(ABORT,'injected repair failure'); END");
      expect(() => runMigrations(first.db)).toThrow("injected repair failure");
      expect(first.db.pragma("user_version", { simple: true })).toBe(0);
      expect(first.db.prepare("SELECT name FROM sqlite_master WHERE name='sessions_set_program_context_after_insert'").get()).toBeUndefined();
      first.db.exec("DROP TRIGGER reject_repair");
      vi.resetModules();
      second = await import("../index");
      expect(second.db.pragma("user_version", { simple: true })).toBe(1);
      second.db.exec("INSERT INTO sessions(id,program_id,user_id,day_id,week_number,date) VALUES(2,1,1,1,2,'2026-09-02')");
      expect(second.db.prepare("SELECT program_name,day_name,program_run_id IS NOT NULL AS linked FROM sessions WHERE id=2").get()).toEqual({ program_name: "Existing program", day_name: "Lower", linked: 1 });
      expect(second.db.prepare("SELECT actual_reps,actual_weight FROM session_sets WHERE id=1").get()).toEqual({ actual_reps: 5, actual_weight: 200 });
      expect(second.db.prepare("SELECT COUNT(*) AS n FROM program_runs").get()).toEqual({ n: 1 });
      expect(second.db.pragma("foreign_key_check")).toEqual([]);
    } finally {
      second?.db.close();
      first.db.close();
      process.env.DB_PATH = previousPath;
      vi.resetModules();
    }
  });

  it("rejects an explicit newer schema revision without downgrading or changing its catalog", () => {
    const db = openDatabase(databasePath());
    try {
      db.exec("CREATE TABLE future_data(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO future_data VALUES(1,'preserve')");
      db.pragma("user_version = 2147483647");
      const catalog = db.prepare("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all();
      expect(() => runMigrations(db)).toThrow(/newer schema revision/i);
      expect(db.pragma("user_version", { simple: true })).toBe(2147483647);
      expect(db.prepare("SELECT * FROM future_data").all()).toEqual([{ id: 1, value: "preserve" }]);
      expect(db.prepare("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all()).toEqual(catalog);
    } finally { db.close(); }
  });
});
