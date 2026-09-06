import type Database from "better-sqlite3";

/** Additive only: an editor definition is an immutable version beside legacy
 * programs. Running this again never rewrites user prescriptions or history. */
export function runProgramEditorMigration(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS program_editor_drafts (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        document_json TEXT NOT NULL CHECK(json_valid(document_json)),
        revision INTEGER NOT NULL CHECK(revision > 0),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_editor_drafts_user ON program_editor_drafts(user_id, updated_at);
      CREATE TABLE IF NOT EXISTS program_editor_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        draft_id TEXT NOT NULL UNIQUE REFERENCES program_editor_drafts(id),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_revision INTEGER NOT NULL CHECK(source_revision > 0),
        document_json TEXT NOT NULL CHECK(json_valid(document_json)),
        program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL,
        run_id INTEGER REFERENCES program_runs(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TRIGGER IF NOT EXISTS editor_version_immutable
      BEFORE UPDATE OF document_json, source_revision, draft_id, user_id ON program_editor_versions
      BEGIN SELECT RAISE(ABORT, 'Activated editor versions are immutable'); END;
      CREATE TABLE IF NOT EXISTS program_editor_progression_state (
        run_id INTEGER NOT NULL REFERENCES program_runs(id) ON DELETE CASCADE,
        progression_key TEXT NOT NULL,
        state_json TEXT NOT NULL CHECK(json_valid(state_json)),
        revision INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(run_id, progression_key)
      );
      CREATE TABLE IF NOT EXISTS program_editor_progression_events (
        session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        run_id INTEGER NOT NULL REFERENCES program_runs(id) ON DELETE CASCADE,
        decision_json TEXT NOT NULL CHECK(json_valid(decision_json)),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS program_editor_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        program_id INTEGER NOT NULL REFERENCES programs(id),
        draft_id TEXT NOT NULL REFERENCES program_editor_drafts(id),
        source_revision INTEGER NOT NULL,
        scope TEXT NOT NULL,
        document_json TEXT NOT NULL CHECK(json_valid(document_json)),
        preview_json TEXT NOT NULL CHECK(json_valid(preview_json)),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TRIGGER IF NOT EXISTS editor_revision_immutable BEFORE UPDATE ON program_editor_revisions
      BEGIN SELECT RAISE(ABORT, 'Applied editor revisions are immutable'); END;
      CREATE TABLE IF NOT EXISTS program_editor_change_requests (
        user_id INTEGER NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
        request_json TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)),
        PRIMARY KEY(user_id, request_key)
      );
    `);
    const columns = db.prepare("PRAGMA table_info(program_runs)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "editor_version_id")) {
      db.exec("ALTER TABLE program_runs ADD COLUMN editor_version_id INTEGER REFERENCES program_editor_versions(id)");
    }
    const setColumns = db.prepare("PRAGMA table_info(session_sets)").all() as { name: string }[];
    if (!setColumns.some((column) => column.name === "editor_json")) {
      db.exec("ALTER TABLE session_sets ADD COLUMN editor_json TEXT");
    }
  }).immediate();
}
