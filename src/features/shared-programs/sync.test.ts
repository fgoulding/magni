import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SharedProgramSnapshot } from "@/features/shared-programs/types";

type DbModule = typeof import("@/lib/db");
type RepositoryModule = typeof import("@/features/shared-programs/repository");
type SyncModule = typeof import("@/features/shared-programs/sync");

let dbModule: DbModule;
let repository: RepositoryModule;
let sync: SyncModule;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shared-program-sync-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  dbModule = await import("@/lib/db");
  repository = await import("@/features/shared-programs/repository");
  sync = await import("@/features/shared-programs/sync");
});

beforeEach(() => {
  dbModule.db.exec(`
    DELETE FROM session_sets;
    DELETE FROM sessions;
    DELETE FROM week_settings;
    DELETE FROM exercises;
    DELETE FROM days;
    DELETE FROM programs;
    DELETE FROM program_run_expected_maxes;
    DELETE FROM program_run_schedule_days;
    DELETE FROM program_runs;
    DELETE FROM program_definition_week_settings;
    DELETE FROM program_definition_exercises;
    DELETE FROM program_definition_days;
    DELETE FROM program_definitions;
    DELETE FROM exercise_max_history;
    DELETE FROM shared_program_applied_versions;
    DELETE FROM shared_program_expected_maxes;
    UPDATE shared_programs SET active_version_id = NULL;
    DELETE FROM shared_program_versions;
    DELETE FROM shared_program_members;
    DELETE FROM shared_programs;
    DELETE FROM user_settings;
    DELETE FROM users;
  `);
});

afterAll(() => {
  dbModule.db.close();
});

type ExerciseInput = Readonly<{
  key: string;
  name: string;
  category?: "main" | "aux" | "accessory";
  progressionType?: string;
  weeks?: SharedProgramSnapshot["days"][number]["exercises"][number]["weeks"];
}>;

function createUser(email: string): number {
  return Number(dbModule.db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run(email, "hash").lastInsertRowid);
}

function makeExercise(input: ExerciseInput): SharedProgramSnapshot["days"][number]["exercises"][number] {
  return {
    key: input.key,
    name: input.name,
    category: input.category ?? "main",
    progressionType: input.progressionType ?? "sbs",
    weeks: input.weeks ?? [
      { weekNumber: 1, intensityPct: 0.7, reps: 5, sets: 3, repOutTarget: 8 },
      { weekNumber: 2, intensityPct: 0.75, reps: 4, sets: 4, repOutTarget: 7 },
    ],
  };
}

function makeSnapshot({
  name = "Shared Strength",
  description = "Synced program",
  numWeeks = 3,
  days = [
    {
      key: "lower",
      name: "Lower",
      exercises: [makeExercise({ key: "squat", name: "Squat" })],
    },
  ],
}: Partial<SharedProgramSnapshot> = {}): SharedProgramSnapshot {
  return {
    schemaVersion: 1,
    name,
    description,
    numWeeks,
    days,
  };
}

function createSharedProgram(ownerUserId: number, snapshot: SharedProgramSnapshot) {
  return repository.createSharedProgram({
    ownerUserId,
    name: snapshot.name,
    description: snapshot.description,
    snapshot,
  });
}

function getPrivateProgram(sharedProgramId: number, userId: number) {
  return dbModule.db
    .prepare("SELECT * FROM programs WHERE shared_program_id = ? AND user_id = ?")
    .get(sharedProgramId, userId) as
    | {
        id: number;
        name: string;
        description: string;
        num_weeks: number;
        shared_program_version_id: number;
      }
    | undefined;
}

function getDays(programId: number) {
  return dbModule.db
    .prepare("SELECT id, name, day_number, sort_order, shared_day_key, archived_at FROM days WHERE program_id = ? ORDER BY id")
    .all(programId) as {
    id: number;
    name: string;
    day_number: number;
    sort_order: number;
    shared_day_key: string;
    archived_at: string | null;
  }[];
}

function getExercises(programId: number) {
  return dbModule.db
    .prepare(
      `
        SELECT e.id, e.day_id, e.name, e.training_max, e.category, e.progression_type, e.sort_order,
               e.shared_exercise_key, e.archived_at
        FROM exercises e
        INNER JOIN days d ON d.id = e.day_id
        WHERE d.program_id = ?
        ORDER BY e.id
      `,
    )
    .all(programId) as {
    id: number;
    day_id: number;
    name: string;
    training_max: number;
    category: string;
    progression_type: string;
    sort_order: number;
    shared_exercise_key: string;
    archived_at: string | null;
  }[];
}

function createCompletedSession(programId: number, userId: number, exerciseId: number, versionId?: number) {
  const exercise = dbModule.db
    .prepare("SELECT day_id FROM exercises WHERE id = ?")
    .get(exerciseId) as { day_id: number };
  const weekSetting = dbModule.db
    .prepare("SELECT id FROM week_settings WHERE exercise_id = ? ORDER BY week_number LIMIT 1")
    .get(exerciseId) as { id: number };
  const session = dbModule.db
    .prepare(
      `
        INSERT INTO sessions (
          program_id,
          user_id,
          day_id,
          week_number,
          completed,
          status,
          shared_program_version_id,
          date
        ) VALUES (?, ?, ?, 1, 1, 'completed', ?, '2030-01-01')
      `,
    )
    .run(programId, userId, exercise.day_id, versionId ?? null);

  dbModule.db
    .prepare("INSERT INTO session_sets (session_id, week_setting_id, actual_reps, actual_weight) VALUES (?, ?, ?, ?)")
    .run(session.lastInsertRowid, weekSetting.id, 8, 225);

  return Number(session.lastInsertRowid);
}

describe("shared program sync", () => {
  it("applies a first version by creating a private runnable program", () => {
    const userId = createUser("owner@example.com");
    const snapshot = makeSnapshot();
    const sharedProgram = createSharedProgram(userId, snapshot);
    const review = sync.getSharedProgramSyncReview({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: sharedProgram.activeVersionId!,
    });

    expect(review.currentVersionId).toBeNull();
    expect(review.requiredExpectedMaxKeys).toEqual(["squat"]);

    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: sharedProgram.activeVersionId!,
      expectedMaxes: { squat: 315 },
    });

    const program = getPrivateProgram(sharedProgram.id, userId);
    expect(program).toEqual(
      expect.objectContaining({
        name: "Shared Strength",
        description: "Synced program",
        num_weeks: 3,
        shared_program_version_id: sharedProgram.activeVersionId,
      }),
    );
    expect(
      dbModule.db
        .prepare(
          `
            SELECT
              pd.shared_program_id,
              pd.shared_program_version_id,
              pd.source_type,
              pd.visibility,
              pr.user_id,
              pr.current_week,
              pr.current_day,
              pdrx.expected_max
            FROM programs p
            JOIN program_definitions pd ON pd.id = p.program_definition_id
            JOIN program_runs pr ON pr.id = p.program_run_id
            JOIN program_run_expected_maxes pdrx
              ON pdrx.program_run_id = pr.id
             AND pdrx.shared_exercise_key = 'squat'
            WHERE p.id = ?
          `,
        )
        .get(program!.id),
    ).toEqual({
      shared_program_id: sharedProgram.id,
      shared_program_version_id: sharedProgram.activeVersionId,
      source_type: "shared",
      visibility: "shared",
      user_id: userId,
      current_week: 1,
      current_day: 1,
      expected_max: 315,
    });
    expect(getDays(program!.id)).toEqual([
      expect.objectContaining({ name: "Lower", day_number: 1, sort_order: 1, shared_day_key: "lower", archived_at: null }),
    ]);
    const exercises = getExercises(program!.id);
    expect(exercises).toEqual([
      expect.objectContaining({
        name: "Squat",
        training_max: 315,
        category: "main",
        progression_type: "sbs",
        sort_order: 1,
        shared_exercise_key: "squat",
        archived_at: null,
      }),
    ]);
    expect(
      dbModule.db
        .prepare("SELECT week_number, intensity_pct, calculated_weight FROM week_settings WHERE exercise_id = ? ORDER BY week_number")
        .all(exercises[0].id),
    ).toEqual([
      { week_number: 1, intensity_pct: 0.7, calculated_weight: 220 },
      { week_number: 2, intensity_pct: 0.75, calculated_weight: 237.5 },
      { week_number: 3, intensity_pct: 0.7, calculated_weight: 220 },
    ]);
    expect(
      dbModule.db
        .prepare("SELECT action, version_id FROM shared_program_applied_versions WHERE shared_program_id = ? AND user_id = ?")
        .all(sharedProgram.id, userId),
    ).toEqual([{ action: "apply", version_id: sharedProgram.activeVersionId }]);
  });

  it("writes expected maxes to history when applying sync", () => {
    const userId = createUser("history@example.com");
    const sharedProgram = createSharedProgram(userId, makeSnapshot());

    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: sharedProgram.activeVersionId!,
      expectedMaxes: { squat: 300 },
    });

    expect(
      dbModule.db
        .prepare(
          `
            SELECT shared_program_id, shared_program_version_id, shared_exercise_key, training_max, source
            FROM exercise_max_history
          `,
        )
        .all(),
    ).toEqual([
      {
        shared_program_id: sharedProgram.id,
        shared_program_version_id: sharedProgram.activeVersionId,
        shared_exercise_key: "squat",
        training_max: 300,
        source: "sync",
      },
    ]);
  });

  it("applies newer versions while preserving training maxes by shared exercise key", () => {
    const userId = createUser("newer@example.com");
    const firstSnapshot = makeSnapshot();
    const sharedProgram = createSharedProgram(userId, firstSnapshot);
    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: sharedProgram.activeVersionId!,
      expectedMaxes: { squat: 300 },
    });
    const program = getPrivateProgram(sharedProgram.id, userId)!;
    dbModule.db.prepare("UPDATE exercises SET training_max = 333 WHERE shared_exercise_key = 'squat'").run();

    const secondVersion = repository.publishSharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      actingUserId: userId,
      snapshot: makeSnapshot({
        name: "Shared Strength V2",
        description: "Updated",
        numWeeks: 4,
        days: [
          {
            key: "lower",
            name: "Lower Body",
            exercises: [
              makeExercise({ key: "squat", name: "Comp Squat" }),
              makeExercise({ key: "bench", name: "Bench Press", category: "aux" }),
            ],
          },
        ],
      }),
    });

    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: secondVersion.id,
      expectedMaxes: { bench: 225 },
    });

    expect(getPrivateProgram(sharedProgram.id, userId)).toEqual(
      expect.objectContaining({
        id: program.id,
        name: "Shared Strength V2",
        description: "Updated",
        num_weeks: 4,
        shared_program_version_id: secondVersion.id,
      }),
    );
    expect(getExercises(program.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ shared_exercise_key: "squat", name: "Comp Squat", training_max: 333 }),
        expect.objectContaining({ shared_exercise_key: "bench", name: "Bench Press", training_max: 225 }),
      ]),
    );
  });

  it("updates sort order for reordered days and exercises while preserving stable keys", () => {
    const userId = createUser("reorder@example.com");
    const firstSnapshot = makeSnapshot({
      days: [
        { key: "lower", name: "Lower", exercises: [makeExercise({ key: "squat", name: "Squat" })] },
        {
          key: "upper",
          name: "Upper",
          exercises: [
            makeExercise({ key: "bench", name: "Bench Press", category: "aux" }),
            makeExercise({ key: "row", name: "Row", category: "aux" }),
          ],
        },
      ],
    });
    const sharedProgram = createSharedProgram(userId, firstSnapshot);
    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: sharedProgram.activeVersionId!,
      expectedMaxes: { squat: 315, bench: 225, row: 185 },
    });
    const program = getPrivateProgram(sharedProgram.id, userId)!;
    const dayIdsBefore = new Map(getDays(program.id).map((day) => [day.shared_day_key, day.id]));
    const exerciseIdsBefore = new Map(getExercises(program.id).map((exercise) => [exercise.shared_exercise_key, exercise.id]));
    const secondVersion = repository.publishSharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      actingUserId: userId,
      snapshot: makeSnapshot({
        days: [
          {
            key: "upper",
            name: "Upper",
            exercises: [
              makeExercise({ key: "row", name: "Row", category: "aux" }),
              makeExercise({ key: "bench", name: "Bench Press", category: "aux" }),
            ],
          },
          { key: "lower", name: "Lower", exercises: [makeExercise({ key: "squat", name: "Squat" })] },
        ],
      }),
    });

    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: secondVersion.id,
      expectedMaxes: {},
    });

    expect(getDays(program.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: dayIdsBefore.get("upper"), shared_day_key: "upper", sort_order: 1 }),
        expect.objectContaining({ id: dayIdsBefore.get("lower"), shared_day_key: "lower", sort_order: 2 }),
      ]),
    );
    expect(getExercises(program.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: exerciseIdsBefore.get("row"), shared_exercise_key: "row", sort_order: 1 }),
        expect.objectContaining({ id: exerciseIdsBefore.get("bench"), shared_exercise_key: "bench", sort_order: 2 }),
      ]),
    );
  });

  it("archives removed exercises instead of hard-deleting them when session history exists", () => {
    const userId = createUser("archive@example.com");
    const sharedProgram = createSharedProgram(
      userId,
      makeSnapshot({
        days: [
          {
            key: "lower",
            name: "Lower",
            exercises: [
              makeExercise({ key: "squat", name: "Squat" }),
              makeExercise({ key: "curl", name: "Curl", category: "accessory" }),
            ],
          },
        ],
      }),
    );
    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: sharedProgram.activeVersionId!,
      expectedMaxes: { squat: 315, curl: 85 },
    });
    const program = getPrivateProgram(sharedProgram.id, userId)!;
    const curl = getExercises(program.id).find((exercise) => exercise.shared_exercise_key === "curl")!;
    const sessionId = createCompletedSession(program.id, userId, curl.id, sharedProgram.activeVersionId!);
    const nextVersion = repository.publishSharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      actingUserId: userId,
      snapshot: makeSnapshot({
        days: [
          {
            key: "lower",
            name: "Lower",
            exercises: [makeExercise({ key: "squat", name: "Squat" })],
          },
        ],
      }),
    });

    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: nextVersion.id,
      expectedMaxes: {},
    });

    const archivedCurl = getExercises(program.id).find((exercise) => exercise.shared_exercise_key === "curl");
    expect(archivedCurl).toEqual(expect.objectContaining({ id: curl.id }));
    expect(archivedCurl!.archived_at).toEqual(expect.any(String));
    expect(dbModule.db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId)).toEqual({ id: sessionId });
  });

  it("requires expected maxes for new exercises and keeps sync transactional when input is invalid", () => {
    const userId = createUser("invalid@example.com");
    const sharedProgram = createSharedProgram(userId, makeSnapshot());
    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: sharedProgram.activeVersionId!,
      expectedMaxes: { squat: 315 },
    });
    const program = getPrivateProgram(sharedProgram.id, userId)!;
    const nextVersion = repository.publishSharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      actingUserId: userId,
      snapshot: makeSnapshot({
        days: [
          {
            key: "lower",
            name: "Lower",
            exercises: [
              makeExercise({ key: "squat", name: "Squat" }),
              makeExercise({ key: "deadlift", name: "Deadlift" }),
            ],
          },
        ],
      }),
    });

    expect(() =>
      sync.applySharedProgramVersion({
        sharedProgramId: sharedProgram.id,
        userId,
        targetVersionId: nextVersion.id,
        expectedMaxes: { deadlift: 0 },
      }),
    ).toThrow("Expected max is required for deadlift");

    expect(getPrivateProgram(sharedProgram.id, userId)).toEqual(
      expect.objectContaining({ id: program.id, shared_program_version_id: sharedProgram.activeVersionId }),
    );
    expect(getExercises(program.id).map((exercise) => exercise.shared_exercise_key)).toEqual(["squat"]);
    expect(
      dbModule.db
        .prepare("SELECT COUNT(*) AS count FROM shared_program_applied_versions WHERE version_id = ?")
        .get(nextVersion.id),
    ).toEqual({ count: 0 });
  });

  it("returns expected max gauges including other members' maxes", () => {
    const ownerUserId = createUser("gauge-owner@example.com");
    const memberUserId = createUser("gauge-member@example.com");
    const sharedProgram = createSharedProgram(ownerUserId, makeSnapshot());
    repository.addSharedProgramMember({
      sharedProgramId: sharedProgram.id,
      actingUserId: ownerUserId,
      targetUserId: memberUserId,
      role: "member",
    });
    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId: ownerUserId,
      targetVersionId: sharedProgram.activeVersionId!,
      expectedMaxes: { squat: 315 },
    });
    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId: memberUserId,
      targetVersionId: sharedProgram.activeVersionId!,
      expectedMaxes: { squat: 335 },
    });

    expect(
      sync.getExpectedMaxGauge({
        sharedProgramId: sharedProgram.id,
        sharedExerciseKey: "squat",
        userId: ownerUserId,
      }),
    ).toEqual({
      sharedExerciseKey: "squat",
      currentUserMax: 315,
      memberMaxes: [
        { userId: ownerUserId, expectedMax: 315, isCurrentUser: true },
        { userId: memberUserId, expectedMax: 335, isCurrentUser: false },
      ],
    });
  });

  it("rolls back to an earlier version and records rollback action", () => {
    const userId = createUser("rollback@example.com");
    const sharedProgram = createSharedProgram(userId, makeSnapshot());
    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: sharedProgram.activeVersionId!,
      expectedMaxes: { squat: 315 },
    });
    const firstVersionId = sharedProgram.activeVersionId!;
    const secondVersion = repository.publishSharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      actingUserId: userId,
      snapshot: makeSnapshot({
        days: [
          {
            key: "lower",
            name: "Lower",
            exercises: [
              makeExercise({ key: "squat", name: "Squat" }),
              makeExercise({ key: "bench", name: "Bench Press", category: "aux" }),
            ],
          },
        ],
      }),
    });
    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: secondVersion.id,
      expectedMaxes: { bench: 225 },
    });
    const program = getPrivateProgram(sharedProgram.id, userId)!;

    sync.rollbackSharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: firstVersionId,
      expectedMaxes: {},
    });

    expect(getPrivateProgram(sharedProgram.id, userId)).toEqual(
      expect.objectContaining({ id: program.id, shared_program_version_id: firstVersionId }),
    );
    expect(getExercises(program.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ shared_exercise_key: "squat", archived_at: null }),
        expect.objectContaining({ shared_exercise_key: "bench", archived_at: expect.any(String) }),
      ]),
    );
    expect(
      dbModule.db
        .prepare("SELECT action, version_id FROM shared_program_applied_versions ORDER BY id")
        .all(),
    ).toEqual([
      { action: "apply", version_id: firstVersionId },
      { action: "apply", version_id: secondVersion.id },
      { action: "rollback", version_id: firstVersionId },
    ]);
  });

  it("preserves historical sessions and shared version context during rollback", () => {
    const userId = createUser("rollback-history@example.com");
    const sharedProgram = createSharedProgram(userId, makeSnapshot());
    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: sharedProgram.activeVersionId!,
      expectedMaxes: { squat: 315 },
    });
    const firstVersionId = sharedProgram.activeVersionId!;
    const secondVersion = repository.publishSharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      actingUserId: userId,
      snapshot: makeSnapshot({ name: "Second Version" }),
    });
    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: secondVersion.id,
      expectedMaxes: {},
    });
    const program = getPrivateProgram(sharedProgram.id, userId)!;
    const squat = getExercises(program.id).find((exercise) => exercise.shared_exercise_key === "squat")!;
    const completedSessionId = createCompletedSession(program.id, userId, squat.id, secondVersion.id);
    const skippedSession = dbModule.db
      .prepare(
        `
          INSERT INTO sessions (
            program_id,
            user_id,
            day_id,
            week_number,
            status,
            skipped_at,
            skip_reason,
            shared_program_version_id,
            date
          ) VALUES (?, ?, ?, 2, 'skipped', datetime('now'), 'travel', ?, '2030-01-02')
        `,
      )
      .run(program.id, userId, squat.day_id, secondVersion.id);

    sync.rollbackSharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: firstVersionId,
      expectedMaxes: {},
    });

    expect(
      dbModule.db
        .prepare("SELECT id, completed, status, shared_program_version_id FROM sessions ORDER BY id")
        .all(),
    ).toEqual([
      { id: completedSessionId, completed: 1, status: "completed", shared_program_version_id: secondVersion.id },
      { id: Number(skippedSession.lastInsertRowid), completed: 0, status: "skipped", shared_program_version_id: secondVersion.id },
    ]);
    expect(dbModule.db.prepare("SELECT COUNT(*) AS count FROM session_sets").get()).toEqual({ count: 1 });
  });

  it("replaces live week settings when a changed setting already has session history", () => {
    const userId = createUser("replace-week-setting@example.com");
    const sharedProgram = createSharedProgram(
      userId,
      makeSnapshot({
        days: [
          {
            key: "lower",
            name: "Lower",
            exercises: [
              makeExercise({
                key: "squat",
                name: "Squat",
                weeks: [{ weekNumber: 1, intensityPct: 0.7, reps: 5, sets: 3, repOutTarget: 8 }],
              }),
            ],
          },
        ],
      }),
    );
    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: sharedProgram.activeVersionId!,
      expectedMaxes: { squat: 300 },
    });
    const program = getPrivateProgram(sharedProgram.id, userId)!;
    const originalSquat = getExercises(program.id).find((exercise) => exercise.shared_exercise_key === "squat")!;
    const originalWeekSetting = dbModule.db
      .prepare("SELECT id FROM week_settings WHERE exercise_id = ? AND week_number = 1")
      .get(originalSquat.id) as { id: number };
    const sessionId = createCompletedSession(program.id, userId, originalSquat.id, sharedProgram.activeVersionId!);
    const nextVersion = repository.publishSharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      actingUserId: userId,
      snapshot: makeSnapshot({
        days: [
          {
            key: "lower",
            name: "Lower",
            exercises: [
              makeExercise({
                key: "squat",
                name: "Squat",
                weeks: [{ weekNumber: 1, intensityPct: 0.8, reps: 3, sets: 5, repOutTarget: 6 }],
              }),
            ],
          },
        ],
      }),
    });

    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: nextVersion.id,
      expectedMaxes: {},
    });

    const squatRows = getExercises(program.id).filter((exercise) => exercise.shared_exercise_key === "squat");
    const archivedSquat = squatRows.find((exercise) => exercise.id === originalSquat.id);
    const liveSquat = squatRows.find((exercise) => exercise.archived_at === null);
    const historicalSet = dbModule.db
      .prepare(
        `
          SELECT ss.week_setting_id, ws.reps, ws.intensity_pct
          FROM session_sets ss
          INNER JOIN week_settings ws ON ws.id = ss.week_setting_id
          WHERE ss.session_id = ?
        `,
      )
      .get(sessionId);
    const liveWeekOne = dbModule.db
      .prepare("SELECT reps, sets, rep_out_target, intensity_pct FROM week_settings WHERE exercise_id = ? AND week_number = 1")
      .get(liveSquat?.id) as { reps: number; sets: number; rep_out_target: number; intensity_pct: number } | undefined;

    expect(archivedSquat!.archived_at).toEqual(expect.any(String));
    expect(liveSquat).toEqual(expect.objectContaining({ shared_exercise_key: "squat", archived_at: null }));
    expect(historicalSet).toEqual({ week_setting_id: originalWeekSetting.id, reps: 5, intensity_pct: 0.7 });
    expect(liveWeekOne).toEqual({ reps: 3, sets: 5, rep_out_target: 6, intensity_pct: 0.8 });
  });

  it("removes stale ramp sets when a synced exercise changes back to straight sets", () => {
    const userId = createUser("ramp-stale-cleanup@example.com");
    const sharedProgram = createSharedProgram(
      userId,
      makeSnapshot({
        numWeeks: 1,
        days: [
          {
            key: "lower",
            name: "Lower",
            exercises: [
              makeExercise({
                key: "squat",
                name: "Squat",
                weeks: [
                  {
                    weekNumber: 1,
                    intensityPct: 0.6,
                    reps: 5,
                    sets: 3,
                    repOutTarget: 10,
                    ramp: [
                      { setNumber: 1, intensityPct: 0.6, reps: 5, repOutTarget: 10 },
                      { setNumber: 2, intensityPct: 0.7, reps: 4, repOutTarget: 8 },
                      { setNumber: 3, intensityPct: 0.8, reps: 3, repOutTarget: 6 },
                    ],
                  },
                ],
              }),
            ],
          },
        ],
      }),
    );
    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: sharedProgram.activeVersionId!,
      expectedMaxes: { squat: 300 },
    });
    const nextVersion = repository.publishSharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      actingUserId: userId,
      snapshot: makeSnapshot({
        numWeeks: 1,
        days: [
          {
            key: "lower",
            name: "Lower",
            exercises: [
              makeExercise({
                key: "squat",
                name: "Squat",
                weeks: [{ weekNumber: 1, intensityPct: 0.75, reps: 5, sets: 4, repOutTarget: 8 }],
              }),
            ],
          },
        ],
      }),
    });

    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: nextVersion.id,
      expectedMaxes: {},
    });

    const program = getPrivateProgram(sharedProgram.id, userId)!;
    const squat = getExercises(program.id).find((exercise) => exercise.shared_exercise_key === "squat" && exercise.archived_at === null)!;
    expect(
      dbModule.db
        .prepare(
          "SELECT week_number, set_number, intensity_pct, reps, sets, rep_out_target FROM week_settings WHERE exercise_id = ? ORDER BY week_number, set_number",
        )
        .all(squat.id),
    ).toEqual([{ week_number: 1, set_number: 1, intensity_pct: 0.75, reps: 5, sets: 4, rep_out_target: 8 }]);
  });

  it("replaces ramp settings instead of mutating referenced historical set rows", () => {
    const userId = createUser("ramp-history-replace@example.com");
    const sharedProgram = createSharedProgram(
      userId,
      makeSnapshot({
        numWeeks: 1,
        days: [
          {
            key: "lower",
            name: "Lower",
            exercises: [
              makeExercise({
                key: "squat",
                name: "Squat",
                weeks: [
                  {
                    weekNumber: 1,
                    intensityPct: 0.7,
                    reps: 4,
                    sets: 1,
                    repOutTarget: 8,
                    ramp: [
                      { setNumber: 1, intensityPct: 0.6, reps: 5, repOutTarget: 10 },
                      { setNumber: 2, intensityPct: 0.7, reps: 4, repOutTarget: 8 },
                    ],
                  },
                ],
              }),
            ],
          },
        ],
      }),
    );
    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: sharedProgram.activeVersionId!,
      expectedMaxes: { squat: 300 },
    });
    const program = getPrivateProgram(sharedProgram.id, userId)!;
    const originalSquat = getExercises(program.id).find((exercise) => exercise.shared_exercise_key === "squat")!;
    const originalSetTwo = dbModule.db
      .prepare("SELECT id FROM week_settings WHERE exercise_id = ? AND week_number = 1 AND set_number = 2")
      .get(originalSquat.id) as { id: number };
    const session = dbModule.db
      .prepare(
        "INSERT INTO sessions (program_id, user_id, day_id, week_number, completed, status, shared_program_version_id, date) VALUES (?, ?, ?, 1, 1, 'completed', ?, '2030-01-03')",
      )
      .run(program.id, userId, originalSquat.day_id, sharedProgram.activeVersionId!);
    dbModule.db
      .prepare("INSERT INTO session_sets (session_id, week_setting_id, actual_reps, actual_weight) VALUES (?, ?, ?, ?)")
      .run(session.lastInsertRowid, originalSetTwo.id, 4, 210);
    const nextVersion = repository.publishSharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      actingUserId: userId,
      snapshot: makeSnapshot({
        numWeeks: 1,
        days: [
          {
            key: "lower",
            name: "Lower",
            exercises: [
              makeExercise({
                key: "squat",
                name: "Squat",
                weeks: [
                  {
                    weekNumber: 1,
                    intensityPct: 0.7,
                    reps: 4,
                    sets: 1,
                    repOutTarget: 8,
                    ramp: [
                      { setNumber: 1, intensityPct: 0.6, reps: 5, repOutTarget: 10 },
                      { setNumber: 2, intensityPct: 0.75, reps: 3, repOutTarget: 6 },
                    ],
                  },
                ],
              }),
            ],
          },
        ],
      }),
    });

    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: nextVersion.id,
      expectedMaxes: {},
    });

    const rows = getExercises(program.id).filter((exercise) => exercise.shared_exercise_key === "squat");
    const archivedSquat = rows.find((exercise) => exercise.id === originalSquat.id);
    const liveSquat = rows.find((exercise) => exercise.archived_at === null)!;
    expect(archivedSquat?.archived_at).toEqual(expect.any(String));
    expect(
      dbModule.db
        .prepare("SELECT intensity_pct, reps, rep_out_target FROM week_settings WHERE id = ?")
        .get(originalSetTwo.id),
    ).toEqual({ intensity_pct: 0.7, reps: 4, rep_out_target: 8 });
    expect(
      dbModule.db
        .prepare(
          "SELECT set_number, intensity_pct, reps, rep_out_target FROM week_settings WHERE exercise_id = ? ORDER BY set_number",
        )
        .all(liveSquat.id),
    ).toEqual([
      { set_number: 1, intensity_pct: 0.6, reps: 5, rep_out_target: 10 },
      { set_number: 2, intensity_pct: 0.75, reps: 3, rep_out_target: 6 },
    ]);
  });

  it("clamps the runnable cursor when applying a version with fewer weeks and days", () => {
    const userId = createUser("cursor-clamp@example.com");
    const sharedProgram = createSharedProgram(
      userId,
      makeSnapshot({
        numWeeks: 5,
        days: [
          { key: "lower", name: "Lower", exercises: [makeExercise({ key: "squat", name: "Squat" })] },
          { key: "upper", name: "Upper", exercises: [makeExercise({ key: "bench", name: "Bench", category: "aux" })] },
          { key: "arms", name: "Arms", exercises: [makeExercise({ key: "curl", name: "Curl", category: "accessory", progressionType: "custom" })] },
        ],
      }),
    );
    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: sharedProgram.activeVersionId!,
      expectedMaxes: { squat: 315, bench: 225, curl: 85 },
    });
    const program = getPrivateProgram(sharedProgram.id, userId)!;
    dbModule.db.prepare("UPDATE programs SET current_week = 5, current_day = 3 WHERE id = ?").run(program.id);
    dbModule.db
      .prepare("UPDATE program_runs SET current_week = 5, current_day = 3 WHERE id = (SELECT program_run_id FROM programs WHERE id = ?)")
      .run(program.id);
    const nextVersion = repository.publishSharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      actingUserId: userId,
      snapshot: makeSnapshot({
        numWeeks: 2,
        days: [{ key: "lower", name: "Lower", exercises: [makeExercise({ key: "squat", name: "Squat" })] }],
      }),
    });

    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: nextVersion.id,
      expectedMaxes: {},
    });

    expect(dbModule.db.prepare("SELECT current_week, current_day FROM programs WHERE id = ?").get(program.id)).toEqual({
      current_week: 2,
      current_day: 1,
    });
  });

  it("clamps canonical run progress when applying a smaller shared definition version", () => {
    const userId = createUser("run-cursor-clamp@example.com");
    const sharedProgram = createSharedProgram(
      userId,
      makeSnapshot({
        numWeeks: 5,
        days: [
          { key: "lower", name: "Lower", exercises: [makeExercise({ key: "squat", name: "Squat" })] },
          { key: "upper", name: "Upper", exercises: [makeExercise({ key: "bench", name: "Bench", category: "aux" })] },
          { key: "arms", name: "Arms", exercises: [makeExercise({ key: "curl", name: "Curl", category: "accessory", progressionType: "custom" })] },
        ],
      }),
    );
    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: sharedProgram.activeVersionId!,
      expectedMaxes: { squat: 315, bench: 225, curl: 85 },
    });
    const program = getPrivateProgram(sharedProgram.id, userId)!;
    dbModule.db
      .prepare("UPDATE program_runs SET current_week = 5, current_day = 3 WHERE id = (SELECT program_run_id FROM programs WHERE id = ?)")
      .run(program.id);
    dbModule.db.prepare("UPDATE programs SET current_week = 1, current_day = 1 WHERE id = ?").run(program.id);
    const nextVersion = repository.publishSharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      actingUserId: userId,
      snapshot: makeSnapshot({
        numWeeks: 2,
        days: [{ key: "lower", name: "Lower", exercises: [makeExercise({ key: "squat", name: "Squat" })] }],
      }),
    });

    sync.applySharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      userId,
      targetVersionId: nextVersion.id,
      expectedMaxes: {},
    });

    expect(
      dbModule.db
        .prepare("SELECT current_week, current_day FROM program_runs WHERE id = (SELECT program_run_id FROM programs WHERE id = ?)")
        .get(program.id),
    ).toEqual({ current_week: 2, current_day: 1 });
  });
});
