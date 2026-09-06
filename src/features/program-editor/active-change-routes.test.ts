import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makePreset } from "./operations";

const auth = vi.hoisted(() => ({ id: 0 }));
vi.mock("@/lib/auth", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireUser: async () => ({ id: auth.id }),
}));
let db: (typeof import("@/lib/db"))["db"];
let repository: typeof import("./repository");
let route: typeof import("@/app/api/programs/[id]/editor-changes/route");
let directory: string;
let owner: number;
let other: number;
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "magni-active-api-"));
  vi.stubEnv("DB_PATH", path.join(directory, "test.sqlite"));
  db = (await import("@/lib/db")).db;
  repository = await import("./repository");
  route = await import("@/app/api/programs/[id]/editor-changes/route");
  owner = Number(db.prepare("INSERT INTO users(email,password_hash) VALUES ('edit-api@example.test','hash')").run().lastInsertRowid);
  other = Number(db.prepare("INSERT INTO users(email,password_hash) VALUES ('other-edit-api@example.test','hash')").run().lastInsertRowid);
});
beforeEach(() => { auth.id = owner; });
afterAll(() => { db?.close(); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const context = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (body: unknown, origin = "http://localhost") => new Request("http://localhost/api/programs/1/editor-changes", {
  method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body),
});
function fixture() {
  const draftId = crypto.randomUUID();
  const document = makePreset("double", "2026-09-05");
  repository.saveEditorDraft({ userId: owner, id: draftId, expectedRevision: 0, document });
  const active = repository.activateEditorDraft({ userId: owner, id: draftId, expectedRevision: 1 });
  document.weeks[0].days[0].name = "Reviewed row day";
  repository.saveEditorDraft({ userId: owner, id: draftId, expectedRevision: 1, document });
  const occurrence = db.prepare("SELECT id FROM workout_occurrences WHERE program_id=? ORDER BY id LIMIT 1").get(active.programId) as { id: number };
  return { ...active, draftId, selection: { draftId, expectedDraftRevision: 2, scope: "occurrence", occurrenceId: occurrence.id, progressionState: "preserve" } };
}

describe("active editor changes API", () => {
  it("lists owned editable workouts and reads a preview without writing a version", async () => {
    const f = fixture();
    const list = await route.GET(request({}), context(f.programId));
    expect(await list.json()).toMatchObject({ draftId: f.draftId, publishedRevisionId: null, occurrences: expect.arrayContaining([expect.objectContaining({ occurrenceId: f.selection.occurrenceId, editable: true })]) });
    const preview = await route.POST(request({ ...f.selection, preview: true }), context(f.programId));
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ success: true, affected: [expect.objectContaining({ newName: "Reviewed row day" })], previewToken: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(db.prepare("SELECT id FROM program_editor_revisions WHERE program_id=?").all(f.programId)).toEqual([]);
  });

  it("applies exactly the reviewed owned request and acknowledges a lost-response retry once", async () => {
    const f = fixture();
    const preview = await (await route.POST(request({ ...f.selection, preview: true }), context(f.programId))).json();
    const body = { ...f.selection, preview: false, expectedPreviewToken: preview.previewToken, requestKey: crypto.randomUUID(), userId: other, programId: -1 };
    const first = await (await route.POST(request(body), context(f.programId))).json();
    expect(first).toMatchObject({ success: true, changed: 1, revisionId: expect.any(Number) });
    expect(await (await route.POST(request(body), context(f.programId))).json()).toEqual(first);
    expect(db.prepare("SELECT id FROM program_editor_revisions WHERE program_id=?").all(f.programId)).toHaveLength(1);
  });

  it("publishes and copies the selected immutable definition through a separate action", async () => {
    const f = fixture();
    const selection = { ...f.selection, scope: "definition" };
    const preview = await (await route.POST(request({ ...selection, preview: true }), context(f.programId))).json();
    const result = await (await route.POST(request({ ...selection, preview: false, expectedPreviewToken: preview.previewToken, requestKey: crypto.randomUUID() }), context(f.programId))).json();
    expect(await (await route.GET(request({}), context(f.programId))).json()).toMatchObject({ publishedRevisionId: result.revisionId });
    const body = { action: "copy_published", publishedRevisionId: result.revisionId, requestKey: crypto.randomUUID() };
    const copy = await (await route.POST(request(body), context(f.programId))).json();
    expect(copy).toMatchObject({ success: true, draftId: expect.any(String) });
    expect(copy.draftId).not.toBe(f.draftId);
    expect(await (await route.POST(request(body), context(f.programId))).json()).toEqual(copy);
  });

  it("rejects foreign ownership and cross-origin mutations", async () => {
    const f = fixture(); auth.id = other;
    expect((await route.GET(request({}), context(f.programId))).status).toBe(404);
    expect((await route.POST(request({ ...f.selection, preview: true }), context(f.programId))).status).toBe(404);
    auth.id = owner;
    expect((await route.POST(request({ ...f.selection, preview: true }, "https://foreign.example"), context(f.programId))).status).toBe(403);
  });

  it.each([null, [], { preview: "yes" }, { action: "unknown" }, { action: "copy_published", publishedRevisionId: 1, requestKey: {} }])("rejects malformed input %j", async body => {
    expect((await route.POST(request(body), context(1))).status).toBe(400);
  });

  it("rejects invalid identifiers and stale previews with actionable conflicts", async () => {
    expect((await route.GET(request({}), context("1.5"))).status).toBe(400);
    const f = fixture();
    const invalid = await route.POST(request({ ...f.selection, occurrenceId: 0, preview: true }), context(f.programId));
    expect(invalid.status).toBe(400);
    const stale = await route.POST(request({ ...f.selection, preview: false, expectedPreviewToken: "a".repeat(64), requestKey: crypto.randomUUID() }), context(f.programId));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "edit_conflict", error: expect.stringContaining("Review") });
  });
});
