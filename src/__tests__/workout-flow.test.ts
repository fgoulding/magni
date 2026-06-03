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
      set: vi.fn((name: string, value: string) => {
        store.set(name, value);
      }),
      delete: vi.fn((name: string) => {
        store.delete(name);
      }),
    },
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => cookieMock.cookies,
}));

let dbModule: typeof import("@/lib/db");
let registerRoute: typeof import("@/app/api/auth/register/route");
let programsRoute: typeof import("@/app/api/programs/route");
let daysRoute: typeof import("@/app/api/programs/[id]/days/route");
let exercisesRoute: typeof import("@/app/api/days/[dayId]/exercises/route");
let sessionsRoute: typeof import("@/app/api/programs/[id]/sessions/route");
let setRoute: typeof import("@/app/api/sessions/[sessionId]/sets/route");
let completeRoute: typeof import("@/app/api/programs/[id]/complete-and-advance/route");
let historyRoute: typeof import("@/app/api/sessions/route");
let settingsRoute: typeof import("@/app/api/settings/route");

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params<T extends Record<string, string>>(value: T): { params: Promise<T> } {
  return { params: Promise.resolve(value) };
}

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workout-flow-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  dbModule = await import("@/lib/db");
  registerRoute = await import("@/app/api/auth/register/route");
  programsRoute = await import("@/app/api/programs/route");
  daysRoute = await import("@/app/api/programs/[id]/days/route");
  exercisesRoute = await import("@/app/api/days/[dayId]/exercises/route");
  sessionsRoute = await import("@/app/api/programs/[id]/sessions/route");
  setRoute = await import("@/app/api/sessions/[sessionId]/sets/route");
  completeRoute = await import("@/app/api/programs/[id]/complete-and-advance/route");
  historyRoute = await import("@/app/api/sessions/route");
  settingsRoute = await import("@/app/api/settings/route");
});

beforeEach(() => {
  cookieMock.store.clear();
  vi.clearAllMocks();
  dbModule.db.exec(
    "DELETE FROM session_sets; DELETE FROM sessions; DELETE FROM week_settings; DELETE FROM exercises; DELETE FROM days; DELETE FROM programs; DELETE FROM user_settings; DELETE FROM auth_sessions; DELETE FROM users;",
  );
});

describe("workout flow", () => {
  it("registers, builds a program, logs a workout, completes it, and records history", async () => {
    const registerResponse = await registerRoute.POST(
      jsonRequest({ email: "flow@example.com", password: "secret123" }),
    );
    expect(registerResponse.status).toBe(201);

    const settingsResponse = await settingsRoute.POST(jsonRequest({ rounding: 5 }));
    expect(settingsResponse.status).toBe(200);

    const programResponse = await programsRoute.POST(jsonRequest({ name: "Flow Program", numWeeks: 7 }));
    const program = await programResponse.json();
    expect(programResponse.status).toBe(201);

    const dayResponse = await daysRoute.POST(jsonRequest({ name: "Lower" }), params({ id: String(program.id) }));
    const day = await dayResponse.json();
    expect(dayResponse.status).toBe(201);

    const exerciseResponse = await exercisesRoute.POST(
      jsonRequest({ name: "Squat", trainingMax: 300, category: "main", progressionType: "SBS" }),
      params({ dayId: String(day.id) }),
    );
    const exercise = await exerciseResponse.json();
    expect(exerciseResponse.status).toBe(201);

    const sessionResponse = await sessionsRoute.POST(
      jsonRequest({ dayId: day.id }),
      params({ id: String(program.id) }),
    );
    const session = await sessionResponse.json();
    expect(sessionResponse.status).toBe(201);
    expect(session.sets).toHaveLength(5);  // 5 ramp sets for SBS

    const setResponse = await setRoute.PUT(
      jsonRequest({ setId: session.sets[0].id, actualReps: 12, actualWeight: 210 }),
      params({ sessionId: String(session.id) }),
    );
    expect(setResponse.status).toBe(200);

    const completeResponse = await completeRoute.POST(
      jsonRequest({ sessionId: session.id }),
      params({ id: String(program.id) }),
    );
    expect(completeResponse.status).toBe(200);

    const exerciseRow = dbModule.db.prepare("SELECT training_max FROM exercises WHERE id = ?").get(exercise.id) as {
      training_max: number;
    };
    const runMax = dbModule.db
      .prepare(
        `
          SELECT expected_max
          FROM program_run_expected_maxes
          WHERE program_run_id = (SELECT program_run_id FROM programs WHERE id = ?)
            AND shared_exercise_key = (
              SELECT shared_exercise_key
              FROM exercises
              WHERE id = ?
            )
        `,
      )
      .get(program.id, exercise.id) as { expected_max: number };
    expect(exerciseRow.training_max).toBe(300);
    expect(runMax.expected_max).toBe(305);

    const historyResponse = await historyRoute.GET();
    const history = (await historyResponse.json()) as { program_name: string; day_name: string; completed: number }[];
    expect(history).toEqual([
      expect.objectContaining({
        program_name: "Flow Program",
        day_name: "Lower",
        completed: 1,
      }),
    ]);
  });
});
