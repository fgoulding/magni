import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const cookie = vi.hoisted(() => ({ token: "" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => cookie.token ? { value: cookie.token } : undefined }) }));

let database: typeof import("@/lib/db");
let auth: typeof import("@/lib/auth");
let sessions: typeof import("./route");
let session: typeof import("./[sessionId]/route");
let sets: typeof import("./[sessionId]/sets/route");
let stats: typeof import("@/features/programs/training-stats");
let directory: string;
let userId: number;

const context = (id: number) => ({ params: Promise.resolve({ sessionId: String(id) }) });
const request = (method: string, body?: unknown) => new Request("http://localhost/api/sessions", {
  method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "magni-logging-"));
  vi.stubEnv("DB_PATH", path.join(directory, "test.sqlite"));
  database = await import("@/lib/db");
  auth = await import("@/lib/auth");
  sessions = await import("./route");
  session = await import("./[sessionId]/route");
  sets = await import("./[sessionId]/sets/route");
  stats = await import("@/features/programs/training-stats");
});

beforeEach(() => {
  userId = Number(database.db.prepare("INSERT INTO users (email, password_hash) VALUES (?, 'hash')").run(`logging-${crypto.randomUUID()}@example.com`).lastInsertRowid);
  cookie.token = auth.createSession(userId).token;
});

afterAll(() => {
  database?.db.close();
  fs.rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function makeWorkout() {
  const start = await sessions.POST(request("POST"));
  expect(start.status).toBe(201);
  const { id } = await start.json() as { id: number };
  const add = await sets.POST(request("POST", { name: "Dumbbell Row", sets: 3, reps: 10, weight: 40 }), context(id));
  expect(add.status).toBe(201);
  const body = await add.json() as { sets: { id: number }[] };
  const log = await sets.PUT(request("PUT", { setId: body.sets[0].id, actualReps: 10, actualWeight: 40 }), context(id));
  expect(log.status).toBe(200);
  return { id, setIds: body.sets.map((set) => set.id) };
}

describe("performed training and safe completion", () => {
  it("counts one performed 10 × 40 set in recap, totals, weekly volume, lift detail, and categories", async () => {
    const { id } = await makeWorkout();
    const finish = await session.PATCH(request("PATCH"), context(id));
    expect(finish.status).toBe(200);
    const recap = await finish.json();
    expect(recap.volume).toBe(400);
    expect(recap.exercises[0].loggedSets).toBe(1);
    const actual = stats.getUserTrainingStats(userId);
    expect(actual.totals).toEqual({ sessions: 1, sets: 1, reps: 10, volume: 400 });
    expect(actual.weeklyVolume.at(-1)?.value).toBe(400);
    expect(actual.categorySplit).toEqual([{ category: "accessory", volume: 400, pct: 100 }]);
    expect(stats.getUserLiftDetail(userId, "Dumbbell Row").totalVolume).toBe(400);
  });

  it("returns the same successful recap after a lost finish response without rewriting completion time", async () => {
    const { id } = await makeWorkout();
    const first = await session.PATCH(request("PATCH"), context(id));
    expect(first.status).toBe(200);
    const timestamp = database.db.prepare("SELECT completed_at FROM sessions WHERE id = ?").get(id);
    const retry = await session.PATCH(request("PATCH"), context(id));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(await first.json());
    expect(database.db.prepare("SELECT completed_at FROM sessions WHERE id = ?").get(id)).toEqual(timestamp);
    expect(database.db.prepare("SELECT count(*) AS count FROM sessions WHERE user_id = ?").get(userId)).toEqual({ count: 1 });
  });

  it("does not infer a personal record from an unlogged prescription", async () => {
    const prior = await makeWorkout();
    await session.PATCH(request("PATCH"), context(prior.id));
    const current = await makeWorkout();
    database.db.prepare("UPDATE session_sets SET calculated_weight = 400 WHERE id = ?").run(current.setIds[1]);
    await session.PATCH(request("PATCH"), context(current.id));
    expect(stats.getSessionPrs(userId, current.id)).toEqual([]);
    expect(stats.getUserTrainingStats(userId).bigThree[0].maxWeight).toBe(40);
  });

  it("does not use an unlogged prior prescription to suppress a performed record", async () => {
    const prior = await makeWorkout();
    database.db.prepare("UPDATE session_sets SET calculated_weight = 400 WHERE id = ?").run(prior.setIds[1]);
    await session.PATCH(request("PATCH"), context(prior.id));
    const current = await makeWorkout();
    await sets.PUT(request("PUT", { setId: current.setIds[0], actualReps: 10, actualWeight: 50 }), context(current.id));
    await session.PATCH(request("PATCH"), context(current.id));
    expect(stats.getSessionPrs(userId, current.id)).toEqual([{ exercise: "Dumbbell Row", reps: 10, weight: 50, e1rm: 67 }]);
  });

  it("preserves legacy flat logged rows and agrees when a logged row has no recorded weight", async () => {
    const { id, setIds } = await makeWorkout();
    database.db.prepare("UPDATE session_sets SET sets = 3, actual_weight = NULL WHERE id = ?").run(setIds[0]);
    await session.PATCH(request("PATCH"), context(id));
    const recap = stats.getSessionRecap(userId, id)!;
    expect(recap.exercises[0].loggedSets).toBe(3);
    expect(stats.getUserTrainingStats(userId).totals.volume).toBe(recap.volume);
    expect(stats.getUserTrainingStats(userId).totals.sets).toBe(3);
  });

  it("does not expose a completed recap to another user or allow finishing a skipped workout", async () => {
    const { id } = await makeWorkout();
    database.db.prepare("UPDATE sessions SET status = 'skipped' WHERE id = ?").run(id);
    expect((await session.PATCH(request("PATCH"), context(id))).status).toBe(400);
    cookie.token = "";
    expect((await session.PATCH(request("PATCH"), context(id))).status).toBe(401);
    const otherId = Number(database.db.prepare("INSERT INTO users (email, password_hash) VALUES (?, 'hash')").run(`other-${crypto.randomUUID()}@example.com`).lastInsertRowid);
    cookie.token = auth.createSession(otherId).token;
    expect((await session.PATCH(request("PATCH"), context(id))).status).toBe(404);
  });
});
