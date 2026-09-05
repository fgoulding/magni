import type Database from "better-sqlite3";

export function runWorkoutHistoryMigration(db: Database.Database): void {
  db.transaction(() => {
    const sessionColumns = db.pragma("table_info(sessions)") as { name: string }[];
    if (!sessionColumns.some((column) => column.name === "revision")) db.exec("ALTER TABLE sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1");
    if (!sessionColumns.some((column) => column.name === "unit")) db.exec("ALTER TABLE sessions ADD COLUMN unit TEXT NOT NULL DEFAULT 'lb' CHECK(unit IN ('lb','kg'))");
    const setColumns = db.pragma("table_info(session_sets)") as { name: string }[];
    if (!setColumns.some((column) => column.name === "exercise_key")) db.exec("ALTER TABLE session_sets ADD COLUMN exercise_key TEXT");
    if (!setColumns.some((column) => column.name === "sort_order")) db.exec("ALTER TABLE session_sets ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
    db.exec(`
      CREATE TABLE IF NOT EXISTS workout_mutation_requests (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        request_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL CHECK(json_valid(response_json)),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(user_id, request_key)
      );
      CREATE TABLE IF NOT EXISTS workout_routines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        unit TEXT NOT NULL DEFAULT 'lb' CHECK(unit IN ('lb','kg')),
        prescription_json TEXT NOT NULL CHECK(json_valid(prescription_json)),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS workout_corrections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reason TEXT NOT NULL,
        before_json TEXT NOT NULL CHECK(json_valid(before_json)),
        after_json TEXT NOT NULL CHECK(json_valid(after_json)),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_workout_corrections_session ON workout_corrections(session_id,id);
      CREATE INDEX IF NOT EXISTS idx_workout_routines_user ON workout_routines(user_id,id);
    `);
    const routineColumns = db.pragma("table_info(workout_routines)") as { name: string }[];
    if (!routineColumns.some((column) => column.name === "unit")) db.exec("ALTER TABLE workout_routines ADD COLUMN unit TEXT NOT NULL DEFAULT 'lb'");
    if (setColumns.some((column) => column.name === "editor_json")) db.exec(`UPDATE sessions SET unit='kg' WHERE program_id IS NOT NULL AND unit='lb'
      AND EXISTS (SELECT 1 FROM session_sets ss WHERE ss.session_id=sessions.id AND json_valid(ss.editor_json) AND json_extract(ss.editor_json,'$.unit')='kg')`);
  }).immediate();
}
