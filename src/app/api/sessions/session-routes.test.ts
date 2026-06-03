import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
let programsRoute: typeof import("../programs/route");
let sessionsRoute: typeof import("../programs/[id]/sessions/route");
let globalSessionsRoute: typeof import("./route");
let setRoute: typeof import("./[sessionId]/sets/route");
let completeRoute: typeof import("../programs/[id]/complete-and-advance/route");
let skipRoute: typeof import("../programs/[id]/skip-workout/route");
let programService: typeof import("@/features/programs/program-service");

type SeededProgram = {
  userId: number;
  programId: number;
  dayId: number;
  definitionDayId: number;
  exerciseId: number;
};

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function crossOriginJsonRequest(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
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
  dbModule.db
    .prepare("INSERT INTO user_settings (user_id, key, value) VALUES (?, 'rounding', '2.5')")
    .run(result.lastInsertRowid);
  return Number(result.lastInsertRowid);
}

function authenticate(userId: number): void {
  const { token } = auth.createSession(userId);
  cookieMock.store.set("auth_token", token);
}

function seedProgram(email: string, autoProgressionEnabled = 1): SeededProgram {
  const userId = createUser(email);
  const definition = dbModule.db
    .prepare(
      "INSERT INTO program_definitions (owner_user_id, name, num_weeks, source_type, visibility) VALUES (?, 'Program', 7, 'custom', 'private')",
    )
    .run(userId);
  const definitionId = Number(definition.lastInsertRowid);
  const run = dbModule.db
    .prepare("INSERT INTO program_runs (user_id, program_definition_id, name) VALUES (?, ?, 'Program')")
    .run(userId, definitionId);
  const runId = Number(run.lastInsertRowid);
  const program = dbModule.db
    .prepare("INSERT INTO programs (user_id, name, num_weeks, program_definition_id, program_run_id) VALUES (?, ?, ?, ?, ?)")
    .run(userId, "Program", 7, definitionId, runId);
  const definitionDay = dbModule.db
    .prepare(
      "INSERT INTO program_definition_days (program_definition_id, name, day_number, sort_order, stable_key) VALUES (?, 'Day 1', 1, 1, 'day-1')",
    )
    .run(definitionId);
  const day = dbModule.db
    .prepare("INSERT INTO days (program_id, name, day_number, shared_day_key) VALUES (?, ?, ?, ?)")
    .run(program.lastInsertRowid, "Day 1", 1, "day-1");
  const definitionExercise = dbModule.db
    .prepare(
      `INSERT INTO program_definition_exercises
        (program_definition_day_id, name, category, progression_type, stable_key)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(definitionDay.lastInsertRowid, "Squat", "main", autoProgressionEnabled ? "sbs" : "custom", "squat");
  const exercise = dbModule.db
    .prepare(
      `INSERT INTO exercises
        (day_id, name, training_max, category, progression_type, auto_progression_enabled, shared_exercise_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(day.lastInsertRowid, "Squat", 300, "main", autoProgressionEnabled ? "sbs" : "custom", autoProgressionEnabled, "squat");
  dbModule.db
    .prepare("INSERT INTO program_run_expected_maxes (program_run_id, shared_exercise_key, expected_max) VALUES (?, ?, ?)")
    .run(runId, "squat", 300);

  const insertWeek = dbModule.db.prepare(
    `INSERT INTO week_settings
      (exercise_id, week_number, intensity_pct, reps, sets, rep_out_target, calculated_weight)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insertWeek.run(exercise.lastInsertRowid, 1, 0.7, 5, 5, 10, 210);
  insertWeek.run(exercise.lastInsertRowid, 2, 0.75, 4, 5, 8, 225);
  const insertDefinitionWeek = dbModule.db.prepare(
    `INSERT INTO program_definition_week_settings
      (program_definition_exercise_id, week_number, intensity_pct, reps, sets, rep_out_target)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insertDefinitionWeek.run(definitionExercise.lastInsertRowid, 1, 0.7, 5, 5, 10);
  insertDefinitionWeek.run(definitionExercise.lastInsertRowid, 2, 0.75, 4, 5, 8);

  return {
    userId,
    programId: Number(program.lastInsertRowid),
    dayId: Number(day.lastInsertRowid),
    definitionDayId: Number(definitionDay.lastInsertRowid),
    exerciseId: Number(exercise.lastInsertRowid),
  };
}

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workout-session-routes-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  dbModule = await import("@/lib/db");
  auth = await import("@/lib/auth");
  programsRoute = await import("../programs/route");
  sessionsRoute = await import("../programs/[id]/sessions/route");
  globalSessionsRoute = await import("./route");
  setRoute = await import("./[sessionId]/sets/route");
  completeRoute = await import("../programs/[id]/complete-and-advance/route");
  skipRoute = await import("../programs/[id]/skip-workout/route");
  programService = await import("@/features/programs/program-service");
});

beforeEach(() => {
  cookieMock.store.clear();
  vi.clearAllMocks();
  dbModule.db.exec(
    "DELETE FROM session_sets; DELETE FROM sessions; DELETE FROM week_settings; DELETE FROM exercises; DELETE FROM days; DELETE FROM programs; DELETE FROM program_definition_week_settings; DELETE FROM program_definition_exercises; DELETE FROM program_definition_days; DELETE FROM program_runs; DELETE FROM program_definitions; DELETE FROM exercise_max_history; DELETE FROM shared_program_applied_versions; DELETE FROM shared_program_expected_maxes; UPDATE shared_programs SET active_version_id = NULL; DELETE FROM shared_program_versions; DELETE FROM shared_program_members; DELETE FROM shared_programs; DELETE FROM user_settings; DELETE FROM auth_sessions; DELETE FROM users;",
  );
});

describe("session APIs", () => {
  it("rejects unauthenticated session history requests", async () => {
    const response = await globalSessionsRoute.GET();

    expect(response.status).toBe(401);
  });

  it("keeps user session history visible after a program is archived", async () => {
    const seeded = seedProgram("global-history-archive@example.com");
    authenticate(seeded.userId);
    dbModule.db
      .prepare(
        "INSERT INTO sessions (program_id, user_id, day_id, week_number, completed, status, program_name, day_name) VALUES (?, ?, ?, 1, 1, 'completed', ?, ?)",
      )
      .run(seeded.programId, seeded.userId, seeded.dayId, "Program", "Day 1");
    dbModule.db.prepare("UPDATE programs SET archived_at = datetime('now'), is_active = 0 WHERE id = ?").run(seeded.programId);

    const response = await globalSessionsRoute.GET();
    const sessions = (await response.json()) as { program_name: string; day_name: string }[];

    expect(response.status).toBe(200);
    expect(sessions).toEqual(
      expect.arrayContaining([expect.objectContaining({ program_name: "Program", day_name: "Day 1" })]),
    );
  });

  it("creates a session with one session set per current-day exercise", async () => {
    const seeded = seedProgram("session@example.com");
    authenticate(seeded.userId);

    const response = await sessionsRoute.POST(
      jsonRequest({ dayId: seeded.dayId }),
      params({ id: String(seeded.programId) }),
    );
    const session = await response.json();

    expect(response.status).toBe(201);
    expect(session.week_number).toBe(1);
    expect(session.sets).toHaveLength(1);
    expect(session.sets[0]).toMatchObject({
      exercise_name: "Squat",
      calculated_weight: 210,
      reps: 5,
      sets: 5,
      rep_out_target: 10,
    });

    const sets = dbModule.db
      .prepare("SELECT ss.* FROM session_sets ss WHERE ss.session_id = ?")
      .all(session.id);
    expect(sets).toHaveLength(1);
    expect(sets[0]).toEqual(
      expect.objectContaining({
        week_setting_id: expect.any(Number),
        program_definition_week_setting_id: expect.any(Number),
        program_definition_exercise_id: expect.any(Number),
        shared_exercise_key: "squat",
        exercise_name: "Squat",
        training_max: 300,
        calculated_weight: 210,
      }),
    );

    const existingResponse = await sessionsRoute.POST(
      jsonRequest({ dayId: seeded.dayId }),
      params({ id: String(seeded.programId) }),
    );
    const existing = await existingResponse.json();

    expect(existingResponse.status).toBe(200);
    expect(existing.id).toBe(session.id);
    expect(existing.sets).toHaveLength(1);
  });

  it("hot-adds an ad-hoc accessory exercise to an active session", async () => {
    const seeded = seedProgram("hot-add@example.com");
    authenticate(seeded.userId);

    const sessionResponse = await sessionsRoute.POST(
      jsonRequest({ dayId: seeded.dayId }),
      params({ id: String(seeded.programId) }),
    );
    const session = await sessionResponse.json();

    const addResponse = await setRoute.POST(
      jsonRequest({ name: "Cable Fly", sets: 3, reps: 12, weight: 40 }),
      params({ sessionId: String(session.id) }),
    );
    const body = await addResponse.json();

    expect(addResponse.status).toBe(201);
    expect(body.sets).toHaveLength(3);
    expect(body.sets[0]).toMatchObject({
      exercise_name: "Cable Fly",
      reps: 12,
      calculated_weight: 40,
      set_number: 1,
    });

    const rows = dbModule.db
      .prepare(
        "SELECT category, progression_type, set_number FROM session_sets WHERE session_id = ? AND exercise_name = 'Cable Fly' ORDER BY set_number",
      )
      .all(session.id);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ set_number: 3, category: "accessory", progression_type: "custom" });

    const invalid = await setRoute.POST(
      jsonRequest({ name: "", sets: 3, reps: 12 }),
      params({ sessionId: String(session.id) }),
    );
    expect(invalid.status).toBe(400);
  });

  it("starts workouts from the canonical program run week when legacy program state is stale", async () => {
    const userId = createUser("session-run-state@example.com");
    authenticate(userId);
    const program = programService.createProgramRun({ userId, name: "Run First", numWeeks: 4 });
    const day = programService.addDefinitionDayForRun({
      userId,
      legacyProgramId: program.legacyProgramId,
      name: "Lower",
    });
    programService.addDefinitionExerciseForDay({
      userId,
      legacyDayId: day.legacyDayId,
      name: "Squat",
      trainingMax: 300,
      category: "main",
      progressionType: "custom",
    });
    dbModule.db.prepare("UPDATE programs SET current_week = 1, current_day = 1 WHERE id = ?").run(program.legacyProgramId);
    dbModule.db.prepare("UPDATE program_runs SET current_week = 2, current_day = 1 WHERE id = ?").run(program.runId);

    const response = await sessionsRoute.POST(
      jsonRequest({ dayId: day.legacyDayId }),
      params({ id: String(program.legacyProgramId) }),
    );
    const session = await response.json();

    expect(response.status).toBe(201);
    expect(session.week_number).toBe(2);
    expect(session.program_run_id).toBe(program.runId);
    expect(session.program_definition_id).toBe(program.definitionId);
  });

  it("starts a calendar-selected workout for the selected week and tracks the original scheduled date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00-07:00"));
    const seeded = seedProgram("session-calendar-selected@example.com");
    authenticate(seeded.userId);

    const response = await sessionsRoute.POST(
      jsonRequest({
        dayId: seeded.dayId,
        definitionDayId: seeded.definitionDayId,
        weekNumber: 2,
        scheduledDate: "2026-06-01",
      }),
      params({ id: String(seeded.programId) }),
    );
    const session = await response.json();

    expect(response.status).toBe(201);
    expect(session.week_number).toBe(2);
    expect(session.date).toBe("2026-06-04");
    expect(session.scheduled_date).toBe("2026-06-01");
    expect(session.sets[0]).toMatchObject({
      reps: 4,
      calculated_weight: 225,
    });
  });

  it("starts workouts by definition day when generated day rows are unavailable", async () => {
    const seeded = seedProgram("session-definition-day@example.com");
    authenticate(seeded.userId);
    dbModule.db.prepare("UPDATE days SET archived_at = datetime('now') WHERE id = ?").run(seeded.dayId);

    const response = await sessionsRoute.POST(
      jsonRequest({ definitionDayId: seeded.definitionDayId }),
      params({ id: String(seeded.programId) }),
    );
    const session = await response.json();

    expect(response.status).toBe(201);
    expect(session.day_id).toBeNull();
    expect(session.program_definition_day_id).toBe(seeded.definitionDayId);
    expect(session.day_name).toBe("Day 1");
    expect(session.sets[0]).toMatchObject({
      exercise_name: "Squat",
      reps: 5,
    });
  });

  it("starts a workout created from a default snapshot", async () => {
    const userId = createUser("default-start@example.com");
    authenticate(userId);
    const defaultProgram = getProgramDefault("basic-strength-3-day");
    expect(defaultProgram).toBeDefined();

    const createResponse = await programsRoute.POST(
      jsonRequest({
        name: defaultProgram!.snapshot.name,
        numWeeks: defaultProgram!.snapshot.numWeeks,
        snapshot: defaultProgram!.snapshot,
      }),
    );
    const created = await createResponse.json();
    const day = dbModule.db
      .prepare("SELECT id FROM days WHERE program_id = ? AND day_number = 1")
      .get(created.id) as { id: number };

    const response = await sessionsRoute.POST(
      jsonRequest({ dayId: day.id }),
      params({ id: String(created.id) }),
    );
    const session = await response.json();

    expect(response.status).toBe(201);
    expect(session.day_name).toBe("Lower");
    expect(session.sets.map((set: { exercise_name: string }) => set.exercise_name)).toEqual([
      "Squat",
      "Squat",
      "Squat",
      "Squat",
      "Squat",
      "Deadlift",
      "Deadlift",
      "Deadlift",
      "Deadlift",
      "Deadlift",
      "Leg Press",
      "Leg Press",
      "Leg Press",
      "Leg Press",
      "Leg Press",
    ]);
  });

  it("skips a workout once with shared version context and no progression side effects", async () => {
    const seeded = seedProgram("skip-shared@example.com");
    authenticate(seeded.userId);
    const sharedProgram = dbModule.db
      .prepare("INSERT INTO shared_programs (owner_user_id, name) VALUES (?, ?)")
      .run(seeded.userId, "Shared Program");
    dbModule.db
      .prepare("INSERT INTO shared_program_members (shared_program_id, user_id, role) VALUES (?, ?, 'owner')")
      .run(sharedProgram.lastInsertRowid, seeded.userId);
    const sharedVersion = dbModule.db
      .prepare(
        `
          INSERT INTO shared_program_versions (
            shared_program_id,
            version_number,
            published_by_user_id,
            snapshot_json
          ) VALUES (?, 1, ?, ?)
        `,
      )
      .run(
        sharedProgram.lastInsertRowid,
        seeded.userId,
        JSON.stringify({
          schemaVersion: 1,
          name: "Shared Program",
          description: "",
          numWeeks: 7,
          days: [
            {
              key: "lower",
              name: "Lower",
              exercises: [
                {
                  key: "squat",
                  name: "Squat",
                  category: "main",
                  progressionType: "sbs",
                  weeks: [{ weekNumber: 1, intensityPct: 0.7, reps: 5, sets: 5, repOutTarget: 10 }],
                },
              ],
            },
          ],
        }),
      );
    dbModule.db
      .prepare("UPDATE shared_programs SET active_version_id = ? WHERE id = ?")
      .run(sharedVersion.lastInsertRowid, sharedProgram.lastInsertRowid);
    dbModule.db
      .prepare("UPDATE programs SET shared_program_id = ?, shared_program_version_id = ? WHERE id = ?")
      .run(sharedProgram.lastInsertRowid, sharedVersion.lastInsertRowid, seeded.programId);

    const first = await skipRoute.POST(
      jsonRequest({ dayId: seeded.dayId, reason: "travel" }),
      params({ id: String(seeded.programId) }),
    );
    const firstBody = await first.json();
    const second = await skipRoute.POST(
      jsonRequest({ dayId: seeded.dayId, reason: "travel" }),
      params({ id: String(seeded.programId) }),
    );
    const secondBody = await second.json();

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(secondBody.id).toBe(firstBody.id);
    expect(firstBody).toMatchObject({
      program_id: seeded.programId,
      user_id: seeded.userId,
      day_id: seeded.dayId,
      week_number: 1,
      status: "skipped",
      skip_reason: "travel",
      shared_program_version_id: Number(sharedVersion.lastInsertRowid),
    });
    expect(firstBody.skipped_at).toEqual(expect.any(String));

    expect(dbModule.db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE program_id = ?").get(seeded.programId)).toEqual({
      count: 1,
    });
    expect(dbModule.db.prepare("SELECT COUNT(*) AS count FROM session_sets").get()).toEqual({ count: 0 });
    expect(
      dbModule.db.prepare("SELECT training_max FROM exercises WHERE id = ?").get(seeded.exerciseId),
    ).toEqual({ training_max: 300 });
    expect(
      dbModule.db.prepare("SELECT current_week, current_day FROM programs WHERE id = ?").get(seeded.programId),
    ).toEqual({ current_week: 1, current_day: 1 });
  });

  it("skips workouts by definition day when generated day rows are unavailable", async () => {
    const seeded = seedProgram("skip-definition-day@example.com");
    authenticate(seeded.userId);
    dbModule.db.prepare("UPDATE days SET archived_at = datetime('now') WHERE id = ?").run(seeded.dayId);

    const response = await skipRoute.POST(
      jsonRequest({ definitionDayId: seeded.definitionDayId, reason: "travel" }),
      params({ id: String(seeded.programId) }),
    );
    const session = await response.json();

    expect(response.status).toBe(201);
    expect(session.day_id).toBeNull();
    expect(session.program_definition_day_id).toBe(seeded.definitionDayId);
    expect(session.day_name).toBe("Day 1");
    expect(session.status).toBe("skipped");
  });

  it("logs skipped workouts with canonical run context", async () => {
    const userId = createUser("skip-run-state@example.com");
    authenticate(userId);
    const program = programService.createProgramRun({ userId, name: "Skip Run", numWeeks: 4 });
    const day = programService.addDefinitionDayForRun({
      userId,
      legacyProgramId: program.legacyProgramId,
      name: "Lower",
    });
    dbModule.db.prepare("UPDATE programs SET current_week = 1 WHERE id = ?").run(program.legacyProgramId);
    dbModule.db.prepare("UPDATE program_runs SET current_week = 3 WHERE id = ?").run(program.runId);

    const response = await skipRoute.POST(
      jsonRequest({ dayId: day.legacyDayId, reason: "late" }),
      params({ id: String(program.legacyProgramId) }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual(
      expect.objectContaining({
        week_number: 3,
        program_definition_id: program.definitionId,
        program_run_id: program.runId,
        program_name: "Skip Run",
        day_name: "Lower",
      }),
    );
  });

  it("rejects cross-origin skip requests and malformed program ids", async () => {
    const seeded = seedProgram("skip-guard@example.com");
    authenticate(seeded.userId);

    expect(
      (
        await skipRoute.POST(
          crossOriginJsonRequest({ dayId: seeded.dayId, reason: "csrf" }),
          params({ id: String(seeded.programId) }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await skipRoute.POST(
          jsonRequest({ dayId: seeded.dayId, reason: "bad id" }),
          params({ id: `${seeded.programId}abc` }),
        )
      ).status,
    ).toBe(404);
    expect(
      dbModule.db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE program_id = ?").get(seeded.programId),
    ).toEqual({ count: 0 });
  });

  it("creates session sets only for current runnable exercises", async () => {
    const seeded = seedProgram("archived-exercise-session@example.com");
    authenticate(seeded.userId);
    const archivedExercise = dbModule.db
      .prepare(
        `
          INSERT INTO exercises (
            day_id,
            name,
            training_max,
            category,
            progression_type,
            auto_progression_enabled,
            archived_at
          ) VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
        `,
      )
      .run(seeded.dayId, "Archived Curl", 80, "accessory", "custom");
    dbModule.db
      .prepare(
        `
          INSERT INTO week_settings (
            exercise_id,
            week_number,
            intensity_pct,
            reps,
            sets,
            rep_out_target,
            calculated_weight
          ) VALUES (?, 1, 0.7, 12, 3, 15, 55)
        `,
      )
      .run(archivedExercise.lastInsertRowid);

    const response = await sessionsRoute.POST(
      jsonRequest({ dayId: seeded.dayId }),
      params({ id: String(seeded.programId) }),
    );
    const session = await response.json();

    expect(response.status).toBe(201);
    expect(session.sets.map((set: { exercise_name: string }) => set.exercise_name)).toEqual(["Squat"]);
  });

  it("rejects starting a workout for an archived day", async () => {
    const seeded = seedProgram("archived-day-session@example.com");
    authenticate(seeded.userId);
    dbModule.db.prepare("UPDATE days SET archived_at = datetime('now') WHERE id = ?").run(seeded.dayId);

    const response = await sessionsRoute.POST(
      jsonRequest({ dayId: seeded.dayId }),
      params({ id: String(seeded.programId) }),
    );

    expect(response.status).toBe(404);
  });

  it("lists sessions for a specific owned program", async () => {
    const seeded = seedProgram("program-session-list@example.com");
    authenticate(seeded.userId);

    await sessionsRoute.POST(jsonRequest({ dayId: seeded.dayId }), params({ id: String(seeded.programId) }));

    const response = await sessionsRoute.GET(new Request("http://localhost"), params({ id: String(seeded.programId) }));
    const rows = (await response.json()) as { program_id: number }[];

    expect(response.status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0].program_id).toBe(seeded.programId);
  });

  it("lists definition-day sessions after generated day rows are unavailable", async () => {
    const seeded = seedProgram("program-session-definition-list@example.com");
    authenticate(seeded.userId);
    dbModule.db.prepare("UPDATE days SET archived_at = datetime('now') WHERE id = ?").run(seeded.dayId);
    await sessionsRoute.POST(
      jsonRequest({ definitionDayId: seeded.definitionDayId }),
      params({ id: String(seeded.programId) }),
    );

    const response = await sessionsRoute.GET(new Request("http://localhost"), params({ id: String(seeded.programId) }));
    const rows = (await response.json()) as { day_name: string; program_definition_day_id: number }[];

    expect(response.status).toBe(200);
    expect(rows).toEqual([
      expect.objectContaining({ day_name: "Day 1", program_definition_day_id: seeded.definitionDayId }),
    ]);
  });

  it("rejects starting a workout when the day has no exercises", async () => {
    const userId = createUser("empty-day@example.com");
    authenticate(userId);
    const program = dbModule.db
      .prepare("INSERT INTO programs (user_id, name) VALUES (?, ?)")
      .run(userId, "Empty Program");
    const day = dbModule.db
      .prepare("INSERT INTO days (program_id, name, day_number) VALUES (?, ?, ?)")
      .run(program.lastInsertRowid, "Empty Day", 1);

    const response = await sessionsRoute.POST(
      jsonRequest({ dayId: day.lastInsertRowid }),
      params({ id: String(program.lastInsertRowid) }),
    );
    const retry = await sessionsRoute.POST(
      jsonRequest({ dayId: day.lastInsertRowid }),
      params({ id: String(program.lastInsertRowid) }),
    );
    const persistedSessions = dbModule.db
      .prepare("SELECT COUNT(*) AS count FROM sessions WHERE program_id = ?")
      .get(program.lastInsertRowid) as { count: number };

    expect(response.status).toBe(400);
    expect(retry.status).toBe(400);
    expect(persistedSessions.count).toBe(0);
  });

  it("updates set logging without changing the training max", async () => {
    const seeded = seedProgram("log@example.com");
    authenticate(seeded.userId);

    const session = await (
      await sessionsRoute.POST(jsonRequest({ dayId: seeded.dayId }), params({ id: String(seeded.programId) }))
    ).json();
    const set = dbModule.db.prepare("SELECT id FROM session_sets WHERE session_id = ?").get(session.id) as {
      id: number;
    };

    const response = await setRoute.PUT(
      jsonRequest({ setId: set.id, actualReps: 13, actualWeight: 210, notes: "strong" }),
      params({ sessionId: String(session.id) }),
    );

    expect(response.status).toBe(200);

    const exercise = dbModule.db.prepare("SELECT training_max FROM exercises WHERE id = ?").get(seeded.exerciseId) as {
      training_max: number;
    };
    expect(exercise.training_max).toBe(300);
  });

  it("validates set logging input", async () => {
    const seeded = seedProgram("invalid-set@example.com");
    authenticate(seeded.userId);

    const session = await (
      await sessionsRoute.POST(jsonRequest({ dayId: seeded.dayId }), params({ id: String(seeded.programId) }))
    ).json();

    expect((await setRoute.PUT(jsonRequest({}), params({ sessionId: String(session.id) }))).status).toBe(400);
    expect(
      (await setRoute.PUT(jsonRequest({ setId: 9999, actualReps: 1 }), params({ sessionId: String(session.id) }))).status,
    ).toBe(404);

    const set = dbModule.db.prepare("SELECT id FROM session_sets WHERE session_id = ?").get(session.id) as {
      id: number;
    };
    expect(
      (await setRoute.PUT(jsonRequest({ setId: set.id, actualReps: -1 }), params({ sessionId: String(session.id) }))).status,
    ).toBe(400);
  });

  it("completes once, applies TM progression once, and advances the program", async () => {
    const seeded = seedProgram("complete@example.com");
    authenticate(seeded.userId);

    const session = await (
      await sessionsRoute.POST(jsonRequest({ dayId: seeded.dayId }), params({ id: String(seeded.programId) }))
    ).json();
    const set = dbModule.db.prepare("SELECT id FROM session_sets WHERE session_id = ?").get(session.id) as {
      id: number;
    };
    await setRoute.PUT(jsonRequest({ setId: set.id, actualReps: 12 }), params({ sessionId: String(session.id) }));

    const first = await completeRoute.POST(
      jsonRequest({ sessionId: session.id }),
      params({ id: String(seeded.programId) }),
    );
    const second = await completeRoute.POST(
      jsonRequest({ sessionId: session.id }),
      params({ id: String(seeded.programId) }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const exercise = dbModule.db.prepare("SELECT training_max FROM exercises WHERE id = ?").get(seeded.exerciseId) as {
      training_max: number;
    };
    const runMax = dbModule.db
      .prepare("SELECT expected_max FROM program_run_expected_maxes WHERE shared_exercise_key = 'squat'")
      .get() as { expected_max: number };
    const program = dbModule.db.prepare("SELECT current_week, current_day FROM programs WHERE id = ?").get(seeded.programId) as {
      current_week: number;
      current_day: number;
    };

    expect(exercise.training_max).toBe(300);
    expect(runMax.expected_max).toBe(305);
    expect(program).toEqual({ current_week: 2, current_day: 1 });
  });

  it("advances the canonical program run when completing a workout", async () => {
    const userId = createUser("complete-run-state@example.com");
    authenticate(userId);
    const program = programService.createProgramRun({ userId, name: "Run Advance", numWeeks: 4 });
    const day = programService.addDefinitionDayForRun({
      userId,
      legacyProgramId: program.legacyProgramId,
      name: "Lower",
    });
    programService.addDefinitionExerciseForDay({
      userId,
      legacyDayId: day.legacyDayId,
      name: "Squat",
      trainingMax: 300,
      category: "main",
      progressionType: "custom",
    });

    const session = await (
      await sessionsRoute.POST(jsonRequest({ dayId: day.legacyDayId }), params({ id: String(program.legacyProgramId) }))
    ).json();
    const response = await completeRoute.POST(
      jsonRequest({ sessionId: session.id }),
      params({ id: String(program.legacyProgramId) }),
    );

    expect(response.status).toBe(200);
    expect(
      dbModule.db.prepare("SELECT current_week, current_day FROM program_runs WHERE id = ?").get(program.runId),
    ).toEqual({ current_week: 2, current_day: 1 });
  });

  it("does not advance the active run when completing a calendar-launched workout outside the current position", async () => {
    const userId = createUser("complete-calendar-out-of-order@example.com");
    authenticate(userId);
    const program = programService.createProgramRun({ userId, name: "Calendar Catchup", numWeeks: 4 });
    const dayOne = programService.addDefinitionDayForRun({
      userId,
      legacyProgramId: program.legacyProgramId,
      name: "Lower",
    });
    const dayTwo = programService.addDefinitionDayForRun({
      userId,
      legacyProgramId: program.legacyProgramId,
      name: "Upper",
    });
    programService.addDefinitionExerciseForDay({
      userId,
      legacyDayId: dayOne.legacyDayId,
      name: "Squat",
      trainingMax: 300,
      category: "main",
      progressionType: "custom",
    });
    programService.addDefinitionExerciseForDay({
      userId,
      legacyDayId: dayTwo.legacyDayId,
      name: "Bench",
      trainingMax: 200,
      category: "main",
      progressionType: "custom",
    });
    programService.updateProgramRun({
      userId,
      legacyProgramId: program.legacyProgramId,
      currentWeek: 2,
      currentDay: 2,
      scheduleWeekdays: [1, 3],
    });

    const session = await (
      await sessionsRoute.POST(
        jsonRequest({
          dayId: dayTwo.legacyDayId,
          definitionDayId: dayTwo.definitionDayId,
          weekNumber: 1,
          scheduledDate: "2026-05-27",
        }),
        params({ id: String(program.legacyProgramId) }),
      )
    ).json();
    const response = await completeRoute.POST(
      jsonRequest({ sessionId: session.id }),
      params({ id: String(program.legacyProgramId) }),
    );

    expect(response.status).toBe(200);
    expect(
      dbModule.db.prepare("SELECT current_week, current_day FROM program_runs WHERE id = ?").get(program.runId),
    ).toEqual({ current_week: 2, current_day: 2 });
    expect(
      dbModule.db.prepare("SELECT current_week, current_day FROM programs WHERE id = ?").get(program.legacyProgramId),
    ).toEqual({ current_week: 2, current_day: 2 });
  });

  it("completes definition-day sessions when generated day rows are unavailable", async () => {
    const seeded = seedProgram("complete-definition-day@example.com");
    authenticate(seeded.userId);
    dbModule.db.prepare("UPDATE days SET archived_at = datetime('now') WHERE id = ?").run(seeded.dayId);
    const session = await (
      await sessionsRoute.POST(
        jsonRequest({ definitionDayId: seeded.definitionDayId }),
        params({ id: String(seeded.programId) }),
      )
    ).json();
    const set = dbModule.db.prepare("SELECT id FROM session_sets WHERE session_id = ?").get(session.id) as {
      id: number;
    };
    await setRoute.PUT(jsonRequest({ setId: set.id, actualReps: 12 }), params({ sessionId: String(session.id) }));

    const response = await completeRoute.POST(
      jsonRequest({ sessionId: session.id }),
      params({ id: String(seeded.programId) }),
    );

    expect(response.status).toBe(200);
    expect(
      dbModule.db.prepare("SELECT current_week, current_day FROM program_runs WHERE id = ?").get(session.program_run_id),
    ).toEqual({ current_week: 2, current_day: 1 });
  });

  it("advances from the completed session day when schedule mapping starts a later day", async () => {
    const userId = createUser("scheduled-complete@example.com");
    authenticate(userId);
    const program = programService.createProgramRun({ userId, name: "Scheduled Program", numWeeks: 7 });
    programService.addDefinitionDayForRun({ userId, legacyProgramId: program.legacyProgramId, name: "Monday Lower" });
    const dayTwo = programService.addDefinitionDayForRun({
      userId,
      legacyProgramId: program.legacyProgramId,
      name: "Wednesday Upper",
    });
    programService.addDefinitionDayForRun({ userId, legacyProgramId: program.legacyProgramId, name: "Friday Pull" });
    programService.addDefinitionExerciseForDay({
      userId,
      legacyDayId: dayTwo.legacyDayId,
      name: "Bench",
      trainingMax: 200,
      category: "main",
      progressionType: "custom",
    });
    programService.updateProgramRun({
      userId,
      legacyProgramId: program.legacyProgramId,
      currentWeek: 1,
      currentDay: 3,
      scheduleWeekdays: [1, 3, 5],
    });

    const session = await (
      await sessionsRoute.POST(jsonRequest({ dayId: dayTwo.legacyDayId }), params({ id: String(program.legacyProgramId) }))
    ).json();
    const response = await completeRoute.POST(
      jsonRequest({ sessionId: session.id }),
      params({ id: String(program.legacyProgramId) }),
    );

    expect(response.status).toBe(200);
    expect(
      dbModule.db.prepare("SELECT current_week, current_day FROM program_runs WHERE id = ?").get(program.runId),
    ).toEqual({ current_week: 1, current_day: 3 });
  });

  it("falls back to category progression for unknown stored template ids", async () => {
    const seeded = seedProgram("legacy-template@example.com");
    authenticate(seeded.userId);
    dbModule.db
      .prepare("UPDATE program_definition_exercises SET progression_type = ? WHERE stable_key = 'squat'")
      .run("legacy-import");

    const session = await (
      await sessionsRoute.POST(jsonRequest({ dayId: seeded.dayId }), params({ id: String(seeded.programId) }))
    ).json();
    const set = dbModule.db.prepare("SELECT id FROM session_sets WHERE session_id = ?").get(session.id) as {
      id: number;
    };
    await setRoute.PUT(jsonRequest({ setId: set.id, actualReps: 12 }), params({ sessionId: String(session.id) }));

    const response = await completeRoute.POST(
      jsonRequest({ sessionId: session.id }),
      params({ id: String(seeded.programId) }),
    );

    expect(response.status).toBe(200);
    const runMax = dbModule.db
      .prepare("SELECT expected_max FROM program_run_expected_maxes WHERE shared_exercise_key = 'squat'")
      .get() as { expected_max: number };
    expect(runMax.expected_max).toBe(305);
  });

  it("rejects completion when an auto-progression set has no logged reps", async () => {
    const seeded = seedProgram("missing-reps@example.com");
    authenticate(seeded.userId);

    const session = await (
      await sessionsRoute.POST(jsonRequest({ dayId: seeded.dayId }), params({ id: String(seeded.programId) }))
    ).json();

    const response = await completeRoute.POST(
      jsonRequest({ sessionId: session.id }),
      params({ id: String(seeded.programId) }),
    );

    expect(response.status).toBe(400);

    const exercise = dbModule.db.prepare("SELECT training_max FROM exercises WHERE id = ?").get(seeded.exerciseId) as {
      training_max: number;
    };
    expect(exercise.training_max).toBe(300);
  });

  it("does not auto-adjust custom progression exercises", async () => {
    const seeded = seedProgram("custom-session@example.com", 0);
    authenticate(seeded.userId);

    const session = await (
      await sessionsRoute.POST(jsonRequest({ dayId: seeded.dayId }), params({ id: String(seeded.programId) }))
    ).json();
    const set = dbModule.db.prepare("SELECT id FROM session_sets WHERE session_id = ?").get(session.id) as {
      id: number;
    };
    await setRoute.PUT(jsonRequest({ setId: set.id, actualReps: 20 }), params({ sessionId: String(session.id) }));
    await completeRoute.POST(jsonRequest({ sessionId: session.id }), params({ id: String(seeded.programId) }));

    const exercise = dbModule.db.prepare("SELECT training_max FROM exercises WHERE id = ?").get(seeded.exerciseId) as {
      training_max: number;
    };
    expect(exercise.training_max).toBe(300);
  });

  it("prevents users from completing another user's session", async () => {
    const owner = seedProgram("owner-session@example.com");
    const otherUserId = createUser("intruder@example.com");
    authenticate(owner.userId);
    const session = await (
      await sessionsRoute.POST(jsonRequest({ dayId: owner.dayId }), params({ id: String(owner.programId) }))
    ).json();

    cookieMock.store.clear();
    authenticate(otherUserId);

    const response = await completeRoute.POST(
      jsonRequest({ sessionId: session.id }),
      params({ id: String(owner.programId) }),
    );

    expect(response.status).toBe(404);
  });

  it("lists only the current user's sessions", async () => {
    const owner = seedProgram("history-owner@example.com");
    const other = seedProgram("history-other@example.com");
    authenticate(owner.userId);
    await sessionsRoute.POST(jsonRequest({ dayId: owner.dayId }), params({ id: String(owner.programId) }));

    cookieMock.store.clear();
    authenticate(other.userId);
    await sessionsRoute.POST(jsonRequest({ dayId: other.dayId }), params({ id: String(other.programId) }));

    cookieMock.store.clear();
    authenticate(owner.userId);
    const response = await globalSessionsRoute.GET();
    const rows = (await response.json()) as { program_id: number }[];

    expect(rows.map((row) => row.program_id)).toEqual([owner.programId]);
  });
});
