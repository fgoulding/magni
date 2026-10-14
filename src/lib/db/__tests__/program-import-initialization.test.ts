import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { runMigrations } from "../migrations";

it("boots populated schema 6 into 7, preserves every prior row, restarts without writes and restores schema 6 backup", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "magni-schema-seven-"));
  const filename = path.join(dir, "db.sqlite"), backup = path.join(dir, "prior.sqlite");
  const prior = new Database(filename); prior.pragma("foreign_keys=ON");
  prior.exec(fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8")); runMigrations(prior);
  prior.exec("INSERT INTO users(id,email,password_hash) VALUES(1,'schema-seven@example.test','hash'); INSERT INTO sessions(id,user_id,week_number,date,status,completed) VALUES(1,1,1,'2026-10-01','completed',1); INSERT INTO session_sets(id,session_id,exercise_name,actual_reps,actual_weight,notes) VALUES(1,1,'Squat',5,100,'Frozen history');");
  runMigrations(prior);
  prior.exec("DROP TABLE program_import_requests; DROP TABLE program_import_tokens;");
  prior.pragma("user_version=6");
  const names = (prior.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {name:string}[]).map(row => row.name);
  const snapshot = (db: Database.Database) => Object.fromEntries(names.map(name => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
  const before = snapshot(prior); await prior.backup(backup); prior.close();
  const previous = process.env.DB_PATH; process.env.DB_PATH = filename; vi.resetModules();
  let current: typeof import("../index") | undefined;
  try {
    current = await import("../index"); expect(current.db.pragma("user_version",{simple:true})).toBe(7);
    expect(snapshot(current.db)).toEqual(before); expect(current.db.pragma("foreign_key_check")).toEqual([]);
    expect(current.db.prepare("SELECT name FROM sqlite_master WHERE name IN ('program_import_tokens','program_import_requests')").all()).toHaveLength(2);
    current.db.close(); current = undefined; vi.resetModules(); current = await import("../index");
    expect(current.db.prepare("SELECT total_changes() n").get()).toEqual({n:0}); expect(snapshot(current.db)).toEqual(before);
    const restored = new Database(backup,{readonly:true});
    try { expect(restored.pragma("user_version",{simple:true})).toBe(6); expect(snapshot(restored)).toEqual(before); expect(restored.pragma("integrity_check",{simple:true})).toBe("ok"); expect(restored.prepare("SELECT name FROM sqlite_master WHERE name='program_import_tokens'").get()).toBeUndefined(); } finally {restored.close();}
  } finally { current?.db.close(); process.env.DB_PATH = previous; vi.resetModules(); fs.rmSync(dir,{recursive:true,force:true}); }
});
