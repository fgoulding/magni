import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makePreset } from "./operations";
const authState = vi.hoisted(() => ({ userId: 0, signedIn: true }));
vi.mock("@/lib/auth", () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireUser: async () => { if (!authState.signedIn) throw new UnauthorizedError(); return { id: authState.userId }; } };
});
let db: (typeof import("@/lib/db"))["db"];
let drafts: typeof import("@/app/api/program-drafts/[draftId]/route");
let activation: typeof import("@/app/api/program-drafts/[draftId]/activate/route");
let directory: string;
let user: number;
let other: number;
const request = (body: unknown, method = "PUT", origin?: string) => new Request("http://localhost/api/program-drafts/test", { method, headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
const context = (id: string) => ({ params: Promise.resolve({ draftId: id }) });
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "magni-draft-routes-"));
  vi.stubEnv("DB_PATH", path.join(directory, "routes.sqlite"));
  db = (await import("@/lib/db")).db;
  drafts = await import("@/app/api/program-drafts/[draftId]/route"); activation = await import("@/app/api/program-drafts/[draftId]/activate/route");
  user = Number(db.prepare("INSERT INTO users(email,password_hash) VALUES ('draft-owner@example.test','hash')").run().lastInsertRowid);
  other = Number(db.prepare("INSERT INTO users(email,password_hash) VALUES ('draft-other@example.test','hash')").run().lastInsertRowid);
});
afterAll(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });
async function create() {
  authState.userId = user; authState.signedIn = true;
  const id = crypto.randomUUID(); const document = makePreset("double", "2026-09-05");
  expect((await drafts.PUT(request({ document, expectedRevision: 0 }),context(id))).status).toBe(200);
  return { id, document };
}
describe("draft routes", () => {
  it("deletes a draft, safely retries and prevents stale autosaves from resurrecting it", async () => {
    const { id, document } = await create();
    expect(typeof drafts.DELETE).toBe("function");
    expect((await drafts.DELETE(request({ expectedRevision: 1 }, "DELETE"), context(id))).status).toBe(200);
    expect((await drafts.GET(new Request("http://localhost"), context(id))).status).toBe(404);
    expect((await drafts.DELETE(request({ expectedRevision: 1 }, "DELETE"), context(id))).status).toBe(200);
    for (const expectedRevision of [0, 1]) {
      expect((await drafts.PUT(request({ document, expectedRevision }), context(id))).status).toBe(410);
    }
    expect((await activation.POST(request({ expectedRevision: 1 }, "POST"), context(id))).status).toBe(404);
    const repository = await import("./repository");
    expect(repository.listEditorDrafts(user).some(draft => draft.id === id)).toBe(false);
  });
  it("refuses deletion after another editor saves or activates the draft", async () => {
    const { id, document } = await create();
    expect(typeof drafts.DELETE).toBe("function");
    await drafts.PUT(request({ document: { ...document, name: "Newer edit" }, expectedRevision: 1 }), context(id));
    expect((await drafts.DELETE(request({ expectedRevision: 1 }, "DELETE"), context(id))).status).toBe(409);
    const active = await (await activation.POST(request({ expectedRevision: 2 }, "POST"), context(id))).json();
    const result = await drafts.DELETE(request({ expectedRevision: 2 }, "DELETE"), context(id));
    expect(result.status).toBe(409);
    expect((await result.json()).code).toBe("activated_draft");
    expect(db.prepare("SELECT id FROM programs WHERE id=?").get(active.programId)).toEqual({ id: active.programId });
    expect((await drafts.GET(new Request("http://localhost"), context(id))).status).toBe(200);
  });
  it("checks ownership, authentication, origin and revision before deletion", async () => {
    const { id } = await create();
    expect(typeof drafts.DELETE).toBe("function");
    authState.userId = other;
    expect((await drafts.DELETE(request({ expectedRevision: 1 }, "DELETE"), context(id))).status).toBe(404);
    authState.signedIn = false;
    expect((await drafts.DELETE(request({ expectedRevision: 1 }, "DELETE"), context(id))).status).toBe(401);
    authState.userId = user; authState.signedIn = true;
    expect((await drafts.DELETE(request({ expectedRevision: 1 }, "DELETE", "https://foreign.test"), context(id))).status).toBe(403);
    for (const body of [null, [], {}, { expectedRevision: -1 }, { expectedRevision: "1" }]) {
      expect((await drafts.DELETE(request(body, "DELETE"), context(id))).status).toBe(400);
    }
    expect((await drafts.GET(new Request("http://localhost"), context(id))).status).toBe(200);
  });
  it("remembers deletion before a new draft's first autosave arrives", async () => {
    authState.userId = user; authState.signedIn = true;
    const id = crypto.randomUUID();
    const removed = await drafts.DELETE(request({ expectedRevision: 0 }, "DELETE"), context(id));
    expect(removed.status).toBe(200);
    expect((await drafts.PUT(request({ expectedRevision: 0, document: makePreset("double", "2026-09-06") }), context(id))).status).toBe(410);
    expect((await drafts.GET(new Request("http://localhost"), context(id))).status).toBe(404);
  });
  it("saves, reads, safely retries and activates once", async () => {
    const {id,document} = await create();
    const saved = await (await drafts.GET(new Request("http://localhost"),context(id))).json();
    expect(saved.document).toEqual(document); expect(saved.revision).toBe(1);
    const retry = await (await drafts.PUT(request({document,expectedRevision:0}),context(id))).json(); expect(retry.revision).toBe(1);
    const active = await (await activation.POST(request({expectedRevision:1},"POST"),context(id))).json();
    const retried = await (await activation.POST(request({expectedRevision:1},"POST"),context(id))).json(); expect(retried).toEqual(active);
    expect(db.prepare("SELECT COUNT(*) n FROM program_editor_versions WHERE draft_id=?").get(id)).toEqual({n:1});
  });
  it("rejects revision conflicts without changing the document", async () => {
    const {id,document} = await create();
    const changed = {...document,name:"Edited"};
    expect((await drafts.PUT(request({document:changed,expectedRevision:0}),context(id))).status).toBe(409);
    expect((await activation.POST(request({expectedRevision:0},"POST"),context(id))).status).toBe(409);
    expect((await (await drafts.GET(new Request("http://localhost"),context(id))).json()).document.name).toBe(document.name);
  });
  it("enforces ownership for read, write and activation", async () => {
    const {id,document} = await create(); authState.userId = other;
    expect((await drafts.GET(new Request("http://localhost"),context(id))).status).toBe(404);
    expect((await drafts.PUT(request({document,expectedRevision:1}),context(id))).status).toBe(404);
    expect((await activation.POST(request({expectedRevision:1},"POST"),context(id))).status).toBe(404);
  });
  it("rejects unauthenticated and cross-origin writes", async () => {
    const {id,document} = await create(); authState.signedIn = false;
    expect((await drafts.GET(new Request("http://localhost"),context(id))).status).toBe(401);
    expect((await drafts.PUT(request({document,expectedRevision:1}),context(id))).status).toBe(401);
    expect((await activation.POST(request({expectedRevision:1},"POST"),context(id))).status).toBe(401);
    authState.signedIn = true;
    expect((await drafts.PUT(request({document,expectedRevision:1},"PUT","https://foreign.test"),context(id))).status).toBe(403);
    expect((await activation.POST(request({expectedRevision:1},"POST","https://foreign.test"),context(id))).status).toBe(403);
  });
  it("rejects null, scalar, malformed and structurally invalid bodies as bad requests", async () => {
    const {id} = await create();
    for(const body of [null,5,[],{document:{},expectedRevision:1}]) expect((await drafts.PUT(request(body),context(id))).status).toBe(400);
    expect((await activation.POST(request(null,"POST"),context(id))).status).toBe(400);
    expect((await drafts.PUT(new Request("http://localhost",{method:"PUT",body:"{"}),context(id))).status).toBe(400);
    expect((await activation.POST(new Request("http://localhost",{method:"POST",body:"{"}),context(id))).status).toBe(400);
  });
  it("permits incomplete draft saves but gives contextual activation issues", async () => {
    const {id,document} = await create(); document.name="";
    expect((await drafts.PUT(request({document,expectedRevision:1}),context(id))).status).toBe(200);
    const result = await activation.POST(request({expectedRevision:2},"POST"),context(id));
    expect(result.status).toBe(400); expect((await result.json()).issues).toContainEqual({path:"name",message:"Enter a name."});
  });
});
