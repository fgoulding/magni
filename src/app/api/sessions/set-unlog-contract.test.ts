import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getProgramDefault } from "@/features/program-defaults/defaults";
import type { HistorySet, WorkoutSession } from "@/features/workouts/types";

const cookie = vi.hoisted(() => ({ token: "" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => cookie.token ? { value: cookie.token } : undefined }) }));

let database: typeof import("@/lib/db");
let auth: typeof import("@/lib/auth");
let quickRoute: typeof import("./route");
let detailRoute: typeof import("./[sessionId]/route");
let setRoute: typeof import("./[sessionId]/sets/route");
let programRoute: typeof import("../programs/route");
let plannedRoute: typeof import("../programs/[id]/sessions/route");
let completeRoute: typeof import("../programs/[id]/complete-and-advance/route");
let directory: string;
let userId: number;
type SessionResponse = Omit<WorkoutSession, "sets"> & {
  occurrence_id: number | null;
  program_run_id: number | null;
  sets: (HistorySet & { shared_exercise_key: string | null })[];
};

const context = (id: number) => ({ params: Promise.resolve({ sessionId: String(id) }) });
const programContext = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (body: unknown = {}, origin?: string) => new Request("http://localhost/api", {
  method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body),
});
const actual = (set: HistorySet) => ({ reps: set.actual_reps, weight: set.actual_weight });
const undoBody = (set: HistorySet) => ({ setId: set.id, actualReps: null, actualWeight: null, expectedActual: actual(set) });
async function getSession(id: number): Promise<SessionResponse> {
  const response = await detailRoute.GET(request(), context(id));
  expect(response.status).toBe(200);
  return response.json();
}
async function quickSession(): Promise<SessionResponse> {
  const created = await quickRoute.POST(request({ newWorkout: true, requestKey: crypto.randomUUID(), name: "Undo contract", unit: "kg" }));
  expect(created.status).toBe(201);
  const { id } = await created.json();
  const added = await setRoute.POST(request({ name: "Dumbbell row", prescription: [{ reps: 8, weight: 42.5 }, { reps: 6, weight: 45 }] }), context(id));
  expect(added.status).toBe(201);
  return getSession(id);
}
async function save(session: WorkoutSession, set: HistorySet, reps = 8, weight = 42.5): Promise<HistorySet & { sessionRevision: number }> {
  const response = await setRoute.PUT(request({ setId: set.id, actualReps: reps, actualWeight: weight, expectedActual: actual(set) }), context(session.id));
  expect(response.status).toBe(200);
  return response.json();
}

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "magni-set-unlog-"));
  vi.stubEnv("DB_PATH", path.join(directory, "test.sqlite"));
  database = await import("@/lib/db");
  auth = await import("@/lib/auth");
  quickRoute = await import("./route");
  detailRoute = await import("./[sessionId]/route");
  setRoute = await import("./[sessionId]/sets/route");
  programRoute = await import("../programs/route");
  plannedRoute = await import("../programs/[id]/sessions/route");
  completeRoute = await import("../programs/[id]/complete-and-advance/route");
});
beforeEach(() => {
  userId = Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES (?, 'hash')").run(`unlog-${crypto.randomUUID()}@example.com`).lastInsertRowid);
  cookie.token = auth.createSession(userId).token;
});
afterAll(() => { database?.db.close(); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });

// These pin existing nullable-actual APIs before the new UI exposes undo. No backend change is required.
describe("in-progress set unlog contract", () => {
  it("clears actuals while preserving the set, prescription, exercise identity, notes and other sets", async () => {
    const session = await quickSession();
    const first = await save(session, session.sets[0]);
    await save(session, session.sets[1], 6, 45);
    database.db.prepare("UPDATE session_sets SET notes='User note' WHERE id=?").run(first.id);
    const sourceBefore = database.db.prepare("SELECT * FROM exercise_set_sources WHERE session_set_id=?").get(first.id);
    expect(sourceBefore).toBeDefined();
    const before = await getSession(session.id);
    const response = await setRoute.PUT(request(undoBody(first)), context(session.id));
    expect(response.status).toBe(200);
    const acknowledged = await response.json();
    expect(acknowledged).toMatchObject({ actual_reps: null, actual_weight: null, sessionRevision: before.revision + 1, sessionMetadata: { unit: "kg", revision: before.revision + 1 } });
    const after = await getSession(session.id);
    expect(after.sets[0]).toEqual({ ...before.sets[0], actual_reps: null, actual_weight: null });
    expect(after.sets[1]).toEqual(before.sets[1]);
    expect(after).toMatchObject({ id: before.id, date: before.date, status: "in_progress", unit: "kg", loggedSets: 1, volume: 270 });
    expect(database.db.prepare("SELECT * FROM exercise_set_sources WHERE session_set_id=?").get(first.id)).toEqual(sourceBefore);
  });

  it("acknowledges an identical lost-response undo retry without another revision increment", async () => {
    const session = await quickSession();
    const logged = await save(session, session.sets[0]);
    const body = undoBody(logged);
    const first = await setRoute.PUT(request(body), context(session.id));
    const firstAck = await first.json();
    expect(first.status).toBe(200);
    const retry = await setRoute.PUT(request(body), context(session.id));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(firstAck);
    expect((await getSession(session.id)).revision).toBe(logged.sessionRevision + 1);
  });

  it("rejects stale undo after another device changes actuals, then accepts explicitly refreshed values", async () => {
    const session = await quickSession();
    const logged = await save(session, session.sets[0]);
    const changed = await save(session, logged, 10, 45);
    const response = await setRoute.PUT(request(undoBody(logged)), context(session.id));
    expect(response.status).toBe(409);
    expect((await getSession(session.id)).sets[0]).toMatchObject({ actual_reps: 10, actual_weight: 45 });
    expect((await getSession(session.id)).revision).toBe(changed.sessionRevision);
    expect((await setRoute.PUT(request(undoBody(changed)), context(session.id))).status).toBe(200);
  });

  it("keeps zero reps as a recorded attempt until explicitly unlogged", async () => {
    const session = await quickSession();
    const zero = await save(session, session.sets[0], 0, 42.5);
    expect((await getSession(session.id)).loggedSets).toBe(1);
    expect((await setRoute.PUT(request(undoBody(zero)), context(session.id))).status).toBe(200);
    expect((await getSession(session.id)).loggedSets).toBe(0);
  });

  it("rejects foreign sets, foreign owners and cross-origin or unauthenticated undo", async () => {
    const session = await quickSession();
    const otherSession = await quickSession();
    const logged = await save(session, session.sets[0]);
    const body = undoBody(logged);
    expect((await setRoute.PUT(request(body), context(otherSession.id))).status).toBe(404);
    expect((await setRoute.PUT(request(body, "https://elsewhere.example"), context(session.id))).status).toBe(403);
    const other = Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES (?, 'hash')").run(`other-${crypto.randomUUID()}@example.com`).lastInsertRowid);
    cookie.token = auth.createSession(other).token;
    expect((await setRoute.PUT(request(body), context(session.id))).status).toBe(404);
    cookie.token = "";
    expect((await setRoute.PUT(request(body), context(session.id))).status).toBe(401);
    cookie.token = auth.createSession(userId).token;
    expect((await getSession(session.id)).sets[0]).toMatchObject({ actual_reps: 8, actual_weight: 42.5 });
  });

  it("finishes with undone sets unperformed and disallows active-session undo of historical records", async () => {
    const session = await quickSession();
    const first = await save(session, session.sets[0]);
    const second = await save(session, session.sets[1], 6, 45);
    expect((await setRoute.PUT(request(undoBody(first)), context(session.id))).status).toBe(200);
    const finish = await detailRoute.PATCH(request(), context(session.id));
    expect(finish.status).toBe(200);
    expect(await finish.json()).toMatchObject({ volume: 270 });
    const before = await getSession(session.id);
    expect(before.status).toBe("completed");
    expect((await setRoute.PUT(request(undoBody(second)), context(session.id))).status).toBe(400);
    expect(await getSession(session.id)).toEqual(before);
  });

  it("preserves planned prescriptions and requires restored progression reps before completing exactly once", async () => {
    const template = getProgramDefault("basic-strength-3-day")!;
    const created = await programRoute.POST(request({ name: template.snapshot.name, numWeeks: template.snapshot.numWeeks, snapshot: template.snapshot }));
    expect(created.status).toBe(201);
    const { id: programId } = await created.json();
    const day = database.db.prepare("SELECT id FROM days WHERE program_id=? AND day_number=1").get(programId) as { id: number };
    const started = await plannedRoute.POST(request({ dayId: day.id }), programContext(programId));
    expect(started.status).toBe(201);
    const startedSession = await started.json() as WorkoutSession;
    const session = await getSession(startedSession.id);
    const lastSets = [...new Map(session.sets.map(set => [set.shared_exercise_key, set])).values()];
    const logged: HistorySet[] = [];
    for (const set of lastSets) logged.push(await save(session, set, set.rep_out_target, set.calculated_weight));
    const before = await getSession(session.id);
    expect((await setRoute.PUT(request(undoBody(logged[0])), context(session.id))).status).toBe(200);
    const unlogged = await getSession(session.id);
    expect(unlogged.sets).toEqual(before.sets.map(set => set.id === logged[0].id ? { ...set, actual_reps: null, actual_weight: null } : set));
    expect(unlogged).toMatchObject({ id: session.id, program_id: programId, occurrence_id: session.occurrence_id, program_run_id: session.program_run_id });
    const rejectedFinish = await completeRoute.POST(request({ sessionId: session.id }), programContext(programId));
    expect(rejectedFinish.status).toBe(400);
    expect((await getSession(session.id)).status).toBe("in_progress");
    const undone = unlogged.sets.find(set => set.id === logged[0].id)!;
    await save(session, undone, undone.rep_out_target + 2, undone.calculated_weight);
    const finish = await completeRoute.POST(request({ sessionId: session.id }), programContext(programId));
    expect(finish.status).toBe(200);
    const progression = database.db.prepare("SELECT * FROM program_run_expected_maxes WHERE program_run_id=? ORDER BY shared_exercise_key").all(session.program_run_id);
    const finished = await getSession(session.id);
    expect(finished.status).toBe("completed");
    const retry = await completeRoute.POST(request({ sessionId: session.id }), programContext(programId));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ alreadyCompleted: true });
    expect(database.db.prepare("SELECT * FROM program_run_expected_maxes WHERE program_run_id=? ORDER BY shared_exercise_key").all(session.program_run_id)).toEqual(progression);
    expect((await setRoute.PUT(request(undoBody(finished.sets.find(set => set.id === logged[0].id)!)), context(session.id))).status).toBe(400);
    expect(await getSession(session.id)).toEqual(finished);
  });
});
