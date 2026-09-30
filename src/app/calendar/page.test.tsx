import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isValidElement, type ComponentProps, type ElementType, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createUnexpiredAuthSession } from "@/__tests__/auth-fixture";
import { WorkoutReuse } from "@/components/WorkoutReuse";
import { WorkoutCard } from "@/components/WorkoutCard";
import { CalendarAgenda } from "@/components/CalendarAgenda";
import { SessionRecapView } from "@/components/SessionRecapView";

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
let occurrences: typeof import("@/features/programs/occurrences");
let programService: typeof import("@/features/programs/program-service");

function occurrenceAt(userId: number, programId: number, date: string) {
  const occurrence = occurrences.getOccurrences(userId).find(row => row.program_id === programId && row.scheduled_date === date);
  expect(occurrence, `Occurrence for program ${programId} scheduled ${date}`).toBeDefined();
  return occurrence!;
}

function occurrenceHref(id: number) {
  return `/calendar?month=2026-06&workout=occurrence-${id}`;
}

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

function collectComponentProps<T extends ElementType>(node: ReactNode, component: T): ComponentProps<T>[] {
  if (Array.isArray(node)) return node.flatMap(child => collectComponentProps(child, component));
  if (!isValidElement<ComponentProps<T> & { children?: ReactNode }>(node)) return [];
  return [...(node.type === component ? [node.props] : []), ...collectComponentProps(node.props.children, component)];
}

function collectRepeats(node: ReactNode): {sessionId?:number;name:string;today:string}[] {
  if (Array.isArray(node)) return node.flatMap(collectRepeats);
  if (!isValidElement<{children?:ReactNode;sessionId?:number;name:string;today:string}>(node)) return [];
  return [...(node.type === WorkoutReuse ? [node.props] : []), ...collectRepeats(node.props.children)];
}

function collectLinks(node: ReactNode, ariaLabel?: string): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return [];
  if (Array.isArray(node)) return node.flatMap(child => collectLinks(child, ariaLabel));
  if (isValidElement<{ children?: ReactNode; href?: unknown; "aria-label"?: string }>(node)) {
    const hrefs = typeof node.props.href === "string" && (!ariaLabel || node.props["aria-label"] === ariaLabel) ? [node.props.href] : [];
    return [...hrefs, ...collectLinks(node.props.children, ariaLabel)];
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
  const token = createUnexpiredAuthSession(dbModule.db, auth, userId);
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
  occurrences = await import("@/features/programs/occurrences");
  programService = await import("@/features/programs/program-service");
});

afterEach(() => {
  vi.useRealTimers();
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
  it.each(["week", "month"])("resumes an active planned occurrence in %s details without changing its scheduled date", async (view) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T12:00:00-07:00"));
    const userId = createUser("calendar-active-status@example.com");
    authenticate(userId);
    const program = createScheduledProgram(userId);
    const occurrence = occurrenceAt(userId, program.programId, "2026-06-01");
    const { POST: start } = await import("@/app/api/programs/[id]/sessions/route");
    const response = await start(new Request(`http://localhost/api/programs/${program.programId}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ occurrenceId: occurrence.id }),
    }), { params: Promise.resolve({ id: String(program.programId) }) });
    expect(response.status).toBe(201);
    const session = await response.json();
    expect(session).toMatchObject({ occurrence_id: occurrence.id, status: "in_progress", date: "2026-05-31", scheduled_date: "2026-06-01" });
    expect(session.sets.length).toBeGreaterThan(0);

    const rendered = await calendarPage.default({ searchParams: Promise.resolve({ month: "2026-06", view, workout: `occurrence-${occurrence.id}` }) });
    expect(collectAriaLabels(rendered)).toContain("In progress: Shared Strength - Lower on 2026-06-01");
    expect(collectAriaLabels(rendered)).not.toContain("Scheduled: Shared Strength - Lower on 2026-06-01");
    expect(collectRenderedText(rendered)).toContain("Workout in progress");
    expect(collectRenderedText(rendered)).toContain("Originally scheduled 2026-06-01");
    expect(collectRenderedText(rendered)).not.toContain("Started on 2026-06-01");
    expect(collectComponentProps(rendered, WorkoutCard)).toEqual([expect.objectContaining({
      occurrenceId: occurrence.id,
      programId: program.programId,
      dayId: program.lowerDayId,
      currentWeek: occurrence.week_number,
      currentDay: occurrence.day_number,
      scheduledDate: "2026-06-01",
    })]);
    expect(collectRepeats(rendered)).toEqual([]);
    expect(collectLinks(rendered).some(href => href.startsWith(`/workouts/${session.id}`))).toBe(false);
  });

  it.each([
    { scheduledDate: "2026-06-30", performedDate: "2026-07-01", view: "week" },
    { scheduledDate: "2026-06-30", performedDate: "2026-07-01", view: "month" },
    { scheduledDate: "2026-06-01", performedDate: "2026-05-31", view: "week" },
    { scheduledDate: "2026-06-01", performedDate: "2026-05-31", view: "month" },
  ])("keeps the selected $scheduledDate workout recap open when performed $performedDate in $view view", async ({ scheduledDate, performedDate, view }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${performedDate}T12:00:00-07:00`));
    const userId = createUser("calendar-completed-month-boundary@example.com");
    authenticate(userId);
    const program = createScheduledProgram(userId);
    const occurrence = occurrenceAt(userId, program.programId, "2026-06-01");
    dbModule.db.prepare("UPDATE workout_occurrences SET scheduled_date = ? WHERE id = ?").run(scheduledDate, occurrence.id);
    const { POST: start } = await import("@/app/api/programs/[id]/sessions/route");
    const response = await start(new Request(`http://localhost/api/programs/${program.programId}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ occurrenceId: occurrence.id }),
    }), { params: Promise.resolve({ id: String(program.programId) }) });
    expect(response.status).toBe(201);
    const session = await response.json();
    expect(session).toMatchObject({ occurrence_id: occurrence.id, date: performedDate, scheduled_date: scheduledDate });
    dbModule.db.prepare("UPDATE session_sets SET actual_reps = 7, actual_weight = 42.5 WHERE id = ?").run(session.sets[0].id);
    const selection = { month: "2026-06", view, workout: `occurrence-${occurrence.id}` };
    const before = await calendarPage.default({ searchParams: Promise.resolve(selection) });
    const returnTo = `/calendar?month=2026-06&date=${scheduledDate}${view === "month" ? "&view=month" : ""}`;
    expect(collectLinks(before, "Close workout")).toEqual([returnTo]);

    dbModule.db.prepare("UPDATE sessions SET status = 'completed', completed = 1 WHERE id = ?").run(session.id);
    const withoutSelection = await calendarPage.default({ searchParams: Promise.resolve({ month: "2026-06", date: scheduledDate, view }) });
    for (const date of [undefined, scheduledDate]) {
      const rendered = await calendarPage.default({ searchParams: Promise.resolve({ ...selection, date }) });
      expect(collectRenderedText(rendered)).toContain("Completed workout");
      expect(collectRenderedText(rendered)).toContain(`Completed on ${performedDate} · Lower`);
      expect(collectComponentProps(rendered, SessionRecapView)).toEqual([expect.objectContaining({
        recap: expect.objectContaining({ status: "completed", date: performedDate, volume: 298, loggedCount: 1 }),
      })]);
      expect(collectRepeats(rendered)).toEqual([expect.objectContaining({ sessionId: session.id })]);
      expect(collectComponentProps(rendered, WorkoutCard)).toEqual([]);
      expect(collectLinks(rendered, "Close workout")).toEqual([returnTo]);
      expect(collectComponentProps(rendered, CalendarAgenda)).toEqual(collectComponentProps(withoutSelection, CalendarAgenda));
      expect(collectAriaLabels(rendered)).not.toContain(`Completed: Shared Strength - Lower on ${performedDate}`);
    }
    expect(dbModule.db.prepare("SELECT id, actual_reps, actual_weight FROM session_sets WHERE id = ?").get(session.sets[0].id))
      .toEqual({ id: session.sets[0].id, actual_reps: 7, actual_weight: 42.5 });
  });

  it.each(["foreign", "missing", "deleted"])("does not open a %s selected occurrence", async (kind) => {
    const userId = createUser("calendar-selection-owner@example.com");
    const ownerId = kind === "foreign" ? createUser("calendar-selection-other@example.com") : userId;
    const program = createScheduledProgram(ownerId);
    const occurrence = occurrenceAt(ownerId, program.programId, "2026-06-01");
    const selectedId = kind === "missing" ? occurrence.id + 100_000 : occurrence.id;
    if (kind === "deleted") dbModule.db.prepare("DELETE FROM workout_occurrences WHERE id = ?").run(selectedId);
    if (kind === "foreign") {
      dbModule.db.prepare("INSERT INTO sessions (user_id, program_id, occurrence_id, week_number, status, date, program_name, day_name) VALUES (?, ?, ?, 1, 'completed', '2026-07-01', 'Private program', 'Private workout')")
        .run(ownerId, program.programId, occurrence.id);
      expect(occurrences.getOccurrence(ownerId, occurrence.id)).toMatchObject({ status: "completed", performed_date: "2026-07-01" });
    }
    authenticate(userId);
    const rendered = await calendarPage.default({ searchParams: Promise.resolve({ month: "2026-06", workout: `occurrence-${selectedId}` }) });
    expect(collectLinks(rendered, "Close workout")).toEqual([]);
    expect(collectComponentProps(rendered, SessionRecapView)).toEqual([]);
    expect(collectComponentProps(rendered, WorkoutCard)).toEqual([]);
    expect(collectRepeats(rendered)).toEqual([]);
    expect(collectRenderedText(rendered)).not.toContain("Private workout");
  });

  it.each(["paused", "archived"])("keeps a selected pending occurrence hidden when its run is %s", async (status) => {
    const userId = createUser("calendar-hidden-pending@example.com");
    authenticate(userId);
    const program = createScheduledProgram(userId);
    const occurrence = occurrenceAt(userId, program.programId, "2026-06-01");
    dbModule.db.prepare("UPDATE program_runs SET status = ? WHERE id = ?").run(status, program.runId);
    const rendered = await calendarPage.default({ searchParams: Promise.resolve({ month: "2026-06", workout: `occurrence-${occurrence.id}` }) });
    expect(collectLinks(rendered, "Close workout")).toEqual([]);
    expect(collectComponentProps(rendered, WorkoutCard)).toEqual([]);
  });

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

    expect(text).toContain("Week");
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
    expect(collectLinks(rendered)).toContain(occurrenceHref(occurrenceAt(userId, program.programId, "2026-06-03").id));
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

    expect(text).toContain("No workouts scheduled for this  week .");
    expect(collectAriaLabels(rendered).filter((label) => label.startsWith("Scheduled:"))).toEqual([]);
  });

  it("does not render scheduled workouts before a run start date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00-07:00"));
    const userId = createUser("calendar-start-date@example.com");
    authenticate(userId);
    const program = createScheduledProgram(userId);

    const futureOccurrence = occurrenceAt(userId, program.programId, "2026-06-01");

    const rendered = await calendarPage.default({
      searchParams: Promise.resolve({
        month: "2026-05",
        workout: `occurrence-${futureOccurrence.id}`,
      }),
    });
    const text = collectRenderedText(rendered);
    const startLabels = collectWorkoutStartLabels(rendered);

    expect(text).toContain("Week");
    expect(text).toContain("No workouts scheduled for this  week .");
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

    expect(text).toContain("Week");
    expect(text).toContain("No workouts scheduled for this  week .");
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
    const slots = occurrences.getOccurrences(userId).filter(row => row.program_id === program.programId);
    expect(slots.map(row => [row.day_name, row.week_number, row.scheduled_date])).toEqual([
      ["Lower", 1, "2026-06-01"], ["Upper", 1, "2026-06-03"],
      ["Lower", 2, "2026-06-05"], ["Upper", 2, "2026-06-08"],
    ]);
    expect(links.filter(link => link.includes("workout=occurrence-"))).toEqual(slots.map(row => occurrenceHref(row.id)));
  });

  it("shifts only the held run across hold dates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00-07:00"));
    const userId = createUser("calendar-held-run@example.com");
    authenticate(userId);
    const heldProgram = createScheduledProgram(userId, { numWeeks: 1, scheduleWeekdays: "[1,3]" });
    const movingProgram = createScheduledProgram(userId, { numWeeks: 1, scheduleWeekdays: "[1,3]" });
    const beforeHold = occurrenceAt(userId, heldProgram.programId, "2026-06-03");
    programService.createProgramRunHold({ userId, legacyProgramId: heldProgram.programId,
      startDate: "2026-06-03", endDate: "2026-06-08", reason: "No rack" });

    const rendered = await calendarPage.default({
      searchParams: Promise.resolve({ month: "2026-06" }),
    });
    const links = collectLinks(rendered);

    const heldSlots = occurrences.getOccurrences(userId).filter(row => row.program_id === heldProgram.programId);
    expect(heldSlots.map(row => [row.day_name, row.scheduled_date])).toEqual([
      ["Lower", "2026-06-01"], ["Upper", "2026-06-10"],
    ]);
    expect(heldSlots[1]).toMatchObject({ id: beforeHold.id, week_number: beforeHold.week_number,
      prescription_json: beforeHold.prescription_json, original_date: "2026-06-03" });
    expect(links).toEqual(expect.arrayContaining(heldSlots.map(row => occurrenceHref(row.id))));
    expect(links).toContain(occurrenceHref(occurrenceAt(userId, movingProgram.programId, "2026-06-03").id));
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

    const completedOccurrence = occurrenceAt(userId, program.programId, "2026-06-01");
    expect(completedOccurrence.session_id).toBe(Number(session.lastInsertRowid));
    const rendered = await calendarPage.default({
      searchParams: Promise.resolve({ month: "2026-06", workout: `occurrence-${completedOccurrence.id}` }),
    });
    const text = collectRenderedText(rendered);
    const startLabels = collectWorkoutStartLabels(rendered);
    const ariaLabels = collectAriaLabels(rendered);

    expect(ariaLabels).toContain("Completed: Shared Strength - Lower on 2026-06-29");
    expect(ariaLabels.filter(label => label === "Completed: Shared Strength - Lower on 2026-06-29")).toHaveLength(1);
    expect(ariaLabels).not.toContain("Scheduled: Shared Strength - Lower on 2026-06-01");
    expect(text).not.toContain("Scheduled: Shared Strength - Lower 2026-06-29");
    expect(text).toContain("Completed workout");
    expect(startLabels).not.toContain("Repeat workout");
    expect(collectRepeats(rendered)).toEqual([expect.objectContaining({sessionId:Number(session.lastInsertRowid)})]);
  });

  it("repeats a completed editor workout from its saved session instead of starting without an occurrence", async () => {
    const userId=createUser("calendar-editor-repeat@example.test");authenticate(userId);
    const {createBlankDocument,createExercise}=await import("@/features/program-editor/document");
    const {saveEditorDraft,activateEditorDraft}=await import("@/features/program-editor/repository");
    const document=createBlankDocument();document.name="Saved editor program";document.startDate="2026-06-01";document.weekdays=[0,1,2,3,4,5,6];
    document.weeks[0].days[0].exercises=[createExercise("Saved row")];
    const id=crypto.randomUUID();saveEditorDraft({userId,id,expectedRevision:0,document});
    const activation=activateEditorDraft({userId,id,expectedRevision:1});
    const occurrence=occurrences.getOccurrences(userId).find(row=>row.program_run_id===activation.runId)!;
    const {POST:start}=await import("@/app/api/programs/[id]/sessions/route");
    const response=await start(new Request(`http://localhost/api/programs/${occurrence.program_id}/sessions`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({occurrenceId:occurrence.id})}),{params:Promise.resolve({id:String(occurrence.program_id)})});
    expect(response.status).toBe(201);const session=await response.json();
    dbModule.db.prepare("UPDATE sessions SET status='completed',date='2026-06-01',completed=1 WHERE id=?").run(session.id);
    const rendered=await calendarPage.default({searchParams:Promise.resolve({month:"2026-06",workout:`occurrence-${occurrence.id}`})});
    expect(collectRepeats(rendered)).toEqual([expect.objectContaining({sessionId:session.id})]);
    expect(collectWorkoutStartLabels(rendered)).toEqual([]);
    const {POST:repeat}=await import("@/app/api/sessions/[sessionId]/repeat/route");
    const repeatKey=crypto.randomUUID();
    const request=()=>repeat(new Request(`http://localhost/api/sessions/${session.id}/repeat`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestKey:repeatKey,date:"2026-07-01"})}),{params:Promise.resolve({sessionId:String(session.id)})});
    const repeated=await(await request()).json();
    expect(repeated).toMatchObject({program_id:null,date:"2026-07-01",status:"in_progress"});
    expect(repeated.sets.map((set:{exercise_name:string})=>set.exercise_name)).toContain("Saved row");
    expect((await(await request()).json()).id).toBe(repeated.id);
    expect(dbModule.db.prepare("SELECT status FROM sessions WHERE id=?").get(session.id)).toEqual({status:"completed"});
  });
  it("shows active unplanned workouts as occupied Calendar cards with their exact resume link",async()=>{
    const userId=createUser("calendar-active-quick@example.test");authenticate(userId);
    const sessionId=Number(dbModule.db.prepare("INSERT INTO sessions(user_id,date,week_number,status,day_name) VALUES (?,'2026-07-03',1,'in_progress','Independent row')").run(userId).lastInsertRowid);
    const rendered=await calendarPage.default({searchParams:Promise.resolve({month:"2026-07",date:"2026-07-03",workout:`history-${sessionId}`})});
    expect(collectAriaLabels(rendered)).toContain("In progress:  - Independent row on 2026-07-03");
    expect(collectLinks(rendered)).toContain(`/workouts/${sessionId}?returnTo=%2Fcalendar%3Fmonth%3D2026-07%26date%3D2026-07-03`);
    expect(collectRenderedText(rendered)).toContain("Started on 2026-07-03");
    expect(collectComponentProps(rendered, WorkoutCard)).toEqual([]);
  });

  it("shows a do-workout modal for a selected scheduled calendar workout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00-07:00"));
    const userId = createUser("calendar-train-today@example.com");
    authenticate(userId);
    const program = createScheduledProgram(userId);
    const selectedOccurrence = occurrenceAt(userId, program.programId, "2026-06-01");

    const rendered = await calendarPage.default({
      searchParams: Promise.resolve({
        month: "2026-06",
        workout: `occurrence-${selectedOccurrence.id}`,
      }),
    });
    const text = collectRenderedText(rendered).replace(/\s+/g, " ");
    const startLabels = collectWorkoutStartLabels(rendered);

    expect(text).toContain("Run from calendar");
    expect(text).toContain("Originally scheduled 2026-06-01");
    expect(startLabels).toContain("Do workout");
  });
  it("keeps unfinished workouts on their original dates until selected", async () => {
    const userId = createUser("calendar-carryover@example.com");
    const other = createUser("calendar-private-carryover@example.com");
    authenticate(userId);
    const insert = dbModule.db.prepare("INSERT INTO sessions(user_id,date,week_number,status,day_name) VALUES (?,'2026-08-10',1,'in_progress',?)");
    const sessionId = Number(insert.run(userId, "Old unfinished workout").lastInsertRowid);
    insert.run(other, "Private unfinished workout");
    const rendered = await calendarPage.default({ searchParams: Promise.resolve({ month: "2026-09", date: "2026-09-05" }) });
    const text = collectRenderedText(rendered);
    expect(text).not.toContain("Old unfinished workout");
    expect(text).not.toContain("Started 2026-08-10");
    expect(text).not.toContain("Private unfinished workout");
    expect(collectLinks(rendered)).not.toContain(`/workouts/${sessionId}?returnTo=${encodeURIComponent("/calendar?month=2026-09&date=2026-09-05")}`);
    expect(dbModule.db.prepare("SELECT date,status FROM sessions WHERE id=?").get(sessionId)).toEqual({ date: "2026-08-10", status: "in_progress" });
  });

});
