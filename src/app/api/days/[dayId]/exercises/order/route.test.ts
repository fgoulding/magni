import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const cookieMock = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    cookies: {
      get: vi.fn((name: string) => {
        const value = store.get(name);
        return value ? { name, value } : undefined;
      }),
      set: vi.fn((name: string, value: string) => store.set(name, value)),
      delete: vi.fn((name: string) => store.delete(name)),
    },
  };
});

vi.mock("next/headers", () => ({ cookies: async () => cookieMock.cookies }));

let dbModule: typeof import("@/lib/db");
let auth: typeof import("@/lib/auth");
let orderRoute: typeof import("./route");

function putRequest(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (dayId: number) => ({ params: Promise.resolve({ dayId: String(dayId) }) });

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workout-order-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  dbModule = await import("@/lib/db");
  auth = await import("@/lib/auth");
  orderRoute = await import("./route");
});

beforeEach(() => {
  cookieMock.store.clear();
  vi.clearAllMocks();
  dbModule.db.exec("DELETE FROM exercises; DELETE FROM days; DELETE FROM programs; DELETE FROM auth_sessions; DELETE FROM users;");
});

function seedDay(): { dayId: number; ex: number[] } {
  const userId = Number(dbModule.db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run("o@x.com", "h").lastInsertRowid);
  cookieMock.store.set("auth_token", auth.createSession(userId).token);
  const programId = Number(dbModule.db.prepare("INSERT INTO programs (user_id, name) VALUES (?, ?)").run(userId, "P").lastInsertRowid);
  const dayId = Number(dbModule.db.prepare("INSERT INTO days (program_id, name, day_number) VALUES (?, ?, ?)").run(programId, "D", 1).lastInsertRowid);
  const ins = dbModule.db.prepare("INSERT INTO exercises (day_id, name, training_max) VALUES (?, ?, ?)");
  const ex = ["A", "B", "C"].map((n) => Number(ins.run(dayId, n, 100).lastInsertRowid));
  return { dayId, ex };
}

function rows(dayId: number) {
  return dbModule.db
    .prepare("SELECT id, sort_order, superset_group FROM exercises WHERE day_id = ? ORDER BY sort_order")
    .all(dayId) as { id: number; sort_order: number; superset_group: string | null }[];
}

describe("PUT /api/days/[dayId]/exercises/order", () => {
  it("reorders and groups exercises into a superset, collapsing singletons", async () => {
    const { dayId, ex } = seedDay();
    // New order: C, A, B — with A+B as a superset (group 1), C standalone (group 0, singleton).
    const res = await orderRoute.PUT(
      putRequest({ items: [{ id: ex[2], group: 0 }, { id: ex[0], group: 1 }, { id: ex[1], group: 1 }] }),
      params(dayId),
    );
    expect(res.status).toBe(200);

    const ordered = rows(dayId);
    expect(ordered.map((r) => r.id)).toEqual([ex[2], ex[0], ex[1]]);
    expect(ordered[0].superset_group).toBeNull(); // singleton collapsed
    expect(ordered[1].superset_group).not.toBeNull();
    expect(ordered[1].superset_group).toBe(ordered[2].superset_group); // shared token
  });

  it("rejects a payload that isn't an exact permutation of the day", async () => {
    const { dayId, ex } = seedDay();
    const res = await orderRoute.PUT(putRequest({ items: [{ id: ex[0], group: null }] }), params(dayId));
    expect(res.status).toBe(400);
  });

  it("404s for a day the user does not own", async () => {
    const { ex } = seedDay();
    const otherDay = 999999;
    const res = await orderRoute.PUT(putRequest({ items: [{ id: ex[0], group: null }] }), params(otherDay));
    expect(res.status).toBe(404);
  });
});
