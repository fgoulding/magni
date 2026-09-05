import type Database from "better-sqlite3";

export function createCalendarOperations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS calendar_operations (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_key TEXT NOT NULL,
    before_json TEXT NOT NULL,
    after_json TEXT NOT NULL,
    undone_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, request_key)
  ); CREATE INDEX IF NOT EXISTS idx_calendar_operations_user ON calendar_operations(user_id, created_at);`);
}

/** Legacy date-based identity only applies before a session links to an occurrence.
 * Rebuild from the stored schema so later editor/history extensions are retained. */
export function migrateOccurrenceSessionUniqueness(db: Database.Database): void {
  const table=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'").get() as {sql:string};
  const oldConstraint=/,\s*UNIQUE\s*\(\s*program_id\s*,\s*user_id\s*,\s*day_id\s*,\s*week_number\s*,\s*date\s*\)/i;
  const definitionIndex=db.prepare("SELECT sql FROM sqlite_master WHERE name='idx_sessions_unique_definition_day'").get() as {sql:string}|undefined;
  const legacyIndex=db.prepare("SELECT sql FROM sqlite_master WHERE name='idx_sessions_unique_legacy_day'").get() as {sql:string}|undefined;
  if (!oldConstraint.test(table.sql) && definitionIndex?.sql.includes("occurrence_id IS NULL") && legacyIndex?.sql.includes("occurrence_id IS NULL")) return;
  if(db.inTransaction) throw new Error("Session identity migration requires an outer schema transaction boundary");
  const foreignKeys=db.pragma("foreign_keys",{simple:true});
  const legacyAlter=db.pragma("legacy_alter_table",{simple:true});
  const violationsBefore=new Set((db.pragma("foreign_key_check") as unknown[]).map(row=>JSON.stringify(row)));
  db.pragma("foreign_keys=OFF");
  db.pragma("legacy_alter_table=ON");
  try {
    db.transaction(()=>{
      if(oldConstraint.test(table.sql)) {
        const objects=db.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name='sessions' AND type IN ('index','trigger') AND sql IS NOT NULL").all() as {name:string;sql:string}[];
        const sequence=db.prepare("SELECT seq FROM sqlite_sequence WHERE name='sessions'").get() as {seq:number}|undefined;
        const create=table.sql.replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"sessions"|`sessions`|\[sessions\]|sessions)/i,'CREATE TABLE "sessions_calendar_upgrade"').replace(oldConstraint,"");
        if(create===table.sql)throw new Error("Could not identify sessions schema for safe upgrade");
        db.exec(create);
        const columns=(db.pragma("table_info(sessions)") as {name:string}[]).map(row=>`"${row.name.replaceAll('"','""')}"`).join(",");
        db.exec(`INSERT INTO sessions_calendar_upgrade(${columns}) SELECT ${columns} FROM sessions; DROP TABLE sessions; ALTER TABLE sessions_calendar_upgrade RENAME TO sessions;`);
        if(sequence)db.prepare("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='sessions'").run(sequence.seq);
        for(const object of objects) if(object.name!=="idx_sessions_unique_definition_day" && object.name!=="idx_sessions_unique_legacy_day")db.exec(object.sql);
      }
      db.exec(`DROP INDEX IF EXISTS idx_sessions_unique_definition_day;
        CREATE UNIQUE INDEX idx_sessions_unique_definition_day ON sessions(program_run_id,user_id,program_definition_day_id,week_number,date) WHERE program_definition_day_id IS NOT NULL AND occurrence_id IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_unique_legacy_day ON sessions(program_id,user_id,day_id,week_number,date) WHERE occurrence_id IS NULL;`);
      const violationsAfter=db.pragma("foreign_key_check") as unknown[];
      if(violationsAfter.some(row=>!violationsBefore.has(JSON.stringify(row))))throw new Error("Session identity upgrade introduced foreign key violations; all changes rolled back");
    }).immediate();
  } finally {
    db.pragma(`legacy_alter_table=${legacyAlter?"ON":"OFF"}`);
    db.pragma(`foreign_keys=${foreignKeys?"ON":"OFF"}`);
  }
}
