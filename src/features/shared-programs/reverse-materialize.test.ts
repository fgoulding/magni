import { beforeEach, describe, expect, it, vi } from "vitest";

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
let reverseMaterialize: typeof import("./reverse-materialize");
let auth: typeof import("@/lib/auth");
let programService: typeof import("@/features/programs/program-service");

beforeEach(async () => {
  vi.resetModules();

  const path = await import("node:path");
  const os = await import("node:os");
  const fs = await import("node:fs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workout-reverse-materialize-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  dbModule = await import("@/lib/db");
  reverseMaterialize = await import("./reverse-materialize");
  auth = await import("@/lib/auth");
  programService = await import("@/features/programs/program-service");
  cookieMock.store.clear();
});

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

describe("reverseMaterializeProgram", () => {
  it("reconstructs snapshots from the canonical definition when legacy execution rows are stale", () => {
    const userId = createUser("definition-reverse@example.com");
    authenticate(userId);
    const program = programService.createProgramRun({
      userId,
      name: "Canonical Program",
      description: "Definition description",
      numWeeks: 4,
    });
    const day = programService.addDefinitionDayForRun({
      userId,
      legacyProgramId: program.legacyProgramId,
      name: "Lower",
    });
    programService.addDefinitionExerciseForDay({
      userId,
      legacyDayId: day.legacyDayId,
      name: "Squat",
      trainingMax: 315,
      category: "main",
      progressionType: "custom",
    });
    dbModule.db.prepare("UPDATE programs SET name = 'Stale Program', description = 'stale', num_weeks = 1 WHERE id = ?").run(
      program.legacyProgramId,
    );
    dbModule.db.prepare("UPDATE days SET name = 'Stale Day' WHERE id = ?").run(day.legacyDayId);

    const snapshot = reverseMaterialize.reverseMaterializeProgram(program.legacyProgramId, userId);

    expect(snapshot).toEqual(
      expect.objectContaining({
        name: "Canonical Program",
        description: "Definition description",
        numWeeks: 4,
      }),
    );
    expect(snapshot.days[0]).toEqual(
      expect.objectContaining({
        key: day.dayStableKey,
        name: "Lower",
      }),
    );
  });

  it("reconstructs a valid snapshot from a program created with a default", () => {
    const userId = createUser("reverse@example.com");
    authenticate(userId);

    const program = dbModule.db
      .prepare("INSERT INTO programs (user_id, name, description, num_weeks) VALUES (?, ?, ?, ?)")
      .run(userId, "Test Program", "A test", 7);
    const programId = Number(program.lastInsertRowid);

    const day = dbModule.db
      .prepare(
        "INSERT INTO days (program_id, name, day_number, sort_order, shared_day_key) VALUES (?, ?, ?, ?, ?)",
      )
      .run(programId, "Lower", 1, 1, "test:day:lower");
    const dayId = Number(day.lastInsertRowid);

    const exercise = dbModule.db
      .prepare(
        "INSERT INTO exercises (day_id, name, training_max, category, progression_type, auto_progression_enabled, sort_order, shared_exercise_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(dayId, "Squat", 315, "main", "sbs", 1, 1, "test:exercise:squat");
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
      .run(exerciseId, 3, 0.7, 5, 5, 10);
    dbModule.db
      .prepare(
        "INSERT INTO week_settings (exercise_id, week_number, intensity_pct, reps, sets, rep_out_target) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(exerciseId, 4, 0.75, 4, 5, 8);
    dbModule.db
      .prepare(
        "INSERT INTO week_settings (exercise_id, week_number, intensity_pct, reps, sets, rep_out_target) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(exerciseId, 5, 0.7, 5, 5, 10);
    dbModule.db
      .prepare(
        "INSERT INTO week_settings (exercise_id, week_number, intensity_pct, reps, sets, rep_out_target) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(exerciseId, 6, 0.75, 4, 5, 8);
    dbModule.db
      .prepare(
        "INSERT INTO week_settings (exercise_id, week_number, intensity_pct, reps, sets, rep_out_target) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(exerciseId, 7, 0.7, 5, 5, 10);

    const snapshot = reverseMaterialize.reverseMaterializeProgram(programId, userId);

    expect(snapshot).toEqual({
      schemaVersion: 1,
      name: "Test Program",
      description: "A test",
      numWeeks: 7,
      days: [
        {
          key: "test:day:lower",
          name: "Lower",
          exercises: [
            {
              key: "test:exercise:squat",
              name: "Squat",
              category: "main",
              progressionType: "sbs",
              weeks: [
                { weekNumber: 1, intensityPct: 0.7, reps: 5, sets: 5, repOutTarget: 10 },
                { weekNumber: 2, intensityPct: 0.75, reps: 4, sets: 5, repOutTarget: 8 },
              ],
            },
          ],
        },
      ],
    });
  });

  it("synthesizes stable keys for manual days and exercises without shared keys", () => {
    const userId = createUser("no-keys@example.com");
    authenticate(userId);

    const program = dbModule.db
      .prepare("INSERT INTO programs (user_id, name, description, num_weeks) VALUES (?, ?, ?, ?)")
      .run(userId, "Mixed Program", "", 4);
    const programId = Number(program.lastInsertRowid);

    const day = dbModule.db
      .prepare("INSERT INTO days (program_id, name, day_number, sort_order) VALUES (?, ?, ?, ?)")
      .run(programId, "Day No Key", 2, 2);
    const dayId = Number(day.lastInsertRowid);
    const exercise = dbModule.db
      .prepare(
        "INSERT INTO exercises (day_id, name, training_max, category, progression_type, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(dayId, "Manual Squat", 300, "main", "custom", 1);
    const exerciseId = Number(exercise.lastInsertRowid);
    dbModule.db
      .prepare(
        "INSERT INTO week_settings (exercise_id, week_number, intensity_pct, reps, sets, rep_out_target) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(exerciseId, 1, 0.7, 5, 3, 8);

    const snapshot = reverseMaterialize.reverseMaterializeProgram(programId, userId);

    expect(snapshot.days).toEqual([
      {
        key: `program:${programId}:day:${dayId}`,
        name: "Day No Key",
        exercises: [
          {
            key: `program:${programId}:exercise:${exerciseId}`,
            name: "Manual Squat",
            category: "main",
            progressionType: "custom",
            weeks: [{ weekNumber: 1, intensityPct: 0.7, reps: 5, sets: 3, repOutTarget: 8 }],
          },
        ],
      },
    ]);
  });

  it("skips archived days and exercises", () => {
    const userId = createUser("archived@example.com");
    authenticate(userId);

    const program = dbModule.db
      .prepare("INSERT INTO programs (user_id, name, description, num_weeks) VALUES (?, ?, ?, ?)")
      .run(userId, "Archived Test", "", 7);
    const programId = Number(program.lastInsertRowid);

    dbModule.db
      .prepare(
        "INSERT INTO days (program_id, name, day_number, sort_order, shared_day_key) VALUES (?, ?, ?, ?, ?)",
      )
      .run(programId, "Live Day", 1, 1, "key:day:live");

    dbModule.db
      .prepare(
        "INSERT INTO days (program_id, name, day_number, sort_order, shared_day_key, archived_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
      )
      .run(programId, "Archived Day", 2, 2, "key:day:archived");

    const snapshot = reverseMaterialize.reverseMaterializeProgram(programId, userId);

    expect(snapshot.days).toHaveLength(1);
    expect(snapshot.days[0].name).toBe("Live Day");
  });

  it("throws when the user does not own the program", () => {
    const ownerId = createUser("owner@example.com");
    const otherId = createUser("other@example.com");
    authenticate(otherId);

    const program = dbModule.db
      .prepare("INSERT INTO programs (user_id, name, description, num_weeks) VALUES (?, ?, ?, ?)")
      .run(ownerId, "Owner Program", "", 7);

    expect(() =>
      reverseMaterialize.reverseMaterializeProgram(Number(program.lastInsertRowid), otherId),
    ).toThrow();
  });
});
