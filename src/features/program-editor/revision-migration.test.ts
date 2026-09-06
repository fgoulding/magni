import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { runProgramEditorMigration } from "./migration";

it("adds reviewed-edit revisions beside populated pre-revision editor tables without rewriting versions, state, or history",()=>{
  const db=new Database(":memory:");
  try {
    db.pragma("foreign_keys=ON");
    // A populated schema from before reviewed active edits. The editor's initial
    // versions, progression journal, and frozen set metadata already exist.
    db.exec(`
      CREATE TABLE users(id INTEGER PRIMARY KEY);
      CREATE TABLE programs(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id));
      CREATE TABLE program_runs(id INTEGER PRIMARY KEY,editor_version_id INTEGER);
      CREATE TABLE sessions(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),status TEXT);
      CREATE TABLE session_sets(id INTEGER PRIMARY KEY,session_id INTEGER REFERENCES sessions(id),reps INTEGER,actual_reps INTEGER,calculated_weight REAL,actual_weight REAL,editor_json TEXT);
      CREATE TABLE program_editor_drafts(id TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),document_json TEXT,revision INTEGER,created_at TEXT,updated_at TEXT);
      CREATE TABLE program_editor_versions(id INTEGER PRIMARY KEY,draft_id TEXT UNIQUE REFERENCES program_editor_drafts(id),user_id INTEGER REFERENCES users(id),source_revision INTEGER,document_json TEXT,program_id INTEGER REFERENCES programs(id),run_id INTEGER REFERENCES program_runs(id),created_at TEXT);
      CREATE TABLE program_editor_progression_state(run_id INTEGER REFERENCES program_runs(id),progression_key TEXT,state_json TEXT,revision INTEGER,updated_at TEXT,PRIMARY KEY(run_id,progression_key));
      CREATE TABLE program_editor_progression_events(session_id INTEGER PRIMARY KEY REFERENCES sessions(id),run_id INTEGER REFERENCES program_runs(id),decision_json TEXT,created_at TEXT);
      INSERT INTO users VALUES(1);
      INSERT INTO programs VALUES(1,1);
      INSERT INTO program_runs VALUES(1,1);
      INSERT INTO sessions VALUES(1,1,'completed');
      INSERT INTO session_sets VALUES(1,1,12,11,40,40,'{"prescribedState":{"load":40}}');
      INSERT INTO program_editor_drafts VALUES('saved-draft',1,'{"name":"Saved draft"}',4,'2026-09-01','2026-09-02');
      INSERT INTO program_editor_versions VALUES(1,'saved-draft',1,3,'{"name":"Activated version"}',1,1,'2026-09-01');
      INSERT INTO program_editor_progression_state VALUES(1,'lift','{"load":42.5,"consecutiveFailures":1}',5,'2026-09-02');
      INSERT INTO program_editor_progression_events VALUES(1,1,'[{"result":"held"}]','2026-09-02');
    `);
    const tables=["programs","program_runs","sessions","session_sets","program_editor_drafts","program_editor_versions","program_editor_progression_state","program_editor_progression_events"];
    const snapshot=()=>Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
    const before=snapshot();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='program_editor_revisions'").get()).toBeUndefined();
    runProgramEditorMigration(db);
    expect(snapshot()).toEqual(before);
    db.prepare("INSERT INTO program_editor_revisions(user_id,program_id,draft_id,source_revision,scope,document_json,preview_json) VALUES (1,1,'saved-draft',4,'occurrence',?,?)").run('{"name":"Reviewed version"}','{"affected":[1]}');
    db.prepare("INSERT INTO program_editor_change_requests VALUES (1,'safe-retry','{}','{\"changed\":1}')").run();
    const revision=db.prepare("SELECT * FROM program_editor_revisions").all();
    const requests=db.prepare("SELECT * FROM program_editor_change_requests").all();
    runProgramEditorMigration(db);runProgramEditorMigration(db);
    expect(snapshot()).toEqual(before);
    expect(db.prepare("SELECT * FROM program_editor_revisions").all()).toEqual(revision);
    expect(db.prepare("SELECT * FROM program_editor_change_requests").all()).toEqual(requests);
    expect(()=>db.prepare("UPDATE program_editor_revisions SET preview_json='{}'").run()).toThrow(/immutable/);
    expect(()=>db.prepare("UPDATE program_editor_versions SET document_json='{}'").run()).toThrow(/immutable/);
    expect(()=>db.prepare("INSERT INTO program_editor_change_requests VALUES (1,'invalid','{}','broken')").run()).toThrow(/CHECK/);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("integrity_check",{simple:true})).toBe("ok");
  } finally {db.close();}
});
