import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isValidElement, type ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getProgramDefault } from "@/features/program-defaults/defaults";

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
let auth: typeof import("@/lib/auth");
let programsRoute: typeof import("./route");
let programRoute: typeof import("./[id]/route");
let daysRoute: typeof import("./[id]/days/route");
let dayRoute: typeof import("../days/[dayId]/route");
let exercisesRoute: typeof import("../days/[dayId]/exercises/route");
let exerciseRoute: typeof import("../exercises/[exerciseId]/route");
let snapshotRoute: typeof import("./[id]/snapshot/route");
let holdsRoute: typeof import("./[id]/holds/route");
let activeHoldRoute: typeof import("./[id]/holds/active/route");
let programPage: typeof import("@/app/programs/[id]/page");
let programsPage: typeof import("@/app/programs/page");
let todayPage: typeof import("@/app/today/page");
let programService: typeof import("@/features/programs/program-service");

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

function createUser(email: string): number {
  const result = dbModule.db
    .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
    .run(email, "hash");
  return Number(result.lastInsertRowid);
}

function authenticate(userId: number): void {
  const { token } = auth.createSession(userId);
  cookieMock.store.set("auth_token", token);
}

function collectRenderedText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return String(node);
  if (Array.isArray(node)) return node.map(collectRenderedText).join(" ");
  if (
    isValidElement<{ children?: ReactNode; value?: unknown; exercises?: unknown; name?: unknown; dayNumber?: unknown }>(
      node,
    )
  ) {
    if (node.type === "input" && node.props.value !== undefined) {
      return `${String(node.props.value)} ${collectRenderedText(node.props.children)}`;
    }
    // Exercises render inside the SortableDayExercises client component, which the
    // tree walk doesn't expand — pull their text from the `exercises` prop.
    const exercisesText = Array.isArray(node.props.exercises)
      ? (node.props.exercises as { name?: unknown; category?: unknown; progression_type?: unknown }[])
          .map((e) => `${e.name ?? ""} ${e.category ?? ""} ${e.progression_type ?? ""}`)
          .join(" ")
      : "";
    // The day name is a prop on the DaySection client component (has `dayNumber`),
    // not rendered text the walk can reach.
    const dayName =
      node.props.dayNumber !== undefined && typeof node.props.name === "string" ? node.props.name : "";
    return `${exercisesText} ${dayName} ${collectRenderedText(node.props.children)}`;
  }
  return "";
}

function collectWorkoutProgramNames(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return [];
  if (Array.isArray(node)) return node.flatMap(collectWorkoutProgramNames);
  if (isValidElement<{ children?: ReactNode; programName?: unknown; currentDay?: unknown }>(node)) {
    const names =
      typeof node.props.programName === "string" && typeof node.props.currentDay === "number"
        ? [node.props.programName]
        : [];
    return [...names, ...collectWorkoutProgramNames(node.props.children)];
  }
  return [];
}

function collectWorkoutCards(node: ReactNode): { programName: string; dayName: string; currentDay: number }[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return [];
  if (Array.isArray(node)) return node.flatMap(collectWorkoutCards);
  if (
    isValidElement<{
      children?: ReactNode;
      programName?: unknown;
      dayName?: unknown;
      currentDay?: unknown;
    }>(node)
  ) {
    const card =
      typeof node.props.programName === "string" &&
      typeof node.props.dayName === "string" &&
      typeof node.props.currentDay === "number"
        ? [{ programName: node.props.programName, dayName: node.props.dayName, currentDay: node.props.currentDay }]
        : [];
    return [...card, ...collectWorkoutCards(node.props.children)];
  }
  return [];
}

function collectExerciseInitialNames(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return [];
  if (Array.isArray(node)) return node.flatMap(collectExerciseInitialNames);
  if (isValidElement<{ children?: ReactNode; initialName?: unknown; exercises?: unknown }>(node)) {
    const names = typeof node.props.initialName === "string" ? [node.props.initialName] : [];
    const propNames = Array.isArray(node.props.exercises)
      ? (node.props.exercises as { name?: unknown }[])
          .filter((e) => typeof e.name === "string")
          .map((e) => e.name as string)
      : [];
    return [...names, ...propNames, ...collectExerciseInitialNames(node.props.children)];
  }
  return [];
}

function collectExerciseTrainingMaxes(node: ReactNode): number[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return [];
  if (Array.isArray(node)) return node.flatMap(collectExerciseTrainingMaxes);
  if (isValidElement<{ children?: ReactNode; initialValue?: unknown; exercises?: unknown }>(node)) {
    const values = typeof node.props.initialValue === "number" ? [node.props.initialValue] : [];
    const propValues = Array.isArray(node.props.exercises)
      ? (node.props.exercises as { training_max?: unknown }[])
          .filter((e) => typeof e.training_max === "number")
          .map((e) => e.training_max as number)
      : [];
    return [...values, ...propValues, ...collectExerciseTrainingMaxes(node.props.children)];
  }
  return [];
}

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workout-program-routes-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  dbModule = await import("@/lib/db");
  auth = await import("@/lib/auth");
  programsRoute = await import("./route");
  programRoute = await import("./[id]/route");
  daysRoute = await import("./[id]/days/route");
  dayRoute = await import("../days/[dayId]/route");
  exercisesRoute = await import("../days/[dayId]/exercises/route");
  exerciseRoute = await import("../exercises/[exerciseId]/route");
  snapshotRoute = await import("./[id]/snapshot/route");
  holdsRoute = await import("./[id]/holds/route");
  activeHoldRoute = await import("./[id]/holds/active/route");
  programPage = await import("@/app/programs/[id]/page");
  programsPage = await import("@/app/programs/page");
  todayPage = await import("@/app/today/page");
  programService = await import("@/features/programs/program-service");
});

beforeEach(() => {
  cookieMock.store.clear();
  vi.clearAllMocks();
  dbModule.db.exec(
    "DELETE FROM session_sets; DELETE FROM sessions; DELETE FROM week_settings; DELETE FROM exercises; DELETE FROM days; DELETE FROM programs; DELETE FROM program_run_expected_maxes; DELETE FROM program_run_schedule_days; DELETE FROM program_run_holds; DELETE FROM program_runs; DELETE FROM program_definition_week_settings; DELETE FROM program_definition_exercises; DELETE FROM program_definition_days; DELETE FROM program_definitions; DELETE FROM user_settings; DELETE FROM auth_sessions; DELETE FROM users;",
  );
});

describe("program APIs", () => {
  it("calendar lift preview shows the real set count for prescription accessories", async () => {
    const userId = createUser("preview-superset@example.com");
    authenticate(userId);
    const snapshot = getProgramDefault("superset-hypertrophy-3-day")!.snapshot;
    const created = await (
      await programsRoute.POST(jsonRequest({ name: "SS", numWeeks: 7, snapshot }))
    ).json();

    const day = dbModule.db
      .prepare(
        `SELECT pdd.id FROM program_definition_days pdd
         JOIN programs p ON p.program_definition_id = pdd.program_definition_id
         WHERE p.id = ? AND pdd.name = 'Squat'`,
      )
      .get(created.id) as { id: number };

    const lifts = programService.getProgramDayLiftPreview(userId, created.id, day.id, 1);
    const incline = lifts.find((l) => l.name === "DB Incline Bench Press")!;
    const squat = lifts.find((l) => l.name === "Squat")!;

    // Main SBS lift is correct (ramp = one row per set).
    expect(squat.set_count).toBe(5);
    // Accessory prescribed 3×12 must preview as 3 sets, not 1.
    expect(incline).toMatchObject({ set_count: 3, reps: 12 });
  });

  it("rejects unauthenticated program requests", async () => {
    expect((await programsRoute.GET()).status).toBe(401);
    expect((await programsRoute.POST(jsonRequest({ name: "No Session" }))).status).toBe(401);
    expect((await programRoute.GET(new Request("http://localhost"), params({ id: "1" }))).status).toBe(401);
    expect((await programRoute.PUT(jsonRequest({ name: "No Session" }), params({ id: "1" }))).status).toBe(401);
    expect((await programRoute.DELETE(new Request("http://localhost"), params({ id: "1" }))).status).toBe(401);
    expect((await holdsRoute.POST(jsonRequest({ startDate: "2026-06-01", endDate: "2026-06-07" }), params({ id: "1" }))).status).toBe(401);
    expect((await activeHoldRoute.DELETE(new Request("http://localhost"), params({ id: "1" }))).status).toBe(401);
  });

  it("lists, fetches, updates, and deletes only programs owned by the current user", async () => {
    const userA = createUser("a@example.com");
    const userB = createUser("b@example.com");
    authenticate(userA);

    const ownCreateResponse = await programsRoute.POST(jsonRequest({ name: "A Program", numWeeks: 4 }));
    const ownProgram = await ownCreateResponse.json();

    const otherProgram = dbModule.db
      .prepare("INSERT INTO programs (user_id, name) VALUES (?, ?)")
      .run(userB, "B Program");

    const listResponse = await programsRoute.GET();
    const list = (await listResponse.json()) as { name: string }[];
    expect(list.map((program) => program.name)).toEqual(["A Program"]);

    expect((await programRoute.GET(new Request("http://localhost"), params({ id: String(ownProgram.id) }))).status).toBe(
      200,
    );
    expect(
      (await programRoute.GET(new Request("http://localhost"), params({ id: String(otherProgram.lastInsertRowid) })))
        .status,
    ).toBe(404);
    expect(
      (await programRoute.PUT(jsonRequest({ name: "Nope" }), params({ id: String(otherProgram.lastInsertRowid) })))
        .status,
    ).toBe(404);
    expect(
      (await programRoute.DELETE(new Request("http://localhost"), params({ id: String(otherProgram.lastInsertRowid) })))
        .status,
    ).toBe(404);
  });

  it("archives deleted programs without deleting user session history", async () => {
    const userId = createUser("program-archive-history@example.com");
    authenticate(userId);

    const program = await (await programsRoute.POST(jsonRequest({ name: "Archive Program" }))).json();
    const day = await (await daysRoute.POST(jsonRequest({ name: "Lower" }), params({ id: String(program.id) }))).json();
    const session = dbModule.db
      .prepare(
        "INSERT INTO sessions (program_id, user_id, day_id, week_number, completed, status, program_name, day_name) VALUES (?, ?, ?, ?, 1, 'completed', ?, ?)",
      )
      .run(program.id, userId, day.id, 1, "Archive Program", "Lower");

    const response = await programRoute.DELETE(new Request("http://localhost"), params({ id: String(program.id) }));

    expect(response.status).toBe(200);
    expect(dbModule.db.prepare("SELECT id FROM sessions WHERE id = ?").get(session.lastInsertRowid)).toEqual({
      id: session.lastInsertRowid,
    });
    expect(
      dbModule.db.prepare("SELECT is_active, archived_at FROM programs WHERE id = ?").get(program.id),
    ).toEqual(expect.objectContaining({ is_active: 0, archived_at: expect.any(String) }));
    expect((await programRoute.GET(new Request("http://localhost"), params({ id: String(program.id) }))).status).toBe(404);
  });

  it("creates and cancels a hold for an owned program run", async () => {
    // Pin "today" inside the hold window — cancelling an ACTIVE hold only applies
    // when today falls within it, so this must not depend on the real date.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00-07:00"));
    try {
      const userId = createUser("program-hold-route@example.com");
      authenticate(userId);

      const program = await (await programsRoute.POST(jsonRequest({ name: "Hold Program" }))).json();
      const createResponse = await holdsRoute.POST(
        jsonRequest({ startDate: "2026-06-08", endDate: "2026-06-21", reason: "Vacation" }),
        params({ id: String(program.id) }),
      );
      const hold = await createResponse.json();

      expect(createResponse.status).toBe(201);
      expect(hold).toMatchObject({
        start_date: "2026-06-08",
        end_date: "2026-06-21",
        reason: "Vacation",
        canceled_at: null,
      });

      const cancelResponse = await activeHoldRoute.DELETE(
        new Request("http://localhost", { method: "DELETE" }),
        params({ id: String(program.id) }),
      );
      const cancelBody = await cancelResponse.json();

      expect(cancelResponse.status).toBe(200);
      expect(cancelBody).toEqual({ success: true, canceled: true });
      expect(
        dbModule.db.prepare("SELECT canceled_at FROM program_run_holds WHERE id = ?").get(hold.id),
      ).toEqual({ canceled_at: expect.any(String) });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fetches an owned program with days, exercises, and generated week settings", async () => {
    const userId = createUser("program-detail@example.com");
    authenticate(userId);

    const program = await (await programsRoute.POST(jsonRequest({ name: "Detail Program" }))).json();
    const day = await (await daysRoute.POST(jsonRequest({ name: "Lower" }), params({ id: String(program.id) }))).json();
    await exercisesRoute.POST(
      jsonRequest({ name: "Squat", trainingMax: 300, category: "main", progressionType: "SBS" }),
      params({ dayId: String(day.id) }),
    );

    const response = await programRoute.GET(new Request("http://localhost"), params({ id: String(program.id) }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: program.id,
      name: "Detail Program",
      days: [
        {
          name: "Lower",
          exercises: [
            {
              name: "Squat",
              progression_type: "sbs",
            },
          ],
        },
      ],
    });
    expect(body.days[0].exercises[0].weekSettings).toHaveLength(35);  // 7 weeks × 5 ramp sets
    expect(
      dbModule.db
        .prepare(
          `
            SELECT pdd.name AS day_name, pde.name AS exercise_name, pde.stable_key, prx.expected_max
            FROM programs p
            JOIN program_definition_days pdd ON pdd.program_definition_id = p.program_definition_id
            JOIN program_definition_exercises pde ON pde.program_definition_day_id = pdd.id
            JOIN program_run_expected_maxes prx
              ON prx.program_run_id = p.program_run_id
             AND prx.shared_exercise_key = pde.stable_key
            WHERE p.id = ?
          `,
        )
        .get(program.id),
    ).toEqual({
      day_name: "Lower",
      exercise_name: "Squat",
      stable_key: expect.any(String),
      expected_max: 300,
    });
  });

  it("creates a private definition and active run for new custom programs", async () => {
    const userId = createUser("program-context@example.com");
    authenticate(userId);

    const response = await programsRoute.POST(jsonRequest({ name: "Context Program", numWeeks: 4 }));
    const program = await response.json();
    const row = dbModule.db
      .prepare(
        `
          SELECT
            p.program_definition_id,
            p.program_run_id,
            pd.name AS definition_name,
            pd.num_weeks AS definition_weeks,
            pr.name AS run_name,
            pr.status AS run_status
          FROM programs p
          JOIN program_definitions pd ON pd.id = p.program_definition_id
          JOIN program_runs pr ON pr.id = p.program_run_id
          WHERE p.id = ?
        `,
      )
      .get(program.id);

    expect(response.status).toBe(201);
    expect(row).toEqual(
      expect.objectContaining({
        program_definition_id: expect.any(Number),
        program_run_id: expect.any(Number),
        definition_name: "Context Program",
        definition_weeks: 4,
        run_name: "Context Program",
        run_status: "active",
      }),
    );
  });

  it("uses program runs as canonical state when legacy program rows disagree", async () => {
    const userId = createUser("run-canonical@example.com");
    authenticate(userId);

    const response = await programsRoute.POST(jsonRequest({ name: "Legacy Name", numWeeks: 4 }));
    const program = await response.json();
    dbModule.db
      .prepare("UPDATE programs SET name = 'Stale Legacy', current_week = 1, current_day = 1, is_active = 1 WHERE id = ?")
      .run(program.id);
    dbModule.db
      .prepare(
        "UPDATE program_runs SET name = 'Canonical Run', current_week = 3, current_day = 2, status = 'paused' WHERE id = (SELECT program_run_id FROM programs WHERE id = ?)",
      )
      .run(program.id);

    const detailResponse = await programRoute.GET(new Request("http://localhost"), params({ id: String(program.id) }));
    const detail = await detailResponse.json();
    const list = (await (await programsRoute.GET()).json()) as {
      id: number;
      name: string;
      current_week: number;
      current_day: number;
      is_active: number;
    }[];

    expect(detail).toEqual(
      expect.objectContaining({
        id: program.id,
        name: "Canonical Run",
        current_week: 3,
        current_day: 2,
        is_active: 0,
      }),
    );
    expect(list.find((item) => item.id === program.id)).toEqual(
      expect.objectContaining({
        name: "Canonical Run",
        current_week: 3,
        current_day: 2,
        is_active: 0,
      }),
    );
    const homeText = collectRenderedText(await programsPage.default());
    const todayCards = collectWorkoutProgramNames(await todayPage.default());
    expect(homeText).toContain("Canonical Run");
    expect(homeText).not.toContain("Stale Legacy");
    expect(todayCards).not.toContain("Canonical Run");
  });

  it("uses definition rows as canonical program detail when generated rows are stale", async () => {
    const userId = createUser("definition-canonical-detail@example.com");
    authenticate(userId);

    const program = await (await programsRoute.POST(jsonRequest({ name: "Definition Detail", numWeeks: 3 }))).json();
    const day = await (await daysRoute.POST(jsonRequest({ name: "Lower" }), params({ id: String(program.id) }))).json();
    const exercise = await (
      await exercisesRoute.POST(
        jsonRequest({ name: "Squat", trainingMax: 315, category: "main", progressionType: "sbs" }),
        params({ dayId: String(day.id) }),
      )
    ).json();
    dbModule.db.prepare("UPDATE days SET name = 'Stale Day' WHERE id = ?").run(day.id);
    dbModule.db.prepare("UPDATE exercises SET name = 'Stale Lift', training_max = 100 WHERE id = ?").run(exercise.id);
    dbModule.db
      .prepare(
        `
          UPDATE program_definition_week_settings
          SET reps = 9
          WHERE program_definition_exercise_id = (
            SELECT id FROM program_definition_exercises WHERE stable_key = (
              SELECT shared_exercise_key FROM exercises WHERE id = ?
            )
          )
          AND week_number = 1
          AND set_number = 1
        `,
      )
      .run(exercise.id);

    const response = await programRoute.GET(new Request("http://localhost"), params({ id: String(program.id) }));
    const body = await response.json();
    const rendered = await programPage.default(params({ id: String(program.id) }));
    const text = collectRenderedText(rendered);
    const exerciseNames = collectExerciseInitialNames(rendered);

    expect(response.status).toBe(200);
    expect(body.days[0]).toEqual(expect.objectContaining({ id: day.id, name: "Lower" }));
    expect(body.days[0].exercises[0]).toEqual(
      expect.objectContaining({
        id: exercise.id,
        name: "Squat",
        training_max: 315,
      }),
    );
    expect(body.days[0].exercises[0].weekSettings[0]).toEqual(expect.objectContaining({ reps: 9 }));
    expect(text).toContain("Lower");
    expect(exerciseNames).toContain("Squat");
    expect(collectExerciseTrainingMaxes(rendered)).toContain(315);
    expect(text).not.toContain("Stale Day");
    expect(exerciseNames).not.toContain("Stale Lift");
  });

  it("fetches only current runnable days and exercises", async () => {
    const userId = createUser("archived-detail@example.com");
    authenticate(userId);

    const program = await (await programsRoute.POST(jsonRequest({ name: "Archived Detail Program" }))).json();
    const liveDay = await (await daysRoute.POST(jsonRequest({ name: "Live Day" }), params({ id: String(program.id) }))).json();
    const archivedDay = await (
      await daysRoute.POST(jsonRequest({ name: "Archived Day" }), params({ id: String(program.id) }))
    ).json();
    await exercisesRoute.POST(
      jsonRequest({ name: "Squat", trainingMax: 300, category: "main", progressionType: "custom" }),
      params({ dayId: String(liveDay.id) }),
    );
    const archivedExercise = await (
      await exercisesRoute.POST(
        jsonRequest({ name: "Archived Curl", trainingMax: 80, category: "accessory", progressionType: "custom" }),
        params({ dayId: String(liveDay.id) }),
      )
    ).json();
    await exercisesRoute.POST(
      jsonRequest({ name: "Archived Day Lift", trainingMax: 200, category: "main", progressionType: "custom" }),
      params({ dayId: String(archivedDay.id) }),
    );
    await exerciseRoute.DELETE(new Request("http://localhost"), params({ exerciseId: String(archivedExercise.id) }));
    await dayRoute.DELETE(new Request("http://localhost"), params({ dayId: String(archivedDay.id) }));

    const response = await programRoute.GET(new Request("http://localhost"), params({ id: String(program.id) }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.days.map((day: { name: string }) => day.name)).toEqual(["Live Day"]);
    expect(body.days[0].exercises.map((exercise: { name: string }) => exercise.name)).toEqual(["Squat"]);
  });

  it("renders only current runnable days and exercises in the program editor", async () => {
    const userId = createUser("archived-editor@example.com");
    authenticate(userId);

    const program = await (await programsRoute.POST(jsonRequest({ name: "Archived Editor Program" }))).json();
    const liveDay = await (await daysRoute.POST(jsonRequest({ name: "Live Day" }), params({ id: String(program.id) }))).json();
    const archivedDay = await (
      await daysRoute.POST(jsonRequest({ name: "Archived Day" }), params({ id: String(program.id) }))
    ).json();
    await exercisesRoute.POST(
      jsonRequest({ name: "Squat", trainingMax: 300, category: "main", progressionType: "custom" }),
      params({ dayId: String(liveDay.id) }),
    );
    const archivedExercise = await (
      await exercisesRoute.POST(
        jsonRequest({ name: "Archived Curl", trainingMax: 80, category: "accessory", progressionType: "custom" }),
        params({ dayId: String(liveDay.id) }),
      )
    ).json();
    await exercisesRoute.POST(
      jsonRequest({ name: "Archived Day Lift", trainingMax: 200, category: "main", progressionType: "custom" }),
      params({ dayId: String(archivedDay.id) }),
    );
    await exerciseRoute.DELETE(new Request("http://localhost"), params({ exerciseId: String(archivedExercise.id) }));
    await dayRoute.DELETE(new Request("http://localhost"), params({ dayId: String(archivedDay.id) }));

    const rendered = await programPage.default(params({ id: String(program.id) }));
    const text = collectRenderedText(rendered);
    const exerciseNames = collectExerciseInitialNames(rendered);

    expect(text).toContain("Live Day");
    expect(text).toContain("custom");
    expect(exerciseNames).toEqual(["Squat"]);
    expect(text).not.toContain("Archived Day");
    expect(exerciseNames).not.toContain("Archived Curl");
    expect(text).not.toContain("Archived Day Lift");
  });

  it("updates and deletes owned programs", async () => {
    const userId = createUser("program-owner@example.com");
    authenticate(userId);

    const createResponse = await programsRoute.POST(jsonRequest({ name: "Original", numWeeks: 4 }));
    const program = await createResponse.json();

    expect((await programRoute.PUT(jsonRequest({ name: "Updated" }), params({ id: String(program.id) }))).status).toBe(
      200,
    );
    expect(
      (dbModule.db.prepare("SELECT name FROM programs WHERE id = ?").get(program.id) as { name: string }).name,
    ).toBe("Updated");
    expect(
      dbModule.db
        .prepare(
          `
            SELECT pd.name AS definition_name, pr.name AS run_name
            FROM programs p
            JOIN program_definitions pd ON pd.id = p.program_definition_id
            JOIN program_runs pr ON pr.id = p.program_run_id
            WHERE p.id = ?
          `,
        )
        .get(program.id),
    ).toEqual({ definition_name: "Updated", run_name: "Updated" });

    expect((await programRoute.PUT(jsonRequest({ isActive: false }), params({ id: String(program.id) }))).status).toBe(
      200,
    );
    expect(
      dbModule.db
        .prepare(
          "SELECT is_active, (SELECT status FROM program_runs WHERE id = programs.program_run_id) AS run_status FROM programs WHERE id = ?",
        )
        .get(program.id),
    ).toEqual({ is_active: 0, run_status: "paused" });

    expect((await programRoute.DELETE(new Request("http://localhost"), params({ id: String(program.id) }))).status).toBe(
      200,
    );
    expect(dbModule.db.prepare("SELECT id, is_active, archived_at FROM programs WHERE id = ?").get(program.id)).toEqual(
      expect.objectContaining({ id: program.id, is_active: 0, archived_at: expect.any(String) }),
    );
    expect((await programRoute.GET(new Request("http://localhost"), params({ id: String(program.id) }))).status).toBe(404);
  });

  it("updates owned program schedule weekdays", async () => {
    const userId = createUser("program-schedule@example.com");
    authenticate(userId);
    const program = await (await programsRoute.POST(jsonRequest({ name: "Scheduled" }))).json();

    const scheduledResponse = await programRoute.PUT(
      jsonRequest({ scheduleWeekdays: [4, 0, 2] }),
      params({ id: String(program.id) }),
    );
    expect(scheduledResponse.status).toBe(200);
    expect(
      dbModule.db
        .prepare("SELECT schedule_weekdays, schedule_mode FROM programs WHERE id = ?")
        .get(program.id),
    ).toEqual({ schedule_weekdays: "[0,2,4]", schedule_mode: "scheduled" });
    expect(
      dbModule.db
        .prepare(
          `
            SELECT weekday, definition_day_number
            FROM program_run_schedule_days
            WHERE program_run_id = (SELECT program_run_id FROM programs WHERE id = ?)
            ORDER BY weekday
          `,
        )
        .all(program.id),
    ).toEqual([
      { weekday: 0, definition_day_number: 1 },
      { weekday: 2, definition_day_number: 2 },
      { weekday: 4, definition_day_number: 3 },
    ]);

    const clearedResponse = await programRoute.PUT(jsonRequest({ scheduleWeekdays: [] }), params({ id: String(program.id) }));
    expect(clearedResponse.status).toBe(200);
    expect(
      dbModule.db
        .prepare("SELECT schedule_weekdays, schedule_mode FROM programs WHERE id = ?")
        .get(program.id),
    ).toEqual({ schedule_weekdays: "[]", schedule_mode: "unscheduled" });
    expect(
      dbModule.db
        .prepare(
          "SELECT COUNT(*) AS count FROM program_run_schedule_days WHERE program_run_id = (SELECT program_run_id FROM programs WHERE id = ?)",
        )
        .get(program.id),
    ).toEqual({ count: 0 });
  });

  it("rejects invalid program schedule weekdays", async () => {
    const userId = createUser("invalid-program-schedule@example.com");
    authenticate(userId);
    const program = await (await programsRoute.POST(jsonRequest({ name: "Scheduled" }))).json();

    for (const scheduleWeekdays of [[-1], [7], [1, 1], [1.5], ["1"], "1"]) {
      const response = await programRoute.PUT(
        jsonRequest({ scheduleWeekdays }),
        params({ id: String(program.id) }),
      );
      expect(response.status).toBe(400);
    }
  });

  it("shows scheduled workouts on Today before other active runs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-30T12:00:00-07:00"));
    const userId = createUser("today-schedule@example.com");
    authenticate(userId);

    async function createProgramWithDay(name: string, scheduleWeekdays: number[]): Promise<void> {
      const program = await (await programsRoute.POST(jsonRequest({ name }))).json();
      await programRoute.PUT(jsonRequest({ scheduleWeekdays }), params({ id: String(program.id) }));
      await daysRoute.POST(jsonRequest({ name: `${name} Day` }), params({ id: String(program.id) }));
    }

    await createProgramWithDay("Today Scheduled", [6]);
    await createProgramWithDay("Other Scheduled", [1]);
    await createProgramWithDay("Unscheduled Active", []);

    try {
      const rendered = await todayPage.default();
      const text = collectRenderedText(rendered);
      const workoutProgramNames = collectWorkoutProgramNames(rendered);

      expect(text).not.toContain("Catch up");
      expect(text).toContain("Other active runs");
      expect(workoutProgramNames).toEqual(["Today Scheduled", "Unscheduled Active"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps scheduled weekdays onto program day numbers on Today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T12:00:00-07:00"));
    const userId = createUser("today-day-map@example.com");
    authenticate(userId);
    const program = await (await programsRoute.POST(jsonRequest({ name: "Mapped Program" }))).json();
    await programRoute.PUT(jsonRequest({ scheduleWeekdays: [1, 3, 5] }), params({ id: String(program.id) }));
    await daysRoute.POST(jsonRequest({ name: "Monday Lower" }), params({ id: String(program.id) }));
    await daysRoute.POST(jsonRequest({ name: "Wednesday Upper" }), params({ id: String(program.id) }));
    await daysRoute.POST(jsonRequest({ name: "Friday Pull" }), params({ id: String(program.id) }));

    try {
      const rendered = await todayPage.default();

      expect(collectWorkoutCards(rendered)).toEqual([
        { programName: "Mapped Program", dayName: "Wednesday Upper", currentDay: 2 },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a completed scheduled workout completed when returning to Today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T12:00:00-07:00"));
    const userId = createUser("today-completed-persist@example.com");
    authenticate(userId);
    const program = await (await programsRoute.POST(jsonRequest({ name: "Completed Persist" }))).json();
    await programRoute.PUT(jsonRequest({ scheduleWeekdays: [3] }), params({ id: String(program.id) }));
    const day = await (await daysRoute.POST(jsonRequest({ name: "Wednesday Lower" }), params({ id: String(program.id) }))).json();
    const context = dbModule.db
      .prepare("SELECT program_definition_id, program_run_id FROM programs WHERE id = ?")
      .get(program.id) as { program_definition_id: number; program_run_id: number };
    const definitionDay = dbModule.db
      .prepare("SELECT id FROM program_definition_days WHERE program_definition_id = ? AND day_number = 1")
      .get(context.program_definition_id) as { id: number };
    dbModule.db
      .prepare(
        `
          INSERT INTO sessions (
            program_id,
            user_id,
            day_id,
            program_definition_id,
            program_definition_day_id,
            program_run_id,
            program_name,
            day_name,
            week_number,
            date,
            status,
            completed
          ) VALUES (?, ?, ?, ?, ?, ?, 'Completed Persist', 'Wednesday Lower', 1, '2026-06-03', 'completed', 1)
        `,
      )
      .run(program.id, userId, day.id, context.program_definition_id, definitionDay.id, context.program_run_id);

    try {
      const rendered = await todayPage.default();
      const text = collectRenderedText(rendered);

      expect(text).toContain("Workout complete today");
      expect(collectWorkoutCards(rendered)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses definition days as canonical Today cards when generated rows are stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T12:00:00-07:00"));
    const userId = createUser("today-definition-canonical@example.com");
    authenticate(userId);
    const program = await (await programsRoute.POST(jsonRequest({ name: "Definition Today" }))).json();
    await programRoute.PUT(jsonRequest({ scheduleWeekdays: [3] }), params({ id: String(program.id) }));
    const day = await (await daysRoute.POST(jsonRequest({ name: "Canonical Wednesday" }), params({ id: String(program.id) }))).json();
    dbModule.db.prepare("UPDATE days SET name = 'Stale Wednesday' WHERE id = ?").run(day.id);

    try {
      const rendered = await todayPage.default();

      expect(collectWorkoutCards(rendered)).toEqual([
        { programName: "Definition Today", dayName: "Canonical Wednesday", currentDay: 1 },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists every program once with schedule labels and source", async () => {
    const userId = createUser("program-management@example.com");
    authenticate(userId);

    dbModule.db
      .prepare(
        "INSERT INTO programs (user_id, name, is_active, schedule_weekdays, schedule_mode, current_week, current_day, num_weeks) VALUES (?, ?, 1, ?, 'scheduled', 2, 1, 6)",
      )
      .run(userId, "Scheduled Active", "[0,2,4]");
    dbModule.db
      .prepare(
        "INSERT INTO programs (user_id, name, is_active, schedule_weekdays, schedule_mode, current_week, current_day, num_weeks) VALUES (?, ?, 1, '[]', 'unscheduled', 1, 2, 4)",
      )
      .run(userId, "Unscheduled Active");
    dbModule.db
      .prepare(
        "INSERT INTO programs (user_id, name, is_active, schedule_weekdays, schedule_mode, current_week, current_day, num_weeks) VALUES (?, ?, 0, '[]', 'unscheduled', 1, 1, 8)",
      )
      .run(userId, "Custom Inactive");

    const rendered = await programsPage.default();
    const text = collectRenderedText(rendered);

    expect(text).toContain("Your programs");
    // One unified list — each program appears exactly once (no run/definition split).
    expect(text).toContain("Scheduled Active");
    expect(text).toContain("Unscheduled Active");
    expect(text).toContain("Custom Inactive");
    expect(text).toContain("Sun");
    expect(text).toContain("Tue");
    expect(text).toContain("Thu");
    expect(text).toContain("Custom");
  });

  it("validates program creation and update input", async () => {
    const userId = createUser("program-validation@example.com");
    authenticate(userId);

    expect((await programsRoute.POST(jsonRequest({ name: "" }))).status).toBe(400);
    expect((await programsRoute.POST(jsonRequest({ name: "Bad Weeks", numWeeks: 0 }))).status).toBe(400);

    const program = await (await programsRoute.POST(jsonRequest({ name: "Valid" }))).json();
    expect((await programRoute.PUT(jsonRequest({ name: "" }), params({ id: String(program.id) }))).status).toBe(400);
  });

  it("creates a program from a default snapshot with stable keys and snapshot sort order", async () => {
    const userId = createUser("default-snapshot@example.com");
    authenticate(userId);
    const defaultProgram = getProgramDefault("basic-strength-3-day");
    expect(defaultProgram).toBeDefined();

    const response = await programsRoute.POST(
      jsonRequest({
        name: defaultProgram!.snapshot.name,
        numWeeks: defaultProgram!.snapshot.numWeeks,
        snapshot: defaultProgram!.snapshot,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    const days = dbModule.db
      .prepare("SELECT name, day_number, sort_order, shared_day_key FROM days WHERE program_id = ? ORDER BY sort_order")
      .all(body.id) as {
      name: string;
      day_number: number;
      sort_order: number;
      shared_day_key: string;
    }[];
    expect(days).toEqual(
      defaultProgram!.snapshot.days.map((day, index) => ({
        name: day.name,
        day_number: index + 1,
        sort_order: index + 1,
        shared_day_key: day.key,
      })),
    );
    expect(
      dbModule.db
        .prepare(
          `
            SELECT pdd.name, pdd.day_number, pdd.sort_order, pdd.stable_key
            FROM programs p
            JOIN program_definition_days pdd ON pdd.program_definition_id = p.program_definition_id
            WHERE p.id = ?
            ORDER BY pdd.sort_order
          `,
        )
        .all(body.id),
    ).toEqual(
      defaultProgram!.snapshot.days.map((day, index) => ({
        name: day.name,
        day_number: index + 1,
        sort_order: index + 1,
        stable_key: day.key,
      })),
    );

    const lowerExercises = dbModule.db
      .prepare(
        `
          SELECT e.name, e.category, e.progression_type, e.sort_order, e.shared_exercise_key
          FROM exercises e
          JOIN days d ON d.id = e.day_id
          WHERE d.program_id = ?
            AND d.shared_day_key = ?
          ORDER BY e.sort_order
        `,
      )
      .all(body.id, defaultProgram!.snapshot.days[0].key) as {
      name: string;
      category: string;
      progression_type: string;
      sort_order: number;
      shared_exercise_key: string;
    }[];
    expect(lowerExercises).toEqual(
      defaultProgram!.snapshot.days[0].exercises.map((exercise, index) => ({
        name: exercise.name,
        category: exercise.category,
        progression_type: exercise.progressionType,
        sort_order: index + 1,
        shared_exercise_key: exercise.key,
      })),
    );

    const firstExerciseWeeks = dbModule.db
      .prepare(
        `
          SELECT ws.week_number, ws.intensity_pct, ws.reps, ws.sets, ws.rep_out_target, ws.calculated_weight
          FROM week_settings ws
          JOIN exercises e ON e.id = ws.exercise_id
          WHERE e.shared_exercise_key = ?
          ORDER BY ws.week_number
        `,
      )
      .all(defaultProgram!.snapshot.days[0].exercises[0].key) as {
      week_number: number;
      intensity_pct: number;
      reps: number;
      sets: number;
      rep_out_target: number;
      calculated_weight: number;
    }[];
    expect(firstExerciseWeeks).toHaveLength(
      defaultProgram!.snapshot.numWeeks * defaultProgram!.snapshot.days[0].exercises[0].weeks[0].sets,
    );
    expect(firstExerciseWeeks[0]).toEqual(
      expect.objectContaining({
        week_number: 1,
        intensity_pct: defaultProgram!.snapshot.days[0].exercises[0].weeks[0].intensityPct,
        reps: defaultProgram!.snapshot.days[0].exercises[0].weeks[0].reps,
        sets: expect.any(Number),
        rep_out_target: defaultProgram!.snapshot.days[0].exercises[0].weeks[0].repOutTarget,
        calculated_weight: expect.any(Number),
      }),
    );
  });

  it("materializes superset groups from a default snapshot, mains first and unlinked", async () => {
    const userId = createUser("superset-default@example.com");
    authenticate(userId);
    const defaultProgram = getProgramDefault("superset-hypertrophy-3-day");
    expect(defaultProgram).toBeDefined();

    const response = await programsRoute.POST(
      jsonRequest({
        name: defaultProgram!.snapshot.name,
        numWeeks: defaultProgram!.snapshot.numWeeks,
        snapshot: defaultProgram!.snapshot,
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(201);

    const rows = dbModule.db
      .prepare(
        `
          SELECT pde.name, pde.category, pde.superset_group
          FROM program_definition_exercises pde
          JOIN program_definition_days pdd ON pdd.id = pde.program_definition_day_id
          JOIN programs p ON p.program_definition_id = pdd.program_definition_id
          WHERE p.id = ? AND pdd.stable_key = ?
          ORDER BY pde.sort_order
        `,
      )
      .all(body.id, defaultProgram!.snapshot.days[0].key) as {
      name: string;
      category: string;
      superset_group: string | null;
    }[];

    // Main lift is first and is not part of a superset.
    expect(rows[0]).toMatchObject({ name: "Squat", category: "main", superset_group: null });
    // Superset A = exercises 2 & 3 share a group; Superset B = exercises 4 & 5 share another.
    expect(rows[1].superset_group).toBeTruthy();
    expect(rows[1].superset_group).toBe(rows[2].superset_group);
    expect(rows[3].superset_group).toBeTruthy();
    expect(rows[3].superset_group).toBe(rows[4].superset_group);
    expect(rows[1].superset_group).not.toBe(rows[3].superset_group);

    // Accessories log freely: a fixed prescription at 100% of training max.
    const incline = dbModule.db
      .prepare(
        `
          SELECT pdws.sets, pdws.reps, pdws.intensity_pct
          FROM program_definition_week_settings pdws
          JOIN program_definition_exercises pde ON pde.id = pdws.program_definition_exercise_id
          WHERE pde.stable_key = ? AND pdws.week_number = 1
        `,
      )
      .get(defaultProgram!.snapshot.days[0].exercises[1].key) as {
      sets: number;
      reps: number;
      intensity_pct: number;
    };
    expect(incline).toMatchObject({ sets: 3, reps: 12, intensity_pct: 1 });
  });

  it("uses supplied expected maxes instead of the default for program creation from a snapshot", async () => {
    const userId = createUser("expected-maxes@example.com");
    authenticate(userId);
    const defaultProgram = getProgramDefault("basic-strength-3-day");
    expect(defaultProgram).toBeDefined();

    const squatKey = defaultProgram!.snapshot.days[0].exercises[0].key;
    const deadliftKey = defaultProgram!.snapshot.days[0].exercises[1].key;

    const response = await programsRoute.POST(
      jsonRequest({
        name: defaultProgram!.snapshot.name,
        numWeeks: defaultProgram!.snapshot.numWeeks,
        snapshot: defaultProgram!.snapshot,
        expectedMaxes: { [squatKey]: 315, [deadliftKey]: 405 },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);

    const exercises = dbModule.db
      .prepare(
        "SELECT e.name, e.training_max, e.shared_exercise_key FROM exercises e JOIN days d ON d.id = e.day_id WHERE d.program_id = ? ORDER BY e.id",
      )
      .all(body.id) as { name: string; training_max: number; shared_exercise_key: string }[];

    const squat = exercises.find((ex) => ex.shared_exercise_key === squatKey);
    const deadlift = exercises.find((ex) => ex.shared_exercise_key === deadliftKey);
    const remaining = exercises.filter(
      (ex) => ex.shared_exercise_key !== squatKey && ex.shared_exercise_key !== deadliftKey,
    );

    expect(squat?.training_max).toBe(315);
    expect(deadlift?.training_max).toBe(405);
    for (const ex of remaining) {
      expect(ex.training_max).toBe(100);
    }

    const squatWeeks = dbModule.db
      .prepare(
        "SELECT ws.calculated_weight FROM week_settings ws JOIN exercises e ON e.id = ws.exercise_id WHERE e.shared_exercise_key = ? AND ws.week_number = 1",
      )
      .get(squatKey) as { calculated_weight: number };
    expect(squatWeeks.calculated_weight).toBe(220);
  });

  it("rejects invalid expected maxes when creating a program from a snapshot", async () => {
    const userId = createUser("invalid-expected-maxes@example.com");
    authenticate(userId);
    const defaultProgram = getProgramDefault("basic-strength-3-day");
    expect(defaultProgram).toBeDefined();
    const squatKey = defaultProgram!.snapshot.days[0].exercises[0].key;

    const response = await programsRoute.POST(
      jsonRequest({
        name: defaultProgram!.snapshot.name,
        numWeeks: defaultProgram!.snapshot.numWeeks,
        snapshot: defaultProgram!.snapshot,
        expectedMaxes: { [squatKey]: 0 },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe(`expectedMaxes.${squatKey} must be a positive number`);
    expect(dbModule.db.prepare("SELECT COUNT(*) AS count FROM programs WHERE user_id = ?").get(userId)).toEqual({
      count: 0,
    });
  });

  it("creates custom exercises with auto progression disabled", async () => {
    const userId = createUser("custom@example.com");
    authenticate(userId);

    const program = await (await programsRoute.POST(jsonRequest({ name: "Custom Program" }))).json();
    const day = await (await daysRoute.POST(jsonRequest({ name: "Lower" }), params({ id: String(program.id) }))).json();
    const exercise = await (
      await exercisesRoute.POST(
        jsonRequest({ name: "Squat", trainingMax: 300, category: "main", progressionType: "  " }),
        params({ dayId: String(day.id) }),
      )
    ).json();

    const row = dbModule.db.prepare("SELECT * FROM exercises WHERE id = ?").get(exercise.id) as {
      progression_type: string;
      auto_progression_enabled: number;
    };
    const settings = dbModule.db
      .prepare("SELECT COUNT(*) AS count FROM week_settings WHERE exercise_id = ?")
      .get(exercise.id) as { count: number };

    expect(row.progression_type).toBe("custom");
    expect(row.auto_progression_enabled).toBe(0);
    expect(settings.count).toBe(7);
  });

  it("creates template exercises with generated week settings and auto progression enabled", async () => {
    const userId = createUser("template@example.com");
    authenticate(userId);

    const program = await (await programsRoute.POST(jsonRequest({ name: "Template Program" }))).json();
    const day = await (await daysRoute.POST(jsonRequest({ name: "Upper" }), params({ id: String(program.id) }))).json();
    const exercise = await (
      await exercisesRoute.POST(
        jsonRequest({ name: "Bench", trainingMax: 200, category: "aux", progressionType: "sbs" }),
        params({ dayId: String(day.id) }),
      )
    ).json();

    const row = dbModule.db.prepare("SELECT * FROM exercises WHERE id = ?").get(exercise.id) as {
      progression_type: string;
      auto_progression_enabled: number;
    };
    const weekOne = dbModule.db
      .prepare("SELECT intensity_pct, reps, sets, rep_out_target, calculated_weight, set_number FROM week_settings WHERE exercise_id = ? AND week_number = 1 AND set_number = 1")
      .get(exercise.id) as {
      intensity_pct: number;
      reps: number;
      sets: number;
      rep_out_target: number;
      calculated_weight: number;
      set_number: number;
    };

    expect(row.progression_type).toBe("sbs");
    expect(row.auto_progression_enabled).toBe(1);
    expect(weekOne).toEqual({
      intensity_pct: 0.6,
      reps: 7,
      sets: 1,
      rep_out_target: 14,
      calculated_weight: 120,
      set_number: 1,
    });
  });

  it("accepts display-style template names for backward-compatible exercise creation", async () => {
    const userId = createUser("display-template@example.com");
    authenticate(userId);

    const program = await (await programsRoute.POST(jsonRequest({ name: "Display Template Program" }))).json();
    const day = await (await daysRoute.POST(jsonRequest({ name: "Upper" }), params({ id: String(program.id) }))).json();
    const response = await exercisesRoute.POST(
      jsonRequest({ name: "Bench", trainingMax: 200, category: "aux", progressionType: "SBS" }),
      params({ dayId: String(day.id) }),
    );
    const exercise = await response.json();
    const row = dbModule.db.prepare("SELECT progression_type FROM exercises WHERE id = ?").get(exercise.id) as {
      progression_type: string;
    };

    expect(response.status).toBe(201);
    expect(row.progression_type).toBe("sbs");
  });

  it("rejects template and category combinations the template does not support", async () => {
    const userId = createUser("unsupported-category@example.com");
    authenticate(userId);

    const program = await (await programsRoute.POST(jsonRequest({ name: "Unsupported Category Program" }))).json();
    const day = await (await daysRoute.POST(jsonRequest({ name: "Lower" }), params({ id: String(program.id) }))).json();

    const response = await exercisesRoute.POST(
      jsonRequest({ name: "Curl", trainingMax: 100, category: "accessory", progressionType: "madcow" }),
      params({ dayId: String(day.id) }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("madcow does not support accessory exercises");
  });

  it("updates an owned exercise and recalculates generated weights", async () => {
    const userId = createUser("update-exercise@example.com");
    authenticate(userId);

    const program = await (await programsRoute.POST(jsonRequest({ name: "Update Program" }))).json();
    const day = await (await daysRoute.POST(jsonRequest({ name: "Lower" }), params({ id: String(program.id) }))).json();
    const exercise = await (
      await exercisesRoute.POST(
        jsonRequest({ name: "Squat", trainingMax: 300, category: "main", progressionType: "SBS" }),
        params({ dayId: String(day.id) }),
      )
    ).json();

    const response = await exerciseRoute.PUT(
      jsonRequest({ name: "Comp Squat", trainingMax: 320 }),
      params({ exerciseId: String(exercise.id) }),
    );
    const updated = dbModule.db.prepare("SELECT name, training_max FROM exercises WHERE id = ?").get(exercise.id) as {
      name: string;
      training_max: number;
    };
    const weekOne = dbModule.db
      .prepare("SELECT calculated_weight FROM week_settings WHERE exercise_id = ? AND week_number = 1")
      .get(exercise.id) as { calculated_weight: number };

    expect(response.status).toBe(200);
    expect(updated).toEqual({ name: "Comp Squat", training_max: 320 });
    expect(weekOne.calculated_weight).toBe(225);
  });

  it("deletes owned days and exercises", async () => {
    const userId = createUser("delete-owned@example.com");
    authenticate(userId);

    const program = await (await programsRoute.POST(jsonRequest({ name: "Delete Program" }))).json();
    const day = await (await daysRoute.POST(jsonRequest({ name: "Lower" }), params({ id: String(program.id) }))).json();
    const exercise = await (
      await exercisesRoute.POST(
        jsonRequest({ name: "Squat", trainingMax: 300, category: "main", progressionType: "custom" }),
        params({ dayId: String(day.id) }),
      )
    ).json();

    expect(
      (await exerciseRoute.DELETE(new Request("http://localhost"), params({ exerciseId: String(exercise.id) }))).status,
    ).toBe(200);
    expect(dbModule.db.prepare("SELECT id FROM exercises WHERE id = ? AND archived_at IS NULL").get(exercise.id)).toBeUndefined();

    expect((await dayRoute.DELETE(new Request("http://localhost"), params({ dayId: String(day.id) }))).status).toBe(200);
    expect(dbModule.db.prepare("SELECT id FROM days WHERE id = ? AND archived_at IS NULL").get(day.id)).toBeUndefined();
  });

  it("updates owned days and rejects invalid day names", async () => {
    const userId = createUser("day-update@example.com");
    authenticate(userId);

    const program = await (await programsRoute.POST(jsonRequest({ name: "Day Program" }))).json();
    const day = await (await daysRoute.POST(jsonRequest({ name: "Lower" }), params({ id: String(program.id) }))).json();

    expect((await dayRoute.PUT(jsonRequest({ name: "" }), params({ dayId: String(day.id) }))).status).toBe(400);
    expect((await dayRoute.PUT(jsonRequest({ name: "Upper" }), params({ dayId: String(day.id) }))).status).toBe(200);
    expect((dbModule.db.prepare("SELECT name FROM days WHERE id = ?").get(day.id) as { name: string }).name).toBe(
      "Upper",
    );
  });

  it("rejects stale updates and deletes for archived days", async () => {
    const userId = createUser("archived-day-mutation@example.com");
    authenticate(userId);
    const program = await (await programsRoute.POST(jsonRequest({ name: "Archived Day Program" }))).json();
    const day = await (await daysRoute.POST(jsonRequest({ name: "Lower" }), params({ id: String(program.id) }))).json();
    dbModule.db.prepare("UPDATE days SET archived_at = datetime('now') WHERE id = ?").run(day.id);

    expect((await dayRoute.PUT(jsonRequest({ name: "Upper" }), params({ dayId: String(day.id) }))).status).toBe(404);
    expect((await dayRoute.DELETE(new Request("http://localhost"), params({ dayId: String(day.id) }))).status).toBe(404);
    expect(dbModule.db.prepare("SELECT id FROM days WHERE id = ?").get(day.id)).toEqual({ id: day.id });
  });

  it("rejects creating exercises on archived days", async () => {
    const userId = createUser("archived-day-exercise-create@example.com");
    authenticate(userId);
    const program = await (await programsRoute.POST(jsonRequest({ name: "Archived Day Exercise Program" }))).json();
    const day = await (await daysRoute.POST(jsonRequest({ name: "Lower" }), params({ id: String(program.id) }))).json();
    dbModule.db.prepare("UPDATE days SET archived_at = datetime('now') WHERE id = ?").run(day.id);

    const response = await exercisesRoute.POST(
      jsonRequest({ name: "Squat", trainingMax: 300, category: "main", progressionType: "custom" }),
      params({ dayId: String(day.id) }),
    );
    const exerciseCount = dbModule.db
      .prepare("SELECT COUNT(*) AS count FROM exercises WHERE day_id = ?")
      .get(day.id) as { count: number };

    expect(response.status).toBe(404);
    expect(exerciseCount.count).toBe(0);
  });

  it("creates new days after the current visible day order", async () => {
    const userId = createUser("day-order-with-archives@example.com");
    authenticate(userId);
    const program = await (await programsRoute.POST(jsonRequest({ name: "Archived Sort Program" }))).json();
    const liveDay = await (await daysRoute.POST(jsonRequest({ name: "Live" }), params({ id: String(program.id) }))).json();
    dbModule.db
      .prepare(
        "INSERT INTO days (program_id, name, day_number, sort_order, archived_at) VALUES (?, ?, ?, ?, datetime('now'))",
      )
      .run(program.id, "Archived Shifted", 100001, 100001);

    const response = await daysRoute.POST(jsonRequest({ name: "New Live" }), params({ id: String(program.id) }));
    const day = await response.json();
    const visibleDays = dbModule.db
      .prepare(
        "SELECT name, day_number, sort_order FROM days WHERE program_id = ? AND archived_at IS NULL ORDER BY sort_order",
      )
      .all(program.id);

    expect(response.status).toBe(201);
    expect(day.day_number).toBe(2);
    expect(visibleDays).toEqual([
      { name: "Live", day_number: liveDay.day_number, sort_order: 1 },
      { name: "New Live", day_number: 2, sort_order: 2 },
    ]);
  });

  it("rejects invalid exercise input", async () => {
    const userId = createUser("invalid-exercise@example.com");
    authenticate(userId);

    const program = await (await programsRoute.POST(jsonRequest({ name: "Invalid Program" }))).json();
    const day = await (await daysRoute.POST(jsonRequest({ name: "Lower" }), params({ id: String(program.id) }))).json();

    expect(
      (
        await exercisesRoute.POST(
          jsonRequest({ name: "Squat", trainingMax: 300, category: "weird", progressionType: "custom" }),
          params({ dayId: String(day.id) }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await exercisesRoute.POST(
          jsonRequest({ name: "Squat", trainingMax: 300, category: "main", progressionType: "Mystery" }),
          params({ dayId: String(day.id) }),
        )
      ).status,
    ).toBe(400);
  });

  it("rejects stale updates and deletes for archived exercises", async () => {
    const userId = createUser("archived-exercise-mutation@example.com");
    authenticate(userId);
    const program = await (await programsRoute.POST(jsonRequest({ name: "Archived Exercise Program" }))).json();
    const day = await (await daysRoute.POST(jsonRequest({ name: "Lower" }), params({ id: String(program.id) }))).json();
    const exercise = await (
      await exercisesRoute.POST(
        jsonRequest({ name: "Squat", trainingMax: 300, category: "main", progressionType: "custom" }),
        params({ dayId: String(day.id) }),
      )
    ).json();
    dbModule.db.prepare("UPDATE exercises SET archived_at = datetime('now') WHERE id = ?").run(exercise.id);

    expect(
      (
        await exerciseRoute.PUT(
          jsonRequest({ name: "Comp Squat", trainingMax: 315 }),
          params({ exerciseId: String(exercise.id) }),
        )
      ).status,
    ).toBe(404);
    expect(
      (await exerciseRoute.DELETE(new Request("http://localhost"), params({ exerciseId: String(exercise.id) }))).status,
    ).toBe(404);
    expect(dbModule.db.prepare("SELECT id FROM exercises WHERE id = ?").get(exercise.id)).toEqual({ id: exercise.id });
  });

  it("prevents cross-user day and exercise mutations", async () => {
    const userA = createUser("owner@example.com");
    const userB = createUser("other@example.com");
    authenticate(userA);

    const otherProgram = dbModule.db
      .prepare("INSERT INTO programs (user_id, name) VALUES (?, ?)")
      .run(userB, "Other Program");
    const otherDay = dbModule.db
      .prepare("INSERT INTO days (program_id, name, day_number) VALUES (?, ?, ?)")
      .run(otherProgram.lastInsertRowid, "Other Day", 1);
    const otherExercise = dbModule.db
      .prepare("INSERT INTO exercises (day_id, name, training_max) VALUES (?, ?, ?)")
      .run(otherDay.lastInsertRowid, "Other Lift", 100);

    expect((await dayRoute.PUT(jsonRequest({ name: "Stolen" }), params({ dayId: String(otherDay.lastInsertRowid) }))).status).toBe(
      404,
    );
    expect(
      (await exerciseRoute.DELETE(new Request("http://localhost"), params({ exerciseId: String(otherExercise.lastInsertRowid) })))
        .status,
    ).toBe(404);
  });

  it("returns a snapshot built from a local program with shared keys", async () => {
    const userId = createUser("snapshot-route@example.com");
    authenticate(userId);

    const program = dbModule.db
      .prepare("INSERT INTO programs (user_id, name, description, num_weeks) VALUES (?, ?, ?, ?)")
      .run(userId, "Snapshot Program", "Desc", 3);
    const programId = Number(program.lastInsertRowid);

    const day = dbModule.db
      .prepare(
        "INSERT INTO days (program_id, name, day_number, sort_order, shared_day_key) VALUES (?, ?, ?, ?, ?)",
      )
      .run(programId, "Push", 1, 1, "key:day:push");
    const dayId = Number(day.lastInsertRowid);

    const exercise = dbModule.db
      .prepare(
        "INSERT INTO exercises (day_id, name, training_max, category, progression_type, auto_progression_enabled, sort_order, shared_exercise_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(dayId, "Bench", 200, "main", "sbs", 1, 1, "key:exercise:bench");
    const exerciseId = Number(exercise.lastInsertRowid);

    dbModule.db
      .prepare(
        "INSERT INTO week_settings (exercise_id, week_number, intensity_pct, reps, sets, rep_out_target) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(exerciseId, 1, 0.7, 5, 5, 10);
    dbModule.db
      .prepare(
        "INSERT INTO week_settings (exercise_id, week_number, intensity_pct, reps, sets, rep_out_target) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(exerciseId, 2, 0.75, 4, 5, 8);
    dbModule.db
      .prepare(
        "INSERT INTO week_settings (exercise_id, week_number, intensity_pct, reps, sets, rep_out_target) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(exerciseId, 3, 0.8, 3, 5, 6);

    const response = await snapshotRoute.GET(
      new Request("http://localhost"),
      params({ id: String(programId) }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      schemaVersion: 1,
      name: "Snapshot Program",
      description: "Desc",
      numWeeks: 3,
      days: [
        {
          key: "key:day:push",
          name: "Push",
          exercises: [
            {
              key: "key:exercise:bench",
              name: "Bench",
              category: "main",
              progressionType: "sbs",
              weeks: [
                { weekNumber: 1, intensityPct: 0.7, reps: 5, sets: 5, repOutTarget: 10 },
                { weekNumber: 2, intensityPct: 0.75, reps: 4, sets: 5, repOutTarget: 8 },
                { weekNumber: 3, intensityPct: 0.8, reps: 3, sets: 5, repOutTarget: 6 },
              ],
            },
          ],
        },
      ],
    });
  });

  it("returns 404 for snapshot of another user's program", async () => {
    const ownerId = createUser("snapshot-owner@example.com");
    const otherId = createUser("snapshot-other@example.com");
    authenticate(otherId);

    const program = dbModule.db
      .prepare("INSERT INTO programs (user_id, name, description, num_weeks) VALUES (?, ?, ?, ?)")
      .run(ownerId, "Owner Program", "", 7);

    const response = await snapshotRoute.GET(
      new Request("http://localhost"),
      params({ id: String(program.lastInsertRowid) }),
    );

    expect(response.status).toBe(404);
  });

  it("returns 401 for unauthenticated snapshot request", async () => {
    const response = await snapshotRoute.GET(
      new Request("http://localhost"),
      params({ id: "1" }),
    );
    expect(response.status).toBe(401);
  });
});
