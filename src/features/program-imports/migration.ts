import type Database from "better-sqlite3";

/** Additive credentials and retry receipts; never rewrites programs or history. */
export function runProgramImportMigration(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS program_import_tokens (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
      secret_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_program_import_tokens_user ON program_import_tokens(user_id);
    CREATE TABLE IF NOT EXISTS program_import_requests (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_key TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      draft_id TEXT NOT NULL REFERENCES program_editor_drafts(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(user_id, request_key)
    );
    CREATE INDEX IF NOT EXISTS idx_program_import_requests_user_created ON program_import_requests(user_id,created_at);
  `);
}
