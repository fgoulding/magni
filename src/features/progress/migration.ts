import type Database from "better-sqlite3";
import { attachSessionExerciseSources } from "./source-links";

/** Additive identity indexes; no saved workout, snapshot, rule or progression is changed. */
export function runProgressMigration(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS exercise_catalog (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        origin TEXT NOT NULL CHECK(origin IN ('lineage','unlinked','confirmed')),
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id,id)
      );
      CREATE TABLE IF NOT EXISTS exercise_sources (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_key TEXT NOT NULL,
        exercise_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('editor','legacy','quick','unlinked')),
        revision INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY(user_id,source_key),
        FOREIGN KEY(user_id,exercise_id) REFERENCES exercise_catalog(user_id,id)
      );
      CREATE TABLE IF NOT EXISTS exercise_set_sources (
        session_set_id INTEGER PRIMARY KEY REFERENCES session_sets(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_key TEXT NOT NULL,
        observation_key TEXT NOT NULL,
        exercise_id TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY(user_id,source_key) REFERENCES exercise_sources(user_id,source_key),
        FOREIGN KEY(user_id,exercise_id) REFERENCES exercise_catalog(user_id,id)
      );
      CREATE INDEX IF NOT EXISTS idx_exercise_set_sources_catalog ON exercise_set_sources(user_id,exercise_id,session_set_id);
      CREATE INDEX IF NOT EXISTS idx_exercise_sources_catalog ON exercise_sources(user_id,exercise_id);
      CREATE INDEX IF NOT EXISTS idx_exercise_catalog_name ON exercise_catalog(user_id,name,id);
      CREATE TABLE IF NOT EXISTS exercise_identity_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        request_key TEXT NOT NULL,
        request_json TEXT NOT NULL,
        before_json TEXT NOT NULL CHECK(json_valid(before_json)),
        after_json TEXT NOT NULL CHECK(json_valid(after_json)),
        result_json TEXT NOT NULL CHECK(json_valid(result_json)),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id,request_key)
      );
    `);
    const sessions = db.prepare(`SELECT DISTINCT s.id,s.user_id FROM sessions s JOIN session_sets ss ON ss.session_id=s.id
      LEFT JOIN exercise_set_sources x ON x.session_set_id=ss.id WHERE x.session_set_id IS NULL ORDER BY s.id`).all() as { id: number; user_id: number }[];
    for (const session of sessions) attachSessionExerciseSources(db, session.user_id, session.id, undefined, false);
  }).immediate();
}
