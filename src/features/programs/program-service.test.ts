import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

let dbModule: typeof import("@/lib/db");
let service: typeof import("./program-service");

function createUser(email: string): number {
  const result = dbModule.db
    .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
    .run(email, "hash");
  return Number(result.lastInsertRowid);
}

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workout-program-service-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  dbModule = await import("@/lib/db");
  service = await import("./program-service");
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
    DELETE FROM program_run_holds;
    DELETE FROM program_runs;
    DELETE FROM program_definition_week_settings;
    DELETE FROM program_definition_exercises;
    DELETE FROM program_definition_days;
    DELETE FROM program_definitions;
    DELETE FROM user_settings;
    DELETE FROM auth_sessions;
    DELETE FROM users;
  `);
});

describe("program service", () => {
  it("creates a custom definition and user run as the canonical program record", () => {
    const userId = createUser("service-create@example.com");

    const created = service.createProgramRun({
      userId,
      name: "Cutover Program",
      description: "Definition first",
      numWeeks: 4,
    });

    expect(created).toEqual({
      legacyProgramId: expect.any(Number),
      definitionId: expect.any(Number),
      runId: expect.any(Number),
    });
    expect(
      dbModule.db
        .prepare("SELECT owner_user_id, name, description, num_weeks, source_type, visibility FROM program_definitions")
        .get(),
    ).toEqual({
      owner_user_id: userId,
      name: "Cutover Program",
      description: "Definition first",
      num_weeks: 4,
      source_type: "custom",
      visibility: "private",
    });
    expect(
      dbModule.db
        .prepare(
          "SELECT user_id, program_definition_id, name, status, current_week, current_day, schedule_weekdays, schedule_mode FROM program_runs",
        )
        .get(),
    ).toEqual({
      user_id: userId,
      program_definition_id: created.definitionId,
      name: "Cutover Program",
      status: "active",
      current_week: 1,
      current_day: 1,
      schedule_weekdays: "[]",
      schedule_mode: "unscheduled",
    });
    expect(
      dbModule.db
        .prepare("SELECT program_definition_id, program_run_id, current_week, current_day FROM programs WHERE id = ?")
        .get(created.legacyProgramId),
    ).toEqual({
      program_definition_id: created.definitionId,
      program_run_id: created.runId,
      current_week: 1,
      current_day: 1,
    });
  });

  it("stores structural edits on definitions and run maxes while generating execution rows", () => {
    const userId = createUser("service-structure@example.com");
    const created = service.createProgramRun({ userId, name: "Definition Program", numWeeks: 3 });

    const day = service.addDefinitionDayForRun({
      userId,
      legacyProgramId: created.legacyProgramId,
      name: "Monday",
    });
    const exercise = service.addDefinitionExerciseForDay({
      userId,
      legacyDayId: day.legacyDayId,
      name: "Squat",
      trainingMax: 315,
      category: "main",
      progressionType: "sbs",
    });

    expect(
      dbModule.db
        .prepare(
          "SELECT program_definition_id, name, day_number, sort_order, stable_key FROM program_definition_days WHERE id = ?",
        )
        .get(day.definitionDayId),
    ).toEqual({
      program_definition_id: created.definitionId,
      name: "Monday",
      day_number: 1,
      sort_order: 1,
      stable_key: expect.any(String),
    });
    expect(
      dbModule.db
        .prepare(
          "SELECT program_definition_day_id, name, category, progression_type, stable_key FROM program_definition_exercises WHERE id = ?",
        )
        .get(exercise.definitionExerciseId),
    ).toEqual({
      program_definition_day_id: day.definitionDayId,
      name: "Squat",
      category: "main",
      progression_type: "sbs",
      stable_key: exercise.exerciseStableKey,
    });
    expect(
      dbModule.db
        .prepare("SELECT expected_max FROM program_run_expected_maxes WHERE program_run_id = ? AND shared_exercise_key = ?")
        .get(created.runId, exercise.exerciseStableKey),
    ).toEqual({ expected_max: 315 });
    expect(
      dbModule.db
        .prepare("SELECT shared_day_key FROM days WHERE id = ?")
        .get(day.legacyDayId),
    ).toEqual({ shared_day_key: day.dayStableKey });
    expect(
      dbModule.db
        .prepare("SELECT training_max, shared_exercise_key FROM exercises WHERE id = ?")
        .get(exercise.legacyExerciseId),
    ).toEqual({ training_max: 315, shared_exercise_key: exercise.exerciseStableKey });
    expect(
      dbModule.db
        .prepare("SELECT COUNT(*) AS count FROM program_definition_week_settings WHERE program_definition_exercise_id = ?")
        .get(exercise.definitionExerciseId),
    ).toEqual({ count: 15 });
    expect(
      dbModule.db
        .prepare("SELECT COUNT(*) AS count FROM week_settings WHERE exercise_id = ?")
        .get(exercise.legacyExerciseId),
    ).toEqual({ count: 15 });
  });

  it("updates schedule and progress only on the program run canonical state", () => {
    const userId = createUser("service-run-state@example.com");
    const created = service.createProgramRun({ userId, name: "Run State", numWeeks: 7 });

    service.updateProgramRun({
      userId,
      legacyProgramId: created.legacyProgramId,
      scheduleWeekdays: [1, 3, 5],
      currentWeek: 2,
      currentDay: 3,
      status: "paused",
    });

    expect(
      dbModule.db
        .prepare("SELECT current_week, current_day, status, schedule_weekdays, schedule_mode FROM program_runs WHERE id = ?")
        .get(created.runId),
    ).toEqual({
      current_week: 2,
      current_day: 3,
      status: "paused",
      schedule_weekdays: "[1,3,5]",
      schedule_mode: "scheduled",
    });
    expect(
      dbModule.db
        .prepare("SELECT weekday, definition_day_number FROM program_run_schedule_days WHERE program_run_id = ? ORDER BY weekday")
        .all(created.runId),
    ).toEqual([
      { weekday: 1, definition_day_number: 1 },
      { weekday: 3, definition_day_number: 2 },
      { weekday: 5, definition_day_number: 3 },
    ]);
  });

  it("re-materialises an exercise's week loading when its type changes", () => {
    const userId = createUser("service-change-type@example.com");
    const created = service.createProgramRun({ userId, name: "Type Change", numWeeks: 4 });
    const day = service.addDefinitionDayForRun({ userId, legacyProgramId: created.legacyProgramId, name: "Day" });
    const exercise = service.addDefinitionExerciseForDay({
      userId,
      legacyDayId: day.legacyDayId,
      name: "Press",
      trainingMax: 100,
      category: "main",
      progressionType: "sbs",
    });

    const countWeekSettings = () =>
      dbModule.db
        .prepare(
          "SELECT COUNT(*) AS n, COUNT(DISTINCT week_number) AS weeks FROM week_settings WHERE exercise_id = ?",
        )
        .get(exercise.legacyExerciseId) as { n: number; weeks: number };

    // sbs is materialised across all 4 program weeks.
    expect(countWeekSettings().weeks).toBe(4);

    service.updateDefinitionExerciseType({
      userId,
      legacyExerciseId: exercise.legacyExerciseId,
      category: "aux",
      progressionType: "linear",
    });

    // Both the legacy and definition rows reflect the new type.
    expect(
      dbModule.db
        .prepare("SELECT category, progression_type, auto_progression_enabled FROM exercises WHERE id = ?")
        .get(exercise.legacyExerciseId),
    ).toEqual({ category: "aux", progression_type: "linear", auto_progression_enabled: 1 });
    expect(
      dbModule.db
        .prepare("SELECT category, progression_type FROM program_definition_exercises WHERE id = ?")
        .get(exercise.definitionExerciseId),
    ).toEqual({ category: "aux", progression_type: "linear" });

    // Week loading is rebuilt from the new template: linear aux = 3 flat sets × 4 weeks.
    expect(countWeekSettings()).toEqual({ n: 12, weeks: 4 });
  });

  it("materialises a bodyweight exercise as N individual sets of the given reps", () => {
    const userId = createUser("service-bodyweight@example.com");
    const created = service.createProgramRun({ userId, name: "BW", numWeeks: 4 });
    const day = service.addDefinitionDayForRun({ userId, legacyProgramId: created.legacyProgramId, name: "Day" });
    const exercise = service.addDefinitionExerciseForDay({
      userId,
      legacyDayId: day.legacyDayId,
      name: "Pull-Up",
      trainingMax: 1,
      category: "accessory",
      progressionType: "bodyweight",
      setCount: 3,
      repCount: 12,
    });

    const week1 = dbModule.db
      .prepare(
        "SELECT set_number, sets, reps, rep_out_target FROM week_settings WHERE exercise_id = ? AND week_number = 1 ORDER BY set_number",
      )
      .all(exercise.legacyExerciseId);
    expect(week1).toEqual([
      { set_number: 1, sets: 1, reps: 12, rep_out_target: 12 },
      { set_number: 2, sets: 1, reps: 12, rep_out_target: 12 },
      { set_number: 3, sets: 1, reps: 12, rep_out_target: 12 },
    ]);
  });

  it("materialises a manual (custom) exercise at full intensity so weight equals the entered number", () => {
    const userId = createUser("service-manual@example.com");
    const created = service.createProgramRun({ userId, name: "Manual", numWeeks: 4 });
    const day = service.addDefinitionDayForRun({ userId, legacyProgramId: created.legacyProgramId, name: "Day" });
    service.addDefinitionExerciseForDay({
      userId,
      legacyDayId: day.legacyDayId,
      name: "Press",
      trainingMax: 135,
      category: "accessory",
      progressionType: "custom",
    });

    const detail = service.getProgramDetailForUser(created.legacyProgramId, userId);
    const press = detail!.days[0].exercises.find((exercise) => exercise.name === "Press")!;
    // No 0.7 scaling: a manual lift's weight is the number entered, every week.
    expect(press.weekSettings.length).toBeGreaterThan(0);
    expect(press.weekSettings.every((week) => week.calculated_weight === 135)).toBe(true);
  });

  it("creates and cancels dated holds for one owned run", () => {
    const userId = createUser("service-hold@example.com");
    const first = service.createProgramRun({ userId, name: "Rack Program", numWeeks: 7 });
    const second = service.createProgramRun({ userId, name: "Stretching", numWeeks: 7 });

    const hold = service.createProgramRunHold({
      userId,
      legacyProgramId: first.legacyProgramId,
      startDate: "2026-06-08",
      endDate: "2026-06-21",
      reason: "Vacation",
    });

    expect(hold).toEqual({
      id: expect.any(Number),
      program_run_id: first.runId,
      user_id: userId,
      start_date: "2026-06-08",
      end_date: "2026-06-21",
      reason: "Vacation",
      canceled_at: null,
    });
    expect(
      service.isDateHeldForRun(
        service.getProgramRunHoldsForRange({ userId, startDate: "2026-06-01", endDate: "2026-06-30" }),
        first.runId,
        "2026-06-15",
      ),
    ).toBe(true);
    expect(
      service.isDateHeldForRun(
        service.getProgramRunHoldsForRange({ userId, startDate: "2026-06-01", endDate: "2026-06-30" }),
        second.runId,
        "2026-06-15",
      ),
    ).toBe(false);

    expect(
      service.cancelActiveProgramRunHold({
        userId,
        legacyProgramId: first.legacyProgramId,
        today: new Date("2026-06-09T12:00:00-07:00"),
      }),
    ).toBe(true);
    expect(
      service.getProgramRunHoldsForRange({ userId, startDate: "2026-06-01", endDate: "2026-06-30" }),
    ).toEqual([]);
  });

  it("does not show held scheduled workouts on Today", () => {
    const userId = createUser("service-today-held@example.com");
    const created = service.createProgramRun({ userId, name: "Held Strength", numWeeks: 4 });
    const day = service.addDefinitionDayForRun({ userId, legacyProgramId: created.legacyProgramId, name: "Lower" });
    service.addDefinitionExerciseForDay({
      userId,
      legacyDayId: day.legacyDayId,
      name: "Squat",
      trainingMax: 200,
      category: "main",
      progressionType: "linear",
    });
    service.updateProgramRun({
      userId,
      legacyProgramId: created.legacyProgramId,
      scheduleWeekdays: [1],
    });
    service.createProgramRunHold({
      userId,
      legacyProgramId: created.legacyProgramId,
      startDate: "2026-06-01",
      endDate: "2026-06-14",
    });

    const dashboard = service.getTodayWorkoutDashboard(userId, new Date("2026-06-01T12:00:00-07:00"));

    expect(dashboard.scheduledToday).toEqual([]);
  });

  it("does not shift the schedule across a pause — each weekday keeps its own workout", () => {
    const userId = createUser("service-hold-noshift@example.com");
    const created = service.createProgramRun({ userId, name: "No Shift", numWeeks: 4 });
    // 3 days, scheduled Mon/Tue/Wed → Day 1 = Mon, Day 2 = Tue, Day 3 = Wed.
    for (const name of ["Mon Day", "Tue Day", "Wed Day"]) {
      const day = service.addDefinitionDayForRun({ userId, legacyProgramId: created.legacyProgramId, name });
      service.addDefinitionExerciseForDay({
        userId,
        legacyDayId: day.legacyDayId,
        name: `${name} Squat`,
        trainingMax: 200,
        category: "main",
        progressionType: "linear",
      });
    }
    service.updateProgramRun({ userId, legacyProgramId: created.legacyProgramId, scheduleWeekdays: [1, 2, 3] });

    // Pause Monday only (2026-06-01 is a Monday).
    service.createProgramRunHold({
      userId,
      legacyProgramId: created.legacyProgramId,
      startDate: "2026-06-01",
      endDate: "2026-06-01",
    });

    // Monday's workout is suppressed (paused) and not nagged as missed.
    const monday = service.getTodayWorkoutDashboard(userId, new Date("2026-06-01T12:00:00-07:00"));
    expect(monday.scheduledToday).toEqual([]);

    // Tuesday shows TUESDAY's workout (Day 2), at the SAME week — Monday's Day 1
    // does NOT shift onto Tuesday, and Monday isn't counted as missed.
    const tuesday = service.getTodayWorkoutDashboard(userId, new Date("2026-06-02T12:00:00-07:00"));
    expect(tuesday.scheduledToday).toHaveLength(1);
    expect(tuesday.scheduledToday[0].day_number).toBe(2);
    expect(tuesday.scheduledToday[0].day_name).toBe("Tue Day");
    expect(tuesday.scheduledToday[0].current_week).toBe(1);
    expect(tuesday.missedWorkouts).toEqual([]);
  });

  it("derives the Today week from the schedule start date, not the completion counter", () => {
    const userId = createUser("service-today-startdate@example.com");
    const created = service.createProgramRun({ userId, name: "Backdated", numWeeks: 7 });
    const day = service.addDefinitionDayForRun({ userId, legacyProgramId: created.legacyProgramId, name: "Mon Day" });
    service.addDefinitionExerciseForDay({
      userId,
      legacyDayId: day.legacyDayId,
      name: "Squat",
      trainingMax: 200,
      category: "main",
      progressionType: "linear",
    });
    service.updateProgramRun({ userId, legacyProgramId: created.legacyProgramId, scheduleWeekdays: [1] });
    // Backdate the start 5 weeks; current_week (the completion counter) stays 1.
    service.updateProgramRun({ userId, legacyProgramId: created.legacyProgramId, startDate: "2026-05-04" });

    // 2026-06-08 is the Monday 5 weeks after the start → Today shows week 6, in
    // step with the calendar, even though current_week was never advanced.
    const dashboard = service.getTodayWorkoutDashboard(userId, new Date("2026-06-08T12:00:00-07:00"));
    expect(dashboard.scheduledToday).toHaveLength(1);
    expect(dashboard.scheduledToday[0].current_week).toBe(6);
  });

  it("stops surfacing scheduled workouts once the program has run past its final week", () => {
    const userId = createUser("service-today-complete@example.com");
    const created = service.createProgramRun({ userId, name: "Finished", numWeeks: 7 });
    const day = service.addDefinitionDayForRun({ userId, legacyProgramId: created.legacyProgramId, name: "Mon Day" });
    service.addDefinitionExerciseForDay({
      userId,
      legacyDayId: day.legacyDayId,
      name: "Squat",
      trainingMax: 200,
      category: "main",
      progressionType: "linear",
    });
    service.updateProgramRun({ userId, legacyProgramId: created.legacyProgramId, scheduleWeekdays: [1] });
    // Start 2026-05-04 (a Monday). Week 7's Monday is 2026-06-15; the program ends
    // after that week. current_week (completion counter) stays 1.
    service.updateProgramRun({ userId, legacyProgramId: created.legacyProgramId, startDate: "2026-05-04" });

    // 2026-06-15 is the week-7 Monday → still shows.
    const week7 = service.getTodayWorkoutDashboard(userId, new Date("2026-06-15T12:00:00-07:00"));
    expect(week7.scheduledToday).toHaveLength(1);
    expect(week7.scheduledToday[0].current_week).toBe(7);

    // 2026-06-22 is the Monday AFTER the program's last week → no workout, and
    // it is not nagged as missed. The program is complete.
    const after = service.getTodayWorkoutDashboard(userId, new Date("2026-06-22T12:00:00-07:00"));
    expect(after.scheduledToday).toEqual([]);
    expect(after.missedWorkouts).toEqual([]);
  });

  it("builds a Today dashboard with scheduled workout preview and last session", () => {
    const userId = createUser("service-today@example.com");
    const created = service.createProgramRun({ userId, name: "Dashboard Strength", numWeeks: 4 });
    const day = service.addDefinitionDayForRun({ userId, legacyProgramId: created.legacyProgramId, name: "Lower" });
    service.addDefinitionExerciseForDay({
      userId,
      legacyDayId: day.legacyDayId,
      name: "Squat",
      trainingMax: 200,
      category: "main",
      progressionType: "linear",
    });
    service.updateProgramRun({
      userId,
      legacyProgramId: created.legacyProgramId,
      scheduleWeekdays: [1, 3, 5],
    });
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
          ) VALUES (?, ?, ?, ?, ?, ?, 'Dashboard Strength', 'Lower', 1, '2026-05-29', 'completed', 1)
        `,
      )
      .run(created.legacyProgramId, userId, day.legacyDayId, created.definitionId, day.definitionDayId, created.runId);

    const dashboard = service.getTodayWorkoutDashboard(userId, new Date("2026-06-01T12:00:00-07:00"));

    expect(dashboard.scheduledToday).toEqual([
      expect.objectContaining({
        program_id: created.legacyProgramId,
        program_name: "Dashboard Strength",
        day_name: "Lower",
        schedule_label: "Mon",
        last_session_date: "2026-05-29",
        next_lifts: [
          {
            name: "Squat",
            set_count: 3,
            reps: 5,
            weight: 200,
            bodyweight: false,
          },
        ],
      }),
    ]);
    expect(dashboard.otherActiveRuns).toEqual([]);
    expect(dashboard.missedWorkouts).toEqual([]);
  });

  it("marks today's scheduled workout completed after the user logs it", () => {
    const userId = createUser("service-today-complete@example.com");
    const created = service.createProgramRun({ userId, name: "Completed Today", numWeeks: 4 });
    const day = service.addDefinitionDayForRun({ userId, legacyProgramId: created.legacyProgramId, name: "Lower" });
    service.addDefinitionExerciseForDay({
      userId,
      legacyDayId: day.legacyDayId,
      name: "Squat",
      trainingMax: 200,
      category: "main",
      progressionType: "linear",
    });
    service.updateProgramRun({
      userId,
      legacyProgramId: created.legacyProgramId,
      scheduleWeekdays: [1],
    });
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
          ) VALUES (?, ?, ?, ?, ?, ?, 'Completed Today', 'Lower', 1, '2026-06-01', 'completed', 1)
        `,
      )
      .run(created.legacyProgramId, userId, day.legacyDayId, created.definitionId, day.definitionDayId, created.runId);

    const dashboard = service.getTodayWorkoutDashboard(userId, new Date("2026-06-01T12:00:00-07:00"));

    expect(dashboard.scheduledToday).toEqual([
      expect.objectContaining({
        program_name: "Completed Today",
        today_session_status: "completed",
      }),
    ]);
  });

  it("shows recent missed scheduled workouts until the user logs them later", () => {
    const userId = createUser("service-missed@example.com");
    const created = service.createProgramRun({ userId, name: "Catch Up Strength", numWeeks: 4 });
    const day = service.addDefinitionDayForRun({ userId, legacyProgramId: created.legacyProgramId, name: "Lower" });
    service.addDefinitionExerciseForDay({
      userId,
      legacyDayId: day.legacyDayId,
      name: "Squat",
      trainingMax: 200,
      category: "main",
      progressionType: "linear",
    });
    service.updateProgramRun({
      userId,
      legacyProgramId: created.legacyProgramId,
      scheduleWeekdays: [5],
    });

    const missed = service.getTodayWorkoutDashboard(userId, new Date("2026-05-31T12:00:00-07:00"));

    expect(missed.missedWorkouts).toEqual([
      expect.objectContaining({
        program_id: created.legacyProgramId,
        program_name: "Catch Up Strength",
        day_name: "Lower",
        schedule_label: "Missed Fri",
        scheduled_date: "2026-05-29",
      }),
    ]);

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
          ) VALUES (?, ?, ?, ?, ?, ?, 'Catch Up Strength', 'Lower', 1, '2026-05-31', 'completed', 1)
        `,
      )
      .run(created.legacyProgramId, userId, day.legacyDayId, created.definitionId, day.definitionDayId, created.runId);

    const caughtUp = service.getTodayWorkoutDashboard(userId, new Date("2026-05-31T12:00:00-07:00"));

    expect(caughtUp.missedWorkouts).toEqual([]);
  });

  it("builds program library buckets from run and definition state", () => {
    const userId = createUser("service-library@example.com");
    const active = service.createProgramRun({ userId, name: "Active Run", numWeeks: 4 });
    const paused = service.createProgramRun({ userId, name: "Library Definition", numWeeks: 4 });
    service.updateProgramRun({ userId, legacyProgramId: paused.legacyProgramId, status: "paused" });

    const library = service.getProgramLibrary(userId);

    expect(library.activeRuns.map((program) => program.id)).toEqual([active.legacyProgramId]);
    expect(library.activeRuns[0].is_active).toBe(1);
    expect(library.definitions.map((program) => program.name)).toContain("Library Definition");
  });

  it("returns the latest training max per lift name across a user's runs", () => {
    const userId = createUser("service-latest-tm@example.com");

    function seedDay(definitionId: number, key: string): number {
      return Number(
        dbModule.db
          .prepare(
            "INSERT INTO program_definition_days (program_definition_id, name, day_number, sort_order, stable_key) VALUES (?, 'Day', 1, 1, ?)",
          )
          .run(definitionId, `day-${key}`).lastInsertRowid,
      );
    }

    function seedExercise(
      dayId: number,
      runId: number,
      name: string,
      key: string,
      sortOrder: number,
      expectedMax: number,
      updatedAt: string,
    ) {
      dbModule.db
        .prepare(
          "INSERT INTO program_definition_exercises (program_definition_day_id, name, category, progression_type, sort_order, stable_key) VALUES (?, ?, 'main', 'sbs', ?, ?)",
        )
        .run(dayId, name, sortOrder, key);
      dbModule.db
        .prepare(
          "INSERT INTO program_run_expected_maxes (program_run_id, shared_exercise_key, expected_max, updated_at) VALUES (?, ?, ?, ?)",
        )
        .run(runId, key, expectedMax, updatedAt);
    }

    const older = service.createProgramRun({ userId, name: "Cycle 1", numWeeks: 7 });
    const olderDay = seedDay(older.definitionId, "old");
    seedExercise(olderDay, older.runId, "Bench Press", "ex-bench-old", 1, 200, "2026-01-01 00:00:00");

    const newer = service.createProgramRun({ userId, name: "Cycle 2", numWeeks: 7 });
    const newerDay = seedDay(newer.definitionId, "new");
    seedExercise(newerDay, newer.runId, "Bench Press", "ex-bench-new", 1, 245, "2026-02-01 00:00:00");
    seedExercise(newerDay, newer.runId, "Squat", "ex-squat-new", 2, 315, "2026-02-01 00:00:00");

    const result = service.getLatestTrainingMaxes(userId);

    // Bench Press resolves to the most-recent run's value (245), not the older 200.
    expect(result).toContainEqual({ name: "Bench Press", trainingMax: 245 });
    expect(result).toContainEqual({ name: "Squat", trainingMax: 315 });
    expect(result.filter((max) => max.name === "Bench Press")).toHaveLength(1);
  });
});
