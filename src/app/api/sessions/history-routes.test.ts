import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
const cookie = vi.hoisted(() => ({ token: "" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => cookie.token ? { value: cookie.token } : undefined }) }));
let db: typeof import("@/lib/db");
let auth: typeof import("@/lib/auth");
let root: typeof import("./route");
let detail: typeof import("./[sessionId]/route");
let setRoute: typeof import("./[sessionId]/sets/route");
let repeat: typeof import("./[sessionId]/repeat/route");
let correction: typeof import("./[sessionId]/corrections/route");
let routine: typeof import("../workout-routines/route");
let recent: typeof import("./recent-exercises/route");
let dir: string;
let userId: number;
const context = (id: number) => ({ params: Promise.resolve({ sessionId: String(id) }) });
const req = (body?: unknown, origin?: string) => new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "magni-history-routes-"));
  vi.stubEnv("DB_PATH", path.join(dir, "test.sqlite"));
  db = await import("@/lib/db");
  (await import("@/features/workouts/migration")).runWorkoutHistoryMigration(db.db);
  auth = await import("@/lib/auth");
  userId = Number(db.db.prepare("INSERT INTO users(email,password_hash) VALUES ('history-api@example.com','hash')").run().lastInsertRowid);
  cookie.token = auth.createSession(userId).token;
  root = await import("./route"); detail = await import("./[sessionId]/route"); setRoute = await import("./[sessionId]/sets/route");
  repeat = await import("./[sessionId]/repeat/route"); correction = await import("./[sessionId]/corrections/route"); routine = await import("../workout-routines/route"); recent = await import("./recent-exercises/route");
});
afterAll(() => { db?.db.close(); fs.rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

it("creates, changes, finishes, corrects, repeats and saves routines with stable request retries", async () => {
  const create = { name: "Tuesday rows", date: "2026-09-01", newWorkout: true, requestKey: crypto.randomUUID() };
  const created = await root.POST(req(create)); expect(created.status).toBe(201);
  const session = await created.json();
  expect((await (await root.POST(req(create))).json()).id).toBe(session.id);
  const add = { name: "Row", sets: 3, reps: 10, weight: 40, requestKey: crypto.randomUUID() };
  const added = await (await setRoute.POST(req(add), context(session.id))).json();
  expect(added.sets).toHaveLength(3);
  expect((await (await setRoute.POST(req(add), context(session.id))).json()).sets.map((set: { id: number }) => set.id)).toEqual(added.sets.map((set: { id: number }) => set.id));
  expect((await setRoute.PUT(req({ setId: added.sets[0].id, actualReps: 10, actualWeight: 40 }), context(session.id))).status).toBe(200);
  expect((await (await detail.PATCH(req(), context(session.id))).json()).volume).toBe(400);
  const current = await (await detail.GET(req(), context(session.id))).json();
  const changes = { requestKey: crypto.randomUUID(), expectedRevision: current.revision, reason: "Correct reps", sets: [{ setId: added.sets[0].id, actualReps: 8, actualWeight: 40 }] };
  const corrected = await correction.POST(req(changes), context(session.id));
  expect(corrected.status).toBe(200); expect((await corrected.json()).recap.volume).toBe(320);
  expect((await correction.POST(req(changes), context(session.id))).status).toBe(200);
  const repeated = await repeat.POST(req({ requestKey: crypto.randomUUID(), date: "2026-09-03" }), context(session.id));
  expect(repeated.status).toBe(201); expect((await repeated.json()).sets[0].actual_reps).toBeNull();
  expect((await routine.POST(req({ sessionId: session.id, name: "Rows", requestKey: crypto.randomUUID() }))).status).toBe(201);
  expect((await (await recent.GET(new Request("http://localhost/api/sessions/recent-exercises?q=Row"))).json())[0].name).toBe("Row");
});

it("rejects cross-origin requests, malformed JSON and another owner's workout", async () => {
  expect((await root.POST(req({}, "https://evil.example"))).status).toBe(403);
  expect((await root.POST(new Request("http://localhost/api", { method: "POST", body: "{" }))).status).toBe(400);
  const session = await (await root.POST(req({ newWorkout: true, requestKey: crypto.randomUUID() }))).json();
  const other = Number(db.db.prepare("INSERT INTO users(email,password_hash) VALUES ('other-history-api@example.com','hash')").run().lastInsertRowid);
  cookie.token = auth.createSession(other).token;
  expect((await detail.GET(req(), context(session.id))).status).toBe(404);
  expect((await detail.PUT(req({ name: "Steal" }), context(session.id))).status).toBe(404);
  expect((await repeat.POST(req({ requestKey: crypto.randomUUID() }), context(session.id))).status).toBe(404);
  expect((await correction.POST(req({ expectedRevision: 1, sets: [] }), context(session.id))).status).toBe(404);
  cookie.token = "";
  expect((await routine.GET(new Request("http://localhost"))).status).toBe(401);
  cookie.token = auth.createSession(userId).token;
});

it("retains server values on stale actual updates and allows an identical lost-response retry", async () => {
  const session = await (await root.POST(req({ newWorkout: true, requestKey: crypto.randomUUID() }))).json();
  const added = await (await setRoute.POST(req({ name: "Conflict row", sets: 1, reps: 10, weight: 40 }), context(session.id))).json();
  const body = { setId: added.sets[0].id, actualReps: 10, actualWeight: 40, expectedActual: { reps: null, weight: null } };
  expect((await setRoute.PUT(req(body), context(session.id))).status).toBe(200);
  expect((await setRoute.PUT(req({ ...body, actualReps: 8 }), context(session.id))).status).toBe(409);
  expect((await setRoute.PUT(req(body), context(session.id))).status).toBe(200);
  expect((await (await detail.GET(req(), context(session.id))).json()).sets[0].actual_reps).toBe(10);
});
