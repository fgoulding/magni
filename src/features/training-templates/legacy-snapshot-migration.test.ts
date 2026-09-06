import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { runLegacyTemplateSnapshotMigration } from "./legacy-snapshot";

const databases: Database.Database[]=[];
afterEach(()=>{for(const db of databases.splice(0))db.close();});
function fixture() {
  const db=new Database(":memory:");databases.push(db);
  db.exec(`
    CREATE TABLE program_definitions(id INTEGER PRIMARY KEY,owner_user_id INTEGER);
    CREATE TABLE program_definition_days(id INTEGER PRIMARY KEY,program_definition_id INTEGER);
    CREATE TABLE program_definition_exercises(id INTEGER PRIMARY KEY,program_definition_day_id INTEGER,progression_type TEXT,name TEXT);
    CREATE TABLE sessions(id INTEGER PRIMARY KEY,user_id INTEGER,status TEXT,date TEXT);
    CREATE TABLE session_sets(id INTEGER PRIMARY KEY,session_id INTEGER,progression_type TEXT,reps INTEGER,calculated_weight REAL,actual_reps INTEGER,actual_weight REAL);
    CREATE TABLE workout_occurrences(id INTEGER PRIMARY KEY,user_id INTEGER,status TEXT,prescription_json TEXT);
    CREATE TABLE user_training_templates(id TEXT PRIMARY KEY,user_id INTEGER,name TEXT,description TEXT,weeks_json TEXT,rule_json TEXT);
    INSERT INTO program_definitions VALUES(1,1);
    INSERT INTO program_definition_days VALUES(1,1);
    INSERT INTO sessions VALUES(1,1,'in_progress','2026-09-04'),(2,1,'completed','2026-09-03'),(3,1,'skipped','2026-09-02');
  `);
  const template=db.prepare("INSERT INTO user_training_templates VALUES (?,?,?,?,?,?)");
  const weeks=JSON.stringify([{sets:3,reps:5,intensityPct:1,repOutTarget:5}]);
  const rule=JSON.stringify({kind:"linear-add",onSuccess:2.5});
  template.run("custom:owned",1,"Owned template","Owned description",weeks,rule);
  template.run("custom:malformed-rule",1,"Broken rule","Bad rule",weeks,JSON.stringify({kind:"unknown"}));
  template.run("custom:malformed-weeks",1,"Broken weeks","Bad JSON","{",rule);
  template.run("custom:foreign",2,"Private foreign name","Private foreign description",weeks,rule);
  const types=["custom:owned","custom:missing","custom:malformed-rule","custom:malformed-weeks","custom:foreign","linear"];
  types.forEach((type,index)=>{
    db.prepare("INSERT INTO program_definition_exercises VALUES (?,1,?,?)").run(index+1,type,`Exercise ${index}`);
    for(const sessionId of [1,2,3])db.prepare("INSERT INTO session_sets VALUES (?,?,?,5,100,?,?)").run(sessionId*100+index,sessionId,type,index===0?5:null,index===0?105:null);
  });
  const prescribed=types.map(progression_type=>({progression_type,exercise_name:"Preserved lift",reps:5,weight:100,rule_version:"original"}));
  for(const [index,status] of ["scheduled","in_progress","completed","skipped"].entries())db.prepare("INSERT INTO workout_occurrences VALUES (?,1,?,?)").run(index+1,status,JSON.stringify(prescribed,null,2));
  return db;
}
type Row={template_snapshot_json:string|null;progression_type:string};
function assertSnapshots(rows:Row[]) {
  for(const row of rows) {
    if(row.progression_type==="linear") {expect(row.template_snapshot_json).toBeNull();continue;}
    const snapshot=JSON.parse(row.template_snapshot_json!);
    expect(snapshot).toMatchObject({schemaVersion:1,templateId:row.progression_type,source:"migration-current-template",available:row.progression_type==="custom:owned"});
    if(row.progression_type==="custom:owned")expect(snapshot.rule).toEqual({kind:"linear-add",onSuccess:2.5});
    else {
      expect(snapshot).not.toHaveProperty("rule");expect(snapshot).not.toHaveProperty("name");
      expect(row.template_snapshot_json).not.toContain("Private foreign");
    }
  }
}
describe("legacy template snapshot populated migration",()=>{
  it("adds missing columns, snapshots pending and active owned rules, and marks missing/malformed/foreign rules without changing history or built-ins",()=>{
    const db=fixture();
    const beforeSets=db.prepare("SELECT * FROM session_sets ORDER BY id").all();
    const beforeSessions=db.prepare("SELECT * FROM sessions ORDER BY id").all();
    const beforeOccurrences=db.prepare("SELECT * FROM workout_occurrences ORDER BY id").all() as {id:number;prescription_json:string}[];
    expect((db.pragma("table_info(session_sets)") as {name:string}[]).some(row=>row.name==="template_snapshot_json")).toBe(false);
    runLegacyTemplateSnapshotMigration(db);
    expect(db.prepare("SELECT id,session_id,progression_type,reps,calculated_weight,actual_reps,actual_weight FROM session_sets ORDER BY id").all()).toEqual(beforeSets);
    expect(db.prepare("SELECT id,user_id,status,date FROM sessions ORDER BY id").all()).toEqual(beforeSessions);
    expect(db.prepare("SELECT legacy_completion_json FROM sessions").all()).toEqual([{legacy_completion_json:null},{legacy_completion_json:null},{legacy_completion_json:null}]);
    assertSnapshots(db.prepare("SELECT progression_type,template_snapshot_json FROM program_definition_exercises ORDER BY id").all() as Row[]);
    assertSnapshots(db.prepare("SELECT progression_type,template_snapshot_json FROM session_sets WHERE session_id=1 ORDER BY id").all() as Row[]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM session_sets WHERE session_id IN (2,3) AND template_snapshot_json IS NOT NULL").get()).toEqual({count:0});
    for(const row of db.prepare("SELECT id,prescription_json FROM workout_occurrences ORDER BY id").all() as {id:number;prescription_json:string}[]) {
      if(row.id>2)expect(row.prescription_json).toBe(beforeOccurrences[row.id-1].prescription_json);
      else {
        const sets=JSON.parse(row.prescription_json) as Row[];
        assertSnapshots(sets.map(set=>({...set,template_snapshot_json:set.template_snapshot_json??null})));
        expect(sets.map(set=>Object.fromEntries(Object.entries(set).filter(([key])=>key!=="template_snapshot_json")))).toEqual(JSON.parse(beforeOccurrences[row.id-1].prescription_json));
      }
    }
  });
  it("never replaces an existing snapshot on rerun after template editing or deletion, including completed history",()=>{
    const db=fixture();runLegacyTemplateSnapshotMigration(db);
    const assigned=JSON.stringify({schemaVersion:1,templateId:"custom:owned",source:"assignment",available:true,rule:{kind:"linear-add",onSuccess:1}});
    db.prepare("UPDATE session_sets SET template_snapshot_json=? WHERE id=200").run(assigned);
    const before={definitions:db.prepare("SELECT * FROM program_definition_exercises ORDER BY id").all(),sets:db.prepare("SELECT * FROM session_sets ORDER BY id").all(),occurrences:db.prepare("SELECT * FROM workout_occurrences ORDER BY id").all()};
    db.prepare("UPDATE user_training_templates SET rule_json=? WHERE id='custom:owned'").run(JSON.stringify({kind:"linear-add",onSuccess:99}));
    db.prepare("DELETE FROM user_training_templates WHERE id='custom:foreign'").run();
    runLegacyTemplateSnapshotMigration(db);runLegacyTemplateSnapshotMigration(db);
    expect(db.prepare("SELECT * FROM program_definition_exercises ORDER BY id").all()).toEqual(before.definitions);
    expect(db.prepare("SELECT * FROM session_sets ORDER BY id").all()).toEqual(before.sets);
    expect(db.prepare("SELECT * FROM workout_occurrences ORDER BY id").all()).toEqual(before.occurrences);
    expect(db.pragma("integrity_check",{simple:true})).toBe("ok");
  });
});
