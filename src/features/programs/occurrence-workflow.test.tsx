import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ userId: 0 }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({ id: authState.userId }),
  getSettingNumber: () => 2.5,
}));
let service: typeof import("./program-service");
let db: (typeof import("@/lib/db"))["db"];
let calendar: typeof import("@/app/calendar/page");

beforeAll(async () => {
  process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "magni-occurrences-")), "test.sqlite");
  db = (await import("@/lib/db")).db;
  service = await import("./program-service");
  calendar = await import("@/app/calendar/page");
});
afterEach(() => vi.useRealTimers());

function fixture(weekdays = [1, 3, 6], startDate = "2026-09-05", numWeeks = 2) {
  authState.userId = Number(db.prepare("INSERT INTO users(email,password_hash) VALUES (?, 'hash')").run(`${crypto.randomUUID()}@example.test`).lastInsertRowid);
  const program = service.createProgramRun({ userId: authState.userId, name: "Occurrence regression", numWeeks });
  for (const [name, lift] of [["Lower", "Squat"], ["Upper", "Bench Press"], ["Full Body", "Deadlift"]]) {
    const day = service.addDefinitionDayForRun({ userId: authState.userId, legacyProgramId: program.legacyProgramId, name });
    service.addDefinitionExerciseForDay({ userId: authState.userId, legacyDayId: day.legacyDayId, name: lift, trainingMax: 200, category: "main", progressionType: "linear" });
  }
  service.updateProgramRun({ userId: authState.userId, legacyProgramId: program.legacyProgramId, scheduleWeekdays: weekdays, startDate });
  return program;
}

function labels(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(labels);
  if (!isValidElement<{ children?: ReactNode; "aria-label"?: string }>(node)) return [];
  return [...(node.props["aria-label"] ? [node.props["aria-label"]] : []), ...labels(node.props.children)];
}

describe("authoritative workout occurrence workflows", () => {
  it("keeps the performed recap visible on Today after completion and another server render", async () => {
    const program = fixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 5, 12));
    const occurrence = service.getTodayWorkoutDashboard(authState.userId).scheduledToday[0];
    const context = { params: Promise.resolve({ id: String(program.legacyProgramId) }) };
    const request = (body: object) => new Request("http://localhost/api/workout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const start = await import("@/app/api/programs/[id]/sessions/route");
    const session = await (await start.POST(request({ occurrenceId: occurrence.occurrence_id }), context)).json();
    db.prepare("UPDATE session_sets SET actual_reps=10, actual_weight=40 WHERE id=?").run(session.sets[0].id);
    const complete = await import("@/app/api/programs/[id]/complete-and-advance/route");
    expect((await complete.POST(request({ sessionId: session.id }), context)).status).toBe(200);
    const TodayPage = (await import("@/app/today/page")).default;
    function text(node: ReactNode): string {
      if (typeof node === "string" || typeof node === "number") return String(node);
      if (Array.isArray(node)) return node.map(text).join("");
      return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : "";
    }
    for (let render = 0; render < 2; render++) {
      const content = text(await TodayPage({}));
      expect(content).toContain("10 reps @ 40 lb");
      expect(content).toContain("400 lb total");
      expect(content).not.toContain("30 reps");
    }
  });
  it("completes a run only after every logical workout is resolved", async () => {
    const program = fixture();
    const occurrences = await import("./occurrences");
    occurrences.ensureScheduledOccurrences(authState.userId);
    db.prepare("UPDATE workout_occurrences SET status='completed' WHERE program_run_id=? AND slot_index > 0").run(program.runId);
    occurrences.syncOccurrencePosition(authState.userId, program.legacyProgramId);
    expect(db.prepare("SELECT status FROM program_runs WHERE id=?").get(program.runId)).toEqual({status:"active"});
    db.prepare("UPDATE workout_occurrences SET status='skipped' WHERE program_run_id=? AND slot_index=0").run(program.runId);
    occurrences.syncOccurrencePosition(authState.userId, program.legacyProgramId);
    expect(db.prepare("SELECT status FROM program_runs WHERE id=?").get(program.runId)).toEqual({status:"completed"});
    expect(db.prepare("SELECT is_active FROM programs WHERE id=?").get(program.legacyProgramId)).toEqual({is_active:0});
  });
  it("upgrades a populated database without changing recorded prescriptions or maxes", async () => {
    const program = fixture();
    const before = db.prepare("SELECT * FROM program_run_expected_maxes WHERE program_run_id = ?").all(program.runId);
    const { runMigrations } = await import("@/lib/db/migrations");
    runMigrations(db);
    runMigrations(db);
    expect(db.prepare("SELECT * FROM program_run_expected_maxes WHERE program_run_id = ?").all(program.runId)).toEqual(before);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workout_occurrences'").get()).toBeDefined();
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
  it("preserves every legacy quick draft and its performed sets during upgrade", async () => {
    fixture();
    db.exec("DROP INDEX IF EXISTS idx_sessions_unique_quick_in_progress");
    const ids = [1, 2].map(() => Number(db.prepare("INSERT INTO sessions (user_id,week_number,date) VALUES (?,1,'2026-09-05')").run(authState.userId).lastInsertRowid));
    ids.forEach(id => db.prepare("INSERT INTO session_sets(session_id,exercise_name,actual_reps,actual_weight) VALUES (?,'Row',10,40)").run(id));
    const { runMigrations } = await import("@/lib/db/migrations");
    runMigrations(db);
    expect(db.prepare("SELECT id FROM sessions WHERE user_id=? ORDER BY id").all(authState.userId)).toEqual(ids.map(id => ({ id })));
    expect(db.prepare("SELECT COUNT(*) AS n FROM session_sets WHERE session_id IN (?,?)").get(...ids)).toEqual({ n: 2 });
  });
  it("reproduces and fixes Today/Calendar disagreement in a partial starting week", async () => {
    fixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 5, 12));
    const today = service.getTodayWorkoutDashboard(authState.userId).scheduledToday[0];
    const pageLabels = labels(await calendar.default({ searchParams: Promise.resolve({ month: "2026-09" }) }));
    expect(pageLabels).toContain("Scheduled: Occurrence regression - Lower on 2026-09-05");
    expect(today.day_name).toBe("Lower");
    expect(today.current_week).toBe(1);
    expect(today.day_number).toBe(1);
    expect(today.scheduled_date).toBe("2026-09-05");
  });
  it("keeps same-date duplicate occurrences independently keyed on Today", async () => {
    fixture([0, 1, 2, 3, 4, 5, 6]);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 5, 12));
    const { getOccurrences } = await import("./occurrences");
    const { applyCalendarAction } = await import("@/features/calendar/calendar-service");
    const original = getOccurrences(authState.userId)[0];
    applyCalendarAction(authState.userId, {
      type: "duplicate", occurrenceId: original.id, revision: original.revision,
      date: original.scheduled_date, collision: "move", requestKey: crypto.randomUUID(),
    });
    const TodayPage = (await import("@/app/today/page")).default;
    function occurrenceKeys(node: ReactNode): string[] {
      if (Array.isArray(node)) return node.flatMap(occurrenceKeys);
      if (!isValidElement<{ children?: ReactNode; occurrenceId?: number; "data-occurrence-id"?: number }>(node)) return [];
      return [...(node.props.occurrenceId || node.props["data-occurrence-id"] ? [String(node.key)] : []), ...occurrenceKeys(node.props.children)];
    }
    const keys = occurrenceKeys(await TodayPage({}));
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  it("counts logical slots with extra weekdays instead of losing days or advancing a calendar week", () => {
    fixture([0, 1, 2, 3, 4, 5, 6]);
    const expected = [["Lower", 1], ["Upper", 1], ["Full Body", 1], ["Lower", 2], ["Upper", 2], ["Full Body", 2]];
    expected.forEach(([name, week], index) => {
      const row = service.getTodayWorkoutDashboard(authState.userId, new Date(2026, 8, 5 + index, 12)).scheduledToday[0];
      expect(row?.day_name).toBe(name);
      expect(row?.current_week).toBe(week);
    });
    expect(service.getTodayWorkoutDashboard(authState.userId, new Date(2026, 8, 11, 12)).scheduledToday).toHaveLength(0);
  });

  it("does not offer workouts before a future start date", () => {
    fixture();
    expect(service.getTodayWorkoutDashboard(authState.userId, new Date(2026, 8, 2, 12)).scheduledToday).toHaveLength(0);
  });
  it("uses the saved user timezone for Today instead of the server timezone", () => {
    fixture([0,1,2,3,4,5,6]);
    db.prepare("INSERT INTO user_settings(user_id,key,value) VALUES (?,'timezone','Asia/Tokyo')").run(authState.userId);
    const row = service.getTodayWorkoutDashboard(authState.userId, new Date("2026-09-05T16:00:00Z")).scheduledToday[0];
    expect(row.scheduled_date).toBe("2026-09-06");
    expect(row.day_name).toBe("Upper");
  });

  it("starts the selected occurrence and resumes it after midnight without duplicating or changing its prescription", async () => {
    const program = fixture();
    const row = service.getTodayWorkoutDashboard(authState.userId, new Date(2026, 8, 5, 12)).scheduledToday[0];
    const route = await import("@/app/api/programs/[id]/sessions/route");
    const context = { params: Promise.resolve({ id: String(program.legacyProgramId) }) };
    const start = () => route.POST(new Request("http://localhost/api/programs/1/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ occurrenceId: row.occurrence_id }) }), context);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 5, 23, 59));
    const firstResponse = await start();
    expect(firstResponse.status).toBe(201);
    const first = await firstResponse.json();
    vi.setSystemTime(new Date(2026, 8, 6, 0, 1));
    db.prepare("UPDATE program_run_expected_maxes SET expected_max=300 WHERE program_run_id=?").run(program.runId);
    const retry = await start();
    expect(retry.status).toBe(200);
    const again = await retry.json();
    expect(again.id).toBe(first.id);
    expect(again.sets).toEqual(first.sets);
    expect(again.scheduled_date).toBe("2026-09-05");
    expect(again.day_name).toBe("Lower");
    expect(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE program_id=?").get(program.legacyProgramId)).toEqual({ n: 1 });
  });

  it("skips the selected future week/date once, leaving today's occurrence unchanged", async () => {
    const program = fixture();
    const today = service.getTodayWorkoutDashboard(authState.userId, new Date(2026, 8, 5, 12)).scheduledToday[0];
    const future = service.getTodayWorkoutDashboard(authState.userId, new Date(2026, 8, 12, 12)).scheduledToday[0];
    const route = await import("@/app/api/programs/[id]/skip-workout/route");
    const skip = () => route.POST(new Request("http://localhost/api/programs/1/skip-workout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ occurrenceId: future.occurrence_id }) }), { params: Promise.resolve({ id: String(program.legacyProgramId) }) });
    const result = await skip();
    expect(result.status).toBe(201);
    const session = await result.json();
    expect(session.week_number).toBe(2);
    expect(session.scheduled_date).toBe("2026-09-12");
    const retry = await skip();
    expect(retry.status).toBe(200);
    expect((await retry.json()).id).toBe(session.id);
    const after = service.getTodayWorkoutDashboard(authState.userId, new Date(2026, 8, 5, 12)).scheduledToday[0];
    expect(after.occurrence_id).toBe(today.occurrence_id);
    expect(after.today_session_status).toBeNull();
  });

  it("advances past already skipped slots and returns the same position on a completion retry", async () => {
    const program = fixture();
    const first = service.getTodayWorkoutDashboard(authState.userId, new Date(2026, 8, 5, 12)).scheduledToday[0];
    const second = service.getTodayWorkoutDashboard(authState.userId, new Date(2026, 8, 7, 12)).scheduledToday[0];
    const context = { params: Promise.resolve({ id: String(program.legacyProgramId) }) };
    const request = (body: object) => new Request("http://localhost/api/workout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const skip = await import("@/app/api/programs/[id]/skip-workout/route");
    expect((await skip.POST(request({ occurrenceId: second.occurrence_id }), context)).status).toBe(201);
    const start = await import("@/app/api/programs/[id]/sessions/route");
    const session = await (await start.POST(request({ occurrenceId: first.occurrence_id }), context)).json();
    db.prepare("UPDATE session_sets SET actual_reps = 5, actual_weight = 200 WHERE session_id = ?").run(session.id);
    const complete = await import("@/app/api/programs/[id]/complete-and-advance/route");
    const result = await complete.POST(request({ sessionId: session.id }), context);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ currentWeek: 1, currentDay: 3 });
    const maxes = db.prepare("SELECT * FROM program_run_expected_maxes WHERE program_run_id = ?").all(program.runId);
    const again = await complete.POST(request({ sessionId: session.id }), context);
    expect(await again.json()).toMatchObject({ alreadyCompleted: true, currentWeek: 1, currentDay: 3 });
    expect(db.prepare("SELECT * FROM program_run_expected_maxes WHERE program_run_id = ?").all(program.runId)).toEqual(maxes);
  });

  it("holds and resumes existing slots without changing identity, week or set scheme", async () => {
    const program = fixture();
    const occurrences = await import("./occurrences");
    const original = occurrences.getOccurrences(authState.userId);
    service.createProgramRunHold({ userId: authState.userId, legacyProgramId: program.legacyProgramId, startDate: "2026-09-05", endDate: "2026-09-12" });
    const held = occurrences.getOccurrences(authState.userId);
    expect(held[0].scheduled_date).toBe("2026-09-14");
    expect(held.map(row => [row.id, row.week_number, row.prescription_json])).toEqual(original.map(row => [row.id, row.week_number, row.prescription_json]));
    service.cancelActiveProgramRunHold({ userId: authState.userId, legacyProgramId: program.legacyProgramId, today: new Date(2026, 8, 6) });
    expect(occurrences.getOccurrences(authState.userId)[0].scheduled_date).toBe("2026-09-05");
  });

  it("keeps a future skip on its selected date and active sessions visible through holds and pause", async () => {
    const program = fixture();
    const occurrenceService = await import("./occurrences");
    const rows = occurrenceService.getOccurrences(authState.userId);
    const context = { params: Promise.resolve({ id: String(program.legacyProgramId) }) };
    const request = (body: object) => new Request("http://localhost/api/workout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const skip = await import("@/app/api/programs/[id]/skip-workout/route");
    await skip.POST(request({ occurrenceId: rows[3].id }), context);
    expect(labels(await calendar.default({ searchParams: Promise.resolve({ month: "2026-09" }) }))).toContain("Skipped: Occurrence regression - Lower on 2026-09-12");
    const start = await import("@/app/api/programs/[id]/sessions/route");
    await start.POST(request({ occurrenceId: rows[0].id }), context);
    service.createProgramRunHold({ userId: authState.userId, legacyProgramId: program.legacyProgramId, startDate: "2026-09-05", endDate: "2026-09-12" });
    service.updateProgramRun({ userId: authState.userId, legacyProgramId: program.legacyProgramId, status: "paused" });
    expect(occurrenceService.getOccurrences(authState.userId).map(row => row.id)).toContain(rows[0].id);
    const dashboard = service.getTodayWorkoutDashboard(authState.userId, new Date(2026, 8, 6, 12));
    expect(dashboard.activeWorkouts.map(row => row.occurrence_id)).toContain(rows[0].id);
  });
  it("starts a frozen occurrence even after a legacy editor replaces its source set rows", async () => {
    const program = fixture();
    const occurrenceService = await import("./occurrences");
    const occurrence = occurrenceService.getOccurrences(authState.userId)[0];
    const exercise = db.prepare("SELECT e.id FROM exercises e JOIN days d ON d.id=e.day_id WHERE d.program_id=? ORDER BY e.id LIMIT 1").get(program.legacyProgramId) as { id: number };
    service.updateDefinitionExerciseType({ userId: authState.userId, legacyExerciseId: exercise.id, category: "main", progressionType: "double" });
    const start = await import("@/app/api/programs/[id]/sessions/route");
    const response = await start.POST(new Request("http://localhost/api/workout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ occurrenceId: occurrence.id }) }), { params: Promise.resolve({ id: String(program.legacyProgramId) }) });
    expect(response.status).toBe(201);
    const session = await response.json();
    expect(session.sets.map((set: { reps: number; progression_type: string }) => [set.reps, set.progression_type])).toEqual([[5,"linear"],[5,"linear"],[5,"linear"]]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
});
