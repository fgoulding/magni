import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isValidElement, type ReactNode } from "react";
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
let auth: typeof import("@/lib/auth");
let calendarPage: typeof import("./page");

function collectRenderedText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return String(node);
  if (Array.isArray(node)) return node.map(collectRenderedText).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) return collectRenderedText(node.props.children);
  return "";
}

function collectWorkoutStartLabels(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return [];
  if (Array.isArray(node)) return node.flatMap(collectWorkoutStartLabels);
  if (isValidElement<{ children?: ReactNode; startLabel?: unknown }>(node)) {
    const labels = typeof node.props.startLabel === "string" ? [node.props.startLabel] : [];
    return [...labels, ...collectWorkoutStartLabels(node.props.children)];
  }
  return [];
}

function collectLinks(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return [];
  if (Array.isArray(node)) return node.flatMap(collectLinks);
  if (isValidElement<{ children?: ReactNode; href?: unknown }>(node)) {
    const hrefs = typeof node.props.href === "string" ? [node.props.href] : [];
    return [...hrefs, ...collectLinks(node.props.children)];
  }
  return [];
}

function collectAriaLabels(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return [];
  if (Array.isArray(node)) return node.flatMap(collectAriaLabels);
  if (isValidElement<{ children?: ReactNode; "aria-label"?: unknown }>(node)) {
    const labels = typeof node.props["aria-label"] === "string" ? [node.props["aria-label"]] : [];
    return [...labels, ...collectAriaLabels(node.props.children)];
  }
  return [];
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

function createScheduledProgram(
  userId: number,
  { numWeeks = 4, scheduleWeekdays = "[1,3]" }: { numWeeks?: number; scheduleWeekdays?: string } = {},
): { programId: number; runId: number; lowerDayId: number; upperDayId: number } {
  const definition = dbModule.db
    .prepare(
      "INSERT INTO program_definitions (owner_user_id, name, num_weeks, source_type) VALUES (?, 'Shared Strength', ?, 'custom')",
    )
    .run(userId, numWeeks);
  const run = dbModule.db
    .prepare(
      `
        INSERT INTO program_runs (
          user_id,
          program_definition_id,
          name,
          status,
          schedule_weekdays,
          schedule_mode,
          start_date
        ) VALUES (?, ?, 'Shared Strength', 'active', ?, 'scheduled', '2026-06-01')
      `,
    )
    .run(userId, definition.lastInsertRowid, scheduleWeekdays);
  const program = dbModule.db
    .prepare(
      `
        INSERT INTO programs (
          user_id,
          name,
          is_active,
          schedule_weekdays,
          schedule_mode,
          program_definition_id,
          program_run_id
        ) VALUES (?, 'Shared Strength', 1, ?, 'scheduled', ?, ?)
      `,
    )
    .run(userId, scheduleWeekdays, definition.lastInsertRowid, run.lastInsertRowid);
  dbModule.db
    .prepare(
      "INSERT INTO program_definition_days (program_definition_id, name, day_number, sort_order, stable_key) VALUES (?, 'Lower', 1, 1, 'lower')",
    )
    .run(definition.lastInsertRowid);
  dbModule.db
    .prepare(
      "INSERT INTO program_definition_days (program_definition_id, name, day_number, sort_order, stable_key) VALUES (?, 'Upper', 2, 2, 'upper')",
    )
    .run(definition.lastInsertRowid);
  const lower = dbModule.db
    .prepare("INSERT INTO days (program_id, name, day_number, sort_order, shared_day_key) VALUES (?, 'Lower', 1, 1, 'lower')")
    .run(program.lastInsertRowid);
  const upper = dbModule.db
    .prepare("INSERT INTO days (program_id, name, day_number, sort_order, shared_day_key) VALUES (?, 'Upper', 2, 2, 'upper')")
    .run(program.lastInsertRowid);
  const definitionExercise = dbModule.db
    .prepare(
      "INSERT INTO program_definition_exercises (program_definition_day_id, name, category, progression_type, stable_key) VALUES ((SELECT id FROM program_definition_days WHERE program_definition_id = ? AND day_number = 1), 'Squat', 'main', 'linear', 'squat')",
    )
    .run(definition.lastInsertRowid);
  dbModule.db
    .prepare(
      "INSERT INTO program_definition_week_settings (program_definition_exercise_id, week_number, set_number, intensity_pct, reps, sets, rep_out_target) VALUES (?, 1, 1, 1, 5, 1, 5), (?, 1, 2, 1, 5, 1, 5), (?, 1, 3, 1, 5, 1, 5)",
    )
    .run(definitionExercise.lastInsertRowid, definitionExercise.lastInsertRowid, definitionExercise.lastInsertRowid);
  dbModule.db
    .prepare("INSERT INTO program_run_expected_maxes (program_run_id, shared_exercise_key, expected_max) VALUES (?, 'squat', 200)")
    .run(run.lastInsertRowid);

  return {
    programId: Number(program.lastInsertRowid),
    runId: Number(run.lastInsertRowid),
    lowerDayId: Number(lower.lastInsertRowid),
    upperDayId: Number(upper.lastInsertRowid),
  };
}

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workout-calendar-page-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  dbModule = await import("@/lib/db");
  auth = await import("@/lib/auth");
  calendarPage = await import("./page");
});

beforeEach(() => {
  cookieMock.store.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
  dbModule.db.exec(
    "DELETE FROM session_sets; DELETE FROM sessions; DELETE FROM week_settings; DELETE FROM exercises; DELETE FROM days; DELETE FROM programs; DELETE FROM program_definition_week_settings; DELETE FROM program_definition_exercises; DELETE FROM program_definition_days; DELETE FROM program_run_holds; DELETE FROM program_runs; DELETE FROM program_definitions; DELETE FROM exercise_max_history; DELETE FROM shared_program_applied_versions; DELETE FROM shared_program_expected_maxes; UPDATE shared_programs SET active_version_id = NULL; DELETE FROM shared_program_versions; DELETE FROM shared_program_members; DELETE FROM shared_programs; DELETE FROM user_settings; DELETE FROM auth_sessions; DELETE FROM users;",
  );
});

describe("CalendarPage", () => {
  it("renders completed session history and future workouts for active scheduled programs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00-07:00"));
    const userId = createUser("calendar@example.com");
    authenticate(userId);
    const program = createScheduledProgram(userId);
    dbModule.db
      .prepare(
        `
          INSERT INTO sessions (
            program_id,
            user_id,
            day_id,
            week_number,
            completed,
            status,
            completed_at,
            date,
            program_name,
            day_name
          ) VALUES (?, ?, ?, 1, 1, 'completed', datetime('now'), '2026-06-02', 'Shared Strength', 'Lower')
        `,
      )
      .run(program.programId, userId, program.lowerDayId);

    const rendered = await calendarPage.default({
      searchParams: Promise.resolve({ month: "2026-06" }),
    });
    const text = collectRenderedText(rendered);

    expect(text).toContain("June 2026");
    expect(text).toContain("Mon");
    expect(text).toContain("Wed");
    expect(text).not.toContain("Completed: Shared Strength - Lower");
    expect(text).not.toContain("Scheduled: Shared Strength - Upper");
    expect(text).not.toContain("This month");
    expect(collectAriaLabels(rendered)).toEqual(
      expect.arrayContaining([
        "Completed: Shared Strength - Lower on 2026-06-02",
        "Scheduled: Shared Strength - Upper on 2026-06-03",
      ]),
    );
    expect(collectLinks(rendered)).toContain(`/calendar?month=2026-06&workout=scheduled-${program.programId}-${program.upperDayId}-2026-06-03`);
  });

  it("does not project archived or inactive programs into future dates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00-07:00"));
    const userId = createUser("calendar-inactive@example.com");
    authenticate(userId);
    const inactive = createScheduledProgram(userId);
    dbModule.db
      .prepare("UPDATE program_runs SET status = 'paused' WHERE id = (SELECT program_run_id FROM programs WHERE id = ?)")
      .run(inactive.programId);
    const archived = createScheduledProgram(userId);
    dbModule.db
      .prepare("UPDATE program_runs SET archived_at = datetime('now') WHERE id = (SELECT program_run_id FROM programs WHERE id = ?)")
      .run(archived.programId);

    const rendered = await calendarPage.default({
      searchParams: Promise.resolve({ month: "2026-06" }),
    });
    const text = collectRenderedText(rendered);

    expect(text).toContain("No workouts on this calendar yet.");
    expect(text).not.toContain("Scheduled");
  });

  it("does not render scheduled workouts before a run start date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00-07:00"));
    const userId = createUser("calendar-start-date@example.com");
    authenticate(userId);
    const program = createScheduledProgram(userId);

    const rendered = await calendarPage.default({
      searchParams: Promise.resolve({
        month: "2026-05",
        train: `scheduled-${program.programId}-${program.lowerDayId}-2026-05-26`,
      }),
    });
    const text = collectRenderedText(rendered);
    const startLabels = collectWorkoutStartLabels(rendered);

    expect(text).toContain("May 2026");
    expect(text).toContain("No workouts on this calendar yet.");
    expect(text).not.toContain("Scheduled: Shared Strength");
    expect(text).not.toContain("Run from calendar");
    expect(startLabels).not.toContain("Train today");
  });

  it("does not project scheduled workouts after the fixed program length", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00-07:00"));
    const userId = createUser("calendar-fixed-length@example.com");
    authenticate(userId);
    createScheduledProgram(userId, { numWeeks: 4 });

    const rendered = await calendarPage.default({
      searchParams: Promise.resolve({ month: "2026-09" }),
    });
    const text = collectRenderedText(rendered);

    expect(text).toContain("September 2026");
    expect(text).toContain("No workouts on this calendar yet.");
    expect(text).not.toContain("Scheduled: Shared Strength");
  });

  it("compresses fixed-length programs across extra selected weekdays", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00-07:00"));
    const userId = createUser("calendar-compressed-length@example.com");
    authenticate(userId);
    const program = createScheduledProgram(userId, { numWeeks: 2, scheduleWeekdays: "[1,3,5]" });

    const rendered = await calendarPage.default({
      searchParams: Promise.resolve({ month: "2026-06" }),
    });
    const text = collectRenderedText(rendered);
    const links = collectLinks(rendered);

    expect(text).not.toContain("Scheduled: Shared Strength - Lower");
    expect(text).not.toContain("Scheduled: Shared Strength - Upper");
    expect(links).toContain(`/calendar?month=2026-06&workout=scheduled-${program.programId}-${program.lowerDayId}-2026-06-01`);
    expect(links).toContain(`/calendar?month=2026-06&workout=scheduled-${program.programId}-${program.upperDayId}-2026-06-03`);
    expect(links).toContain(`/calendar?month=2026-06&workout=scheduled-${program.programId}-${program.lowerDayId}-2026-06-05`);
    expect(links).toContain(`/calendar?month=2026-06&workout=scheduled-${program.programId}-${program.upperDayId}-2026-06-08`);
    expect(links).not.toContain(`/calendar?month=2026-06&workout=scheduled-${program.programId}-${program.lowerDayId}-2026-06-10`);
  });

  it("shifts only the held run across hold dates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00-07:00"));
    const userId = createUser("calendar-held-run@example.com");
    authenticate(userId);
    const heldProgram = createScheduledProgram(userId, { numWeeks: 1, scheduleWeekdays: "[1,3]" });
    const movingProgram = createScheduledProgram(userId, { numWeeks: 1, scheduleWeekdays: "[1,3]" });
    dbModule.db
      .prepare(
        "INSERT INTO program_run_holds (program_run_id, user_id, start_date, end_date, reason) VALUES (?, ?, '2026-06-03', '2026-06-08', 'No rack')",
      )
      .run(heldProgram.runId, userId);

    const rendered = await calendarPage.default({
      searchParams: Promise.resolve({ month: "2026-06" }),
    });
    const links = collectLinks(rendered);

    expect(links).toContain(`/calendar?month=2026-06&workout=scheduled-${heldProgram.programId}-${heldProgram.lowerDayId}-2026-06-01`);
    expect(links).not.toContain(`/calendar?month=2026-06&workout=scheduled-${heldProgram.programId}-${heldProgram.upperDayId}-2026-06-03`);
    expect(links).not.toContain(`/calendar?month=2026-06&workout=scheduled-${heldProgram.programId}-${heldProgram.upperDayId}-2026-06-08`);
    expect(links).toContain(`/calendar?month=2026-06&workout=scheduled-${heldProgram.programId}-${heldProgram.upperDayId}-2026-06-10`);
    expect(links).toContain(`/calendar?month=2026-06&workout=scheduled-${movingProgram.programId}-${movingProgram.upperDayId}-2026-06-03`);
  });

  it("does not duplicate a scheduled workout after it is already logged today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T12:00:00-07:00"));
    const userId = createUser("calendar-dedup@example.com");
    authenticate(userId);
    const program = createScheduledProgram(userId);
    const session = dbModule.db
      .prepare(
        `
          INSERT INTO sessions (
            program_id,
            user_id,
            day_id,
            program_definition_day_id,
            week_number,
            completed,
            status,
            completed_at,
            date,
            program_name,
            day_name
          ) VALUES (?, ?, ?, (SELECT id FROM program_definition_days WHERE program_definition_id = (SELECT program_definition_id FROM programs WHERE id = ?) AND day_number = 1), 1, 1, 'completed', datetime('now'), '2026-06-29', 'Shared Strength', 'Lower')
        `,
      )
      .run(program.programId, userId, program.lowerDayId, program.programId);
    dbModule.db
      .prepare(
        "INSERT INTO session_sets (session_id, exercise_name, category, progression_type, week_number, set_number, intensity_pct, reps, sets, rep_out_target, calculated_weight, training_max, auto_progression_enabled, actual_reps, actual_weight) VALUES (?, 'Squat', 'main', 'linear', 1, 1, 1, 5, 1, 5, 200, 200, 1, 5, 200)",
      )
      .run(session.lastInsertRowid);

    const rendered = await calendarPage.default({
      searchParams: Promise.resolve({ month: "2026-06", workout: `history-${session.lastInsertRowid}` }),
    });
    const text = collectRenderedText(rendered);
    const startLabels = collectWorkoutStartLabels(rendered);
    const ariaLabels = collectAriaLabels(rendered);

    expect(ariaLabels).toContain("Completed: Shared Strength - Lower on 2026-06-29");
    expect(text).not.toContain("Scheduled: Shared Strength - Lower 2026-06-29");
    expect(text).toContain("Completed workout");
    expect(startLabels).toContain("Repeat workout");
  });

  it("shows a do-workout modal for a selected scheduled calendar workout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00-07:00"));
    const userId = createUser("calendar-train-today@example.com");
    authenticate(userId);
    const program = createScheduledProgram(userId);

    const rendered = await calendarPage.default({
      searchParams: Promise.resolve({
        month: "2026-06",
        workout: `scheduled-${program.programId}-${program.lowerDayId}-2026-06-01`,
      }),
    });
    const text = collectRenderedText(rendered).replace(/\s+/g, " ");
    const startLabels = collectWorkoutStartLabels(rendered);

    expect(text).toContain("Run from calendar");
    expect(text).toContain("Originally scheduled 2026-06-01");
    expect(startLabels).toContain("Do workout");
  });
});
