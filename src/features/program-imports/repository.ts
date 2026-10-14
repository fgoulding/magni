import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getEditorDraft, isEditorDraftDeleted, saveEditorDraft } from "../program-editor/repository";
import { parseProgramFile, ProgramFileError, scopeProgramDocument } from "../program-files/file";

export class ProgramImportError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = "ProgramImportError"; }
}
export type ImportToken = { id: string; name: string; createdAt: string; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null };
const selectTokens = "SELECT id,name,created_at AS createdAt,expires_at AS expiresAt,revoked_at AS revokedAt,last_used_at AS lastUsedAt FROM program_import_tokens";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function listImportTokens(userId: number): ImportToken[] {
  return db.prepare(`${selectTokens} WHERE user_id=? ORDER BY created_at DESC,id`).all(userId) as ImportToken[];
}
export function createImportToken(userId: number, input: { name: unknown; expiresInDays?: unknown }): { token: ImportToken; secret: string } {
  const days = input.expiresInDays ?? 30;
  if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 80 || typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 90) throw new ProgramImportError(400, "invalid_token", "Enter a name up to 80 characters and an expiry from 1 to 90 days.");
  const name = input.name.trim();
  return db.transaction(() => {
    const now = new Date().toISOString();
    const count = db.prepare("SELECT count(*) n FROM program_import_tokens WHERE user_id=? AND revoked_at IS NULL AND expires_at>?").get(userId, now) as { n: number };
    if (count.n >= 10) throw new ProgramImportError(429, "token_limit", "Revoke an existing credential before creating more than 10 active credentials.");
    const secret = `magni_import_${randomBytes(32).toString("base64url")}`;
    const id = randomUUID();
    db.prepare("INSERT INTO program_import_tokens(id,user_id,name,secret_hash,created_at,expires_at) VALUES (?,?,?,?,?,?)").run(id, userId, name, hash(secret), now, new Date(Date.now() + days * 86_400_000).toISOString());
    return { token: db.prepare(`${selectTokens} WHERE id=? AND user_id=?`).get(id, userId) as ImportToken, secret };
  }).immediate();
}
export function revokeImportToken(userId: number, id: string): void {
  if (!uuid(id) || !db.prepare("SELECT 1 FROM program_import_tokens WHERE id=? AND user_id=?").get(id, userId)) throw new ProgramImportError(404, "not_found", "Credential not found.");
  db.prepare("UPDATE program_import_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND user_id=?").run(new Date().toISOString(), id, userId);
}
export function authenticateImportToken(secret: string): { userId: number; tokenId: string } {
  const invalid = () => new ProgramImportError(401, "invalid_credential", "Import credential is invalid, expired or revoked.");
  if (!/^magni_import_[A-Za-z0-9_-]{43}$/.test(secret)) throw invalid();
  const row = db.prepare("SELECT id,user_id FROM program_import_tokens WHERE secret_hash=? AND revoked_at IS NULL AND expires_at>?").get(hash(secret), new Date().toISOString()) as { id: string; user_id: number } | undefined;
  if (!row) throw invalid();
  return { userId: row.user_id, tokenId: row.id };
}
function payloadHash(file: unknown): string {
  let value: unknown;
  try {
    const serialized = typeof file === "string" ? file : JSON.stringify(file);
    if (!serialized || new TextEncoder().encode(serialized).length > 2_000_000) throw new Error("size");
    value = JSON.parse(serialized);
  } catch { throw new ProgramFileError([{ path: "file", message: "Use valid JSON smaller than 2 MB." }]); }
  return hash(JSON.stringify(value, (_key, row) => row && typeof row === "object" && !Array.isArray(row) ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row));
}
export function importProgram(input: { userId: number; requestKey: unknown; file: unknown; tokenId?: string }): { draftId: string; revision: number; reviewUrl: string; replayed: boolean } {
  if (!uuid(input.requestKey)) throw new ProgramImportError(400, "invalid_request_key", "Use a UUID request key and reuse it when retrying the same upload.");
  const requestKey = input.requestKey, payload = payloadHash(input.file);
  return db.transaction(() => {
    // Recheck at the write boundary so revocation between authentication and
    // reading the request body prevents a new import.
    if (input.tokenId && !db.prepare("SELECT 1 FROM program_import_tokens WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>?").get(input.tokenId, input.userId, new Date().toISOString())) throw new ProgramImportError(401, "invalid_credential", "Import credential is invalid, expired or revoked.");
    const prior = db.prepare("SELECT payload_hash,draft_id FROM program_import_requests WHERE user_id=? AND request_key=?").get(input.userId, requestKey) as { payload_hash: string; draft_id: string } | undefined;
    if (prior && prior.payload_hash !== payload) throw new ProgramImportError(409, "request_conflict", "This request key was used for different content. Use a new key for a new upload.");
    if (prior && isEditorDraftDeleted(input.userId, prior.draft_id)) throw new ProgramImportError(410, "draft_deleted", "The imported draft was deleted. Use a new request key to create another draft.");
    let draft = prior ? getEditorDraft(input.userId, prior.draft_id) : null;
    if (prior && !draft) throw new ProgramImportError(410, "draft_deleted", "The imported draft is no longer available.");
    if (!draft) {
      const count = db.prepare("SELECT count(*) n FROM program_import_requests WHERE user_id=? AND created_at>=datetime('now','-1 day')").get(input.userId) as { n: number };
      if (count.n >= 100) throw new ProgramImportError(429, "import_limit", "At most 100 new program imports are allowed per day. Existing imports can still be retried.");
      const document = scopeProgramDocument(parseProgramFile(input.file).document);
      draft = saveEditorDraft({ userId: input.userId, id: randomUUID(), expectedRevision: 0, document });
      db.prepare("INSERT INTO program_import_requests(user_id,request_key,payload_hash,draft_id) VALUES (?,?,?,?)").run(input.userId, requestKey, payload, draft.id);
    }
    if (input.tokenId) db.prepare("UPDATE program_import_tokens SET last_used_at=? WHERE id=? AND user_id=?").run(new Date().toISOString(), input.tokenId, input.userId);
    return { draftId: draft.id, revision: draft.revision, reviewUrl: `/programs/editor/${draft.id}`, replayed: !!prior };
  }).immediate();
}
