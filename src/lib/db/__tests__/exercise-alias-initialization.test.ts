import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { runMigrations } from "../migrations";

it("boots a populated schema-5 database, preserves training and backup recovery, then reopens without writes", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "magni-schema-six-boot-"));
  const dbPath = path.join(directory, "workouts.sqlite");
  const backupPath = path.join(directory, "schema-five.sqlite");
  const prior = new Database(dbPath);
  prior.pragma("foreign_keys=ON");
  prior.exec(fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
  runMigrations(prior);
  prior.exec("DROP TABLE exercise_catalog_redirects; DROP TABLE exercise_name_aliases;");
  prior.exec("INSERT INTO users(id,email,password_hash) VALUES (1,'old-history@example.test','hash')");
  for (const [index, date] of ["2026-02-03", "2026-09-02", "2026-10-01"].entries()) {
    const id = index + 1;
    prior.prepare("INSERT INTO sessions(id,user_id,week_number,date,status,completed,unit,revision) VALUES (?,1,1,?,'completed',1,?,4)").run(id, date, index === 1 ? "kg" : "lb");
    prior.prepare("INSERT INTO session_sets(id,session_id,exercise_name,exercise_key,actual_reps,actual_weight,sets,notes) VALUES (?,?,'Deadlift',?,5,?,1,'Frozen note')").run(id, id, `slot-${id}`, index === 1 ? 100 : 225);
    prior.prepare("INSERT INTO exercise_catalog(id,user_id,name,origin) VALUES (?,1,'Deadlift',?)").run(`catalog-${id}`, index ? "unlinked" : "lineage");
    prior.prepare("INSERT INTO exercise_sources(user_id,source_key,exercise_id,kind) VALUES (1,?,?,?)").run(`source-${id}`, `catalog-${id}`, index ? "quick" : "legacy");
    prior.prepare("INSERT INTO exercise_set_sources(session_set_id,user_id,source_key,observation_key,exercise_id) VALUES (?,1,?,?,?)").run(id, `source-${id}`, `observation-${id}`, `catalog-${id}`);
  }
  prior.prepare("INSERT INTO user_settings(user_id,key,value) VALUES(1,'progress_pins_v1',?)").run('["catalog-3"]');
  prior.pragma("user_version=5");
  const names = (prior.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(row => row.name);
  const snapshot = (db: Database.Database) => Object.fromEntries(names.map(name => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map(row => {
    if (name !== "exercise_sources" && name !== "exercise_set_sources") return row;
    const copy = { ...(row as Record<string, unknown>) }; delete copy.exercise_id; return copy;
  })]));
  const before = snapshot(prior);
  await prior.backup(backupPath);
  prior.close();
  const previousPath = process.env.DB_PATH;
  process.env.DB_PATH = dbPath;
  vi.resetModules();
  let initialized: typeof import("../index") | undefined;
  try {
    initialized = await import("../index");
    expect(initialized.db.pragma("user_version", { simple: true })).toBe(6);
    expect(snapshot(initialized.db)).toEqual(before);
    expect(initialized.db.prepare("SELECT DISTINCT exercise_id FROM exercise_set_sources").all()).toEqual([{ exercise_id: "catalog-1" }]);
    expect(initialized.db.prepare("SELECT * FROM exercise_catalog_redirects ORDER BY old_exercise_id").all()).toEqual([
      { user_id: 1, old_exercise_id: "catalog-2", exercise_id: "catalog-1" },
      { user_id: 1, old_exercise_id: "catalog-3", exercise_id: "catalog-1" },
    ]);
    expect(initialized.db.pragma("foreign_key_check")).toEqual([]);
    expect(initialized.db.pragma("quick_check", { simple: true })).toBe("ok");
    const mappings = initialized.db.prepare("SELECT * FROM exercise_set_sources ORDER BY session_set_id").all();
    initialized.db.close(); initialized = undefined;
    vi.resetModules();
    initialized = await import("../index");
    expect(initialized.db.prepare("SELECT total_changes() AS n").get()).toEqual({ n: 0 });
    expect(initialized.db.prepare("SELECT * FROM exercise_set_sources ORDER BY session_set_id").all()).toEqual(mappings);
    const restored = new Database(backupPath, { readonly: true });
    try {
      expect(restored.pragma("user_version", { simple: true })).toBe(5);
      expect(snapshot(restored)).toEqual(before);
      expect(restored.prepare("SELECT DISTINCT exercise_id FROM exercise_set_sources ORDER BY exercise_id").all()).toHaveLength(3);
      expect(restored.pragma("quick_check", { simple: true })).toBe("ok");
    } finally { restored.close(); }
  } finally {
    initialized?.db.close(); process.env.DB_PATH = previousPath; vi.resetModules();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
