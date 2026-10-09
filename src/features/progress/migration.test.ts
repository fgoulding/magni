import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runMigrations } from "@/lib/db/migrations";
import { runProgressMigration } from "./migration";

function revisionFour() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
  runMigrations(db);
  for (const table of ["exercise_name_aliases", "exercise_catalog_redirects", "exercise_identity_changes", "exercise_set_sources", "exercise_sources", "exercise_catalog"]) db.exec(`DROP TABLE IF EXISTS ${table}`);
  db.pragma("user_version=4");
  db.exec(`INSERT INTO users(id,email,password_hash) VALUES (1,'owner@example.test','hash'),(2,'other@example.test','hash');
    INSERT INTO program_runs(id,user_id,name) VALUES (1,1,'Saved run');
    INSERT INTO sessions(id,user_id,program_run_id,week_number,date,status,completed,program_name,day_name,unit,revision)
    VALUES (1,1,1,1,'2026-01-01','completed',1,'Frozen program','Old day','kg',3),
      (2,1,1,1,'2026-01-02','completed',1,'Frozen program','Old day','kg',1),
      (3,2,NULL,1,'2026-01-01','completed',1,'','Other','lb',1);
    INSERT INTO program_editor_progression_state(run_id,progression_key,state_json) VALUES (1,'progression-a','{"load":40}');
    INSERT INTO program_editor_progression_events(session_id,run_id,decision_json) VALUES (1,1,'[{"saved":"never replay"}]');`);
  const insert = db.prepare("INSERT INTO session_sets(session_id,exercise_name,exercise_key,actual_reps,actual_weight,editor_json,notes) VALUES (?,?,?,?,?,?,?)");
  insert.run(1, "Row", null, 10, 40, JSON.stringify({ exerciseId: "authored-a", versionId: 1, progressionKey: "shared" }), "saved note");
  insert.run(2, "Row", null, 0, null, JSON.stringify({ exerciseId: "authored-a", versionId: 1, progressionKey: "split" }), "");
  insert.run(2, "Row", null, null, null, JSON.stringify({ exerciseId: "authored-b", versionId: 1, progressionKey: "shared" }), "");
  insert.run(1, "Quick row", "quick-one", 12, 0, null, "");
  insert.run(2, "Quick row", "quick-two", 12, 0, null, "");
  insert.run(3, "Row", "foreign", 10, 40, null, "");
  db.prepare("INSERT INTO workout_corrections(session_id,user_id,reason,before_json,after_json) VALUES (1,1,'Typo','{}','{}')").run();
  return db;
}

describe("schema 4 through 6 exercise identities", () => {
  it("retains every original historical/progression row and consolidates compatible identities", () => {
    const db = revisionFour();
    try {
      const tables = ["sessions", "session_sets", "program_editor_progression_state", "program_editor_progression_events", "workout_corrections"];
      const before = tables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
      runMigrations(db);
      expect(db.pragma("user_version", { simple: true })).toBe(6);
      expect(tables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())).toEqual(before);
      const rows = db.prepare(`SELECT x.session_set_id,s.exercise_id FROM exercise_set_sources x JOIN exercise_sources s USING(user_id,source_key) ORDER BY x.session_set_id`).all() as { session_set_id: number; exercise_id: string }[];
      expect(rows).toHaveLength(6);
      expect(rows[0].exercise_id).toBe(rows[1].exercise_id);
      expect(rows[2].exercise_id).toBe(rows[0].exercise_id);
      expect(rows[3].exercise_id).toBe(rows[4].exercise_id);
      expect(rows[5].exercise_id).not.toBe(rows[0].exercise_id);
      const identityRows = db.prepare("SELECT * FROM exercise_sources ORDER BY user_id,source_key").all();
      runMigrations(db);
      expect(db.prepare("SELECT * FROM exercise_sources ORDER BY user_id,source_key").all()).toEqual(identityRows);
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally { db.close(); }
  });

  it("requires restoring the pre-upgrade backup for a schema-4 release, not lowering the upgraded revision", () => {
    const db = revisionFour();
    try {
      const backup = db.serialize();
      const saved = db.prepare("SELECT * FROM session_sets ORDER BY id").all();
      runMigrations(db);
      const baselineGuard = (database: Database.Database) => { if ((database.pragma("user_version", { simple: true }) as number) > 4) throw new Error("newer schema"); };
      expect(() => baselineGuard(db)).toThrow("newer schema");
      const restored = new Database(backup);
      try {
        expect(() => baselineGuard(restored)).not.toThrow();
        expect(restored.pragma("user_version", { simple: true })).toBe(4);
        expect(restored.prepare("SELECT * FROM session_sets ORDER BY id").all()).toEqual(saved);
        expect(restored.prepare("SELECT name FROM sqlite_master WHERE name='exercise_catalog'").get()).toBeUndefined();
      } finally { restored.close(); }
    } finally { db.close(); }
  });
  it("splits renamed or changed measurement variants even when copied history keys match", () => {
    const db=revisionFour();
    try {
      const insert=db.prepare("INSERT INTO session_sets(session_id,exercise_name,editor_json,actual_reps,actual_weight) VALUES (1,?,?,10,10)");
      const id=(name:string,exerciseId:string,loadMode:string)=>Number(insert.run(name,JSON.stringify({exerciseId,historyKey:"copied-lift",set:{loadMode,role:"work"}})).lastInsertRowid);
      const original=id("Bench","slot-one","working"); const copy=id("Bench","slot-two","fixed");
      const renamed=id("Incline bench","slot-three","working"); const added=id("Bench","slot-four","added");
      runMigrations(db);
      const catalog=(setId:number)=>(db.prepare("SELECT exercise_id FROM exercise_set_sources WHERE session_set_id=?").get(setId) as {exercise_id:string}).exercise_id;
      expect(catalog(copy)).toBe(catalog(original));
      expect(catalog(renamed)).not.toBe(catalog(original));
      expect(catalog(added)).not.toBe(catalog(original));
    } finally {db.close();}
  });
  it("does not merge unrelated legacy program/run namespaces or detached shared labels",()=>{
    const db=revisionFour();
    try {
      db.prepare("INSERT INTO programs(id,user_id,name) VALUES (1,1,'Legacy only')").run();
      db.exec(`INSERT INTO sessions(id,user_id,program_id,week_number,date,status,completed,program_name)
        VALUES (4,1,1,1,'2026-01-03','completed',1,'Legacy only'),
          (5,1,NULL,1,'2026-01-04','completed',1,'Deleted program A'),
          (6,1,NULL,1,'2026-01-05','completed',1,'Deleted program B');`);
      const ids=[1,4,5,6].map(session=>Number(db.prepare("INSERT INTO session_sets(session_id,exercise_name,shared_exercise_key,actual_reps,actual_weight) VALUES (?,'Squat','squat',5,100)").run(session).lastInsertRowid));
      runProgressMigration(db);
      const rows=ids.map(id=>db.prepare("SELECT x.exercise_id,c.origin FROM exercise_set_sources x JOIN exercise_catalog c ON c.id=x.exercise_id WHERE x.session_set_id=?").get(id) as {exercise_id:string;origin:string});
      expect(new Set(rows.map(row=>row.exercise_id)).size).toBe(4);
      expect(rows.slice(2).map(row=>row.origin)).toEqual(["unlinked","unlinked"]);
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally {db.close();}
  });
});
