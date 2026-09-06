import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let database: typeof import("@/lib/db");
let service: typeof import("./history-service");
let dir: string;
let userId: number;
let otherId: number;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "magni-workout-history-"));
  vi.stubEnv("DB_PATH", path.join(dir, "test.sqlite"));
  database = await import("@/lib/db");
  const migration = await import("./migration");
  migration.runWorkoutHistoryMigration(database.db);
  service = await import("./history-service");
  userId = Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('workout-history@example.com','hash')").run().lastInsertRowid);
  otherId = Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('other-workout-history@example.com','hash')").run().lastInsertRowid);
});
afterAll(() => { database?.db.close(); fs.rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

const requestKey = () => crypto.randomUUID();
function workout(name = "Past upper day") {
  return service.createQuickSession({ userId, requestKey: requestKey(), newWorkout: true, name, date: "2026-09-01" }).session;
}
function row(sessionId: number, name = "Dumbbell Row") {
  return service.addQuickExercise({ userId, sessionId, requestKey: requestKey(), name, sets: [{ reps: 10, weight: 40 }, { reps: 8, weight: 42.5 }, { reps: 8, weight: 42.5 }] });
}

describe("unplanned workout and history lifecycle", () => {
  it("creates a past workout once after a lost response and starts Today separately", () => {
    const key = requestKey();
    const first = service.createQuickSession({ userId, requestKey: key, newWorkout: true, name: "Monday pull", date: "2026-09-01" });
    const retry = service.createQuickSession({ userId, requestKey: key, newWorkout: true, name: "Monday pull", date: "2026-09-01" });
    expect(retry.session.id).toBe(first.session.id);
    const today = service.createQuickSession({ userId });
    expect(today.session.id).not.toBe(first.session.id);
    expect(service.createQuickSession({ userId }).session.id).toBe(today.session.id);
    expect(first.session).toMatchObject({ name: "Monday pull", date: "2026-09-01", status: "in_progress" });
    expect(() => service.createQuickSession({ userId, requestKey: key, newWorkout: true, name: "Different", date: "2026-09-01" })).toThrow(/retry key/i);
  });

  it("adds differing sets once, reorders, renames and removes rows only while active", () => {
    const session = workout();
    const key = requestKey();
    const input = { userId, sessionId: session.id, requestKey: key, name: "Row", sets: [{ reps: 10, weight: 40 }, { reps: 8, weight: 42.5 }] };
    const first = service.addQuickExercise(input);
    expect(service.addQuickExercise(input).sets.map((set) => set.id)).toEqual(first.sets.map((set) => set.id));
    const updated = service.updateQuickStructure({ userId, sessionId: session.id, expectedRevision: first.revision,
      requestKey: requestKey(), name: "Updated pull", date: "2026-08-31", order: first.sets.map((set) => set.id).reverse() });
    expect(updated.sets.map((set) => set.calculated_weight)).toEqual([42.5, 40]);
    const removed = service.updateQuickStructure({ userId, sessionId: session.id, expectedRevision: updated.revision, requestKey: requestKey(), removeSetIds: [updated.sets[1].id], renameExercise: { setIds: [updated.sets[0].id], name: "Cable row" } });
    expect(removed.sets).toHaveLength(1);
    expect(removed.sets[0].exercise_name).toBe("Cable row");
    expect(() => service.updateQuickStructure({ userId, sessionId: session.id, expectedRevision: updated.revision, requestKey: requestKey(), name: "Stale" })).toThrow(/changed/i);
  });

  it("records actuals with conflict detection and makes same-value retry safe", () => {
    const session = row(workout().id);
    const set = session.sets[0];
    const input = { userId, sessionId: session.id, setId: set.id, actualReps: 10, actualWeight: 40, expectedActual: { reps: null, weight: null } };
    service.saveActualSet(input);
    expect(service.saveActualSet(input).actual_reps).toBe(10);
    expect(() => service.saveActualSet({ ...input, actualReps: 7 })).toThrow(/changed/i);
    expect(service.getWorkout(userId, session.id)?.sets[0].actual_reps).toBe(10);
  });

  it("finishes partially, finds history and corrects actuals without rewriting prescriptions", () => {
    const session = row(workout().id);
    service.saveActualSet({ userId, sessionId: session.id, setId: session.sets[0].id, actualReps: 10, actualWeight: 40 });
    const finished = service.finishQuickSession(userId, session.id);
    expect(finished.volume).toBe(400);
    expect(service.finishQuickSession(userId, session.id)).toEqual(finished);
    const before = service.getWorkout(userId, session.id)!;
    const key = requestKey();
    const input = { userId, sessionId: session.id, expectedRevision: before.revision, requestKey: key, reason: "Corrected rep count", sets: [{ setId: session.sets[0].id, actualReps: 8, actualWeight: 40 }] };
    const corrected = service.correctWorkout(input);
    expect(corrected.recap.volume).toBe(320);
    expect(service.correctWorkout(input).recap.volume).toBe(320);
    expect(corrected.progressionEffect).toMatch(/unchanged/i);
    const after = service.getWorkout(userId, session.id)!;
    expect(after.sets.map((set) => [set.reps, set.calculated_weight])).toEqual(before.sets.map((set) => [set.reps, set.calculated_weight]));
    expect(after.corrections).toHaveLength(1);
    expect(service.listWorkouts(userId).some((entry) => entry.id === session.id && entry.volume === 320)).toBe(true);
    expect(() => service.updateQuickStructure({ userId, sessionId: session.id, name: "Rewrite" })).toThrow(/in progress/i);
  });

  it("repeats previous actual values, saves reusable routines and suggests recent exercises", () => {
    const source = row(workout("Three-set rows").id);
    service.saveActualSet({ userId, sessionId: source.id, setId: source.sets[0].id, actualReps: 12, actualWeight: 45 });
    service.finishQuickSession(userId, source.id);
    const repeated = service.createQuickSession({ userId, requestKey: requestKey(), sourceSessionId: source.id, date: "2026-09-03" }).session;
    expect(repeated.sets[0]).toMatchObject({ reps: 12, calculated_weight: 45, actual_reps: null });
    const routine = service.saveRoutine({ userId, requestKey: requestKey(), sessionId: source.id, name: "Row routine" });
    expect(service.listRoutines(userId).some((item) => item.id === routine.id)).toBe(true);
    const fromRoutine = service.createQuickSession({ userId, requestKey: requestKey(), routineId: routine.id, date: "2026-09-04" }).session;
    expect(fromRoutine.sets[0].calculated_weight).toBe(45);
    expect(service.recentExercises(userId, "row")[0]).toMatchObject({ name: "Dumbbell Row", sets: [{ reps: 12, weight: 45 }] });
  });

  it("enforces ownership and validates dates, identities and set changes", () => {
    const session = row(workout().id);
    expect(service.getWorkout(otherId, session.id)).toBeNull();
    expect(() => service.createQuickSession({ userId: otherId, requestKey: requestKey(), sourceSessionId: session.id })).toThrow(/not found/i);
    expect(() => service.addQuickExercise({ userId: otherId, sessionId: session.id, name: "Steal", sets: [{ reps: 1, weight: 1 }] })).toThrow(/not found/i);
    expect(() => service.saveActualSet({ userId: otherId, sessionId: session.id, setId: session.sets[0].id, actualReps: 2, actualWeight: 5 })).toThrow(/not found/i);
    expect(() => service.createQuickSession({ userId, date: "2026-02-30" })).toThrow(/date/i);
    expect(() => service.updateQuickStructure({ userId, sessionId: session.id, order: [999999] })).toThrow(/every set/i);
    expect(() => service.addQuickExercise({ userId, sessionId: session.id, name: "", sets: [] })).toThrow();
  });
  it("preserves workout units when adding sets, repeating and saving a routine", () => {
    const source = service.createQuickSession({ userId, requestKey: requestKey(), newWorkout: true, unit: "kg" }).session;
    const updated = row(source.id);
    expect(updated.unit).toBe("kg");
    const copy = service.createQuickSession({ userId, requestKey: requestKey(), sourceSessionId: source.id }).session;
    expect(copy.unit).toBe("kg");
    const routine = service.saveRoutine({ userId, sessionId: source.id, requestKey: requestKey(), name: "Kilogram routine" });
    expect(service.createQuickSession({ userId, requestKey: requestKey(), routineId: routine.id }).session.unit).toBe("kg");
  });
});

it("normalizes mixed units for Stats and PR comparison while preserving original recap and recent values", async () => {
  const stats = await import("@/features/programs/training-stats");
  const owner = Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('mixed@example.com','hash')").run().lastInsertRowid);
  function performed(unit: "kg" | "lb", date: string, weight = 40) {
    const session = service.createQuickSession({ userId: owner, newWorkout: true, unit, date }).session;
    const added = service.addQuickExercise({ userId: owner, sessionId: session.id, name: "Unit Row", sets: [{ reps: 10, weight }] });
    service.saveActualSet({ userId: owner, sessionId: session.id, setId: added.sets[0].id, actualReps: 10, actualWeight: weight });
    service.finishQuickSession(owner, session.id); return session.id;
  }
  const kg = performed("kg", "2026-09-01"); const lb = performed("lb", "2026-09-02");
  const totals = stats.getUserTrainingStats(owner);
  expect(totals.totals.volume).toBe(Math.round(400 * 2.2046226218487757 + 400));
  expect(totals.usesKilograms).toBe(true);
  expect(stats.getSessionRecap(owner, kg)).toMatchObject({ volume: 400, unit: "kg" });
  expect(stats.getSessionPrs(owner, lb)).toEqual([]);
  expect(stats.getSessionPrs(owner, kg)[0].weight).toBe(40);
  const decimal = performed("kg", "2026-09-03", 42.5);
  expect(stats.getLastPerformanceByExercise(owner, lb)["Unit Row"]).toMatchObject({ topWeight: 42.5, unit: "kg" });
  expect(service.recentExercises(owner, "Unit Row", "kg")[0].sets[0].weight).toBe(42.5);
  expect(service.recentExercises(owner, "Unit Row", "lb")[0].sets[0].weight).toBeCloseTo(42.5 * 2.2046226218487757, 2);
  expect(stats.getSessionRecap(owner, decimal)?.exercises[0].topWeight).toBe(42.5);
});

it("paginates more than 100 workouts on one date without dropping or repeating entries", () => {
  const owner = Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('pagination@example.com','hash')").run().lastInsertRowid);
  for (let i = 0; i < 105; i++) service.createQuickSession({ userId: owner, newWorkout: true, date: "2026-09-01" });
  const first = service.listWorkouts(owner); expect(first).toHaveLength(100);
  const second = service.listWorkouts(owner, `${first.at(-1)!.date}:${first.at(-1)!.id}`); expect(second).toHaveLength(5);
  expect(new Set([...first, ...second].map((item) => item.id)).size).toBe(105);
  expect(() => service.listWorkouts(owner, "2026-09-01:not-a-number")).toThrow(/cursor/i);
});

it("previews a planned correction without changing saved progression or future prescriptions", async () => {
  const document = await import("@/features/program-editor/document");
  const repository = await import("@/features/program-editor/repository");
  const execution = await import("@/features/program-editor/execution");
  const doc = document.createBlankDocument(); doc.name = "Correction program"; doc.startDate = "2026-09-01"; doc.weekdays = [0,1,2,3,4,5,6]; doc.cycles = 2;
  const exercise = document.createExercise("Correction Row");
  exercise.rule = { version: 1, condition: { type: "double_progression" }, action: { variable: "load", unit: "lb", operation: "add", amount: 2.5, rounding: { mode: "nearest", quantum: 2.5 }, timing: "per_exposure" } };
  doc.weeks[0].days[0].exercises = [exercise];
  const draftId = crypto.randomUUID(); repository.saveEditorDraft({ userId, id: draftId, expectedRevision: 0, document: doc });
  const active = repository.activateEditorDraft({ userId, id: draftId, expectedRevision: 1 });
  const occurrence = database.db.prepare("SELECT * FROM workout_occurrences WHERE program_run_id=? ORDER BY slot_index LIMIT 1").get(active.runId) as { id: number; definition_day_id: number; legacy_day_id: number; prescription_json: string };
  const sessionId = Number(database.db.prepare("INSERT INTO sessions(user_id,program_id,program_run_id,program_definition_day_id,day_id,occurrence_id,week_number,date) VALUES (?,?,?,?,?,?,1,'2026-09-01')").run(userId, active.programId, active.runId, occurrence.definition_day_id, occurrence.legacy_day_id, occurrence.id).lastInsertRowid);
  const prescription = JSON.parse(occurrence.prescription_json) as import("@/features/program-editor/repository").EditorPrescriptionSet[];
  prescription.forEach((set) => {
    const resolved = execution.resolveEditorPrescription(set, active.runId);
    database.db.prepare("INSERT INTO session_sets(session_id,exercise_name,reps,sets,rep_out_target,calculated_weight,actual_reps,actual_weight,editor_json) VALUES (?,?,?,1,?,?,?,?,?)").run(sessionId, set.exercise_name, resolved.reps, resolved.rep_out_target, resolved.calculated_weight, 12, resolved.calculated_weight, JSON.stringify(resolved.editor));
  });
  execution.applyEditorCompletion({ userId, sessionId });
  database.db.prepare("UPDATE sessions SET completed=1 WHERE id=?").run(sessionId);
  const before = service.getWorkout(userId, sessionId)!;
  const state = database.db.prepare("SELECT * FROM program_editor_progression_state WHERE run_id=?").all(active.runId);
  const events = database.db.prepare("SELECT * FROM program_editor_progression_events WHERE session_id=?").all(sessionId);
  const future = database.db.prepare("SELECT prescription_json FROM workout_occurrences WHERE program_run_id=? ORDER BY slot_index").all(active.runId);
  const changes = [{ setId: before.sets[0].id, actualReps: 1, actualWeight: 40 }];
  const preview = service.previewCorrection(userId, sessionId, changes);
  expect(preview.comparisons[0].previous).not.toEqual(preview.comparisons[0].corrected);
  const input = { userId, sessionId, expectedRevision: before.revision, requestKey: requestKey(), reason: "Typo", sets: changes };
  service.correctWorkout(input); service.correctWorkout(input);
  expect(database.db.prepare("SELECT * FROM program_editor_progression_state WHERE run_id=?").all(active.runId)).toEqual(state);
  expect(database.db.prepare("SELECT * FROM program_editor_progression_events WHERE session_id=?").all(sessionId)).toEqual(events);
  expect(database.db.prepare("SELECT prescription_json FROM workout_occurrences WHERE program_run_id=? ORDER BY slot_index").all(active.runId)).toEqual(future);
  expect(service.getWorkout(userId, sessionId)!.sets.map((set) => [set.reps,set.calculated_weight,set.editor_json])).toEqual(before.sets.map((set) => [set.reps,set.calculated_weight,set.editor_json]));
});

it("appends a physical set to its own exercise, inherits session units, and retries without duplication", () => {
  const initial = row(workout().id, "First");
  const withSecond = service.addQuickExercise({ userId, sessionId: initial.id, name: "Second", sets: [{ reps: 5, weight: 20 }] });
  const input = { userId, sessionId: initial.id, requestKey: requestKey(), name: "First", appendToSetId: initial.sets[0].id, sets: [{ reps: 6, weight: 45 }] };
  const appended = service.addQuickExercise(input);
  expect(appended.sets.map((set) => set.exercise_name)).toEqual(["First", "First", "First", "First", "Second"]);
  expect(appended.sets[3]).toMatchObject({ reps: 6, calculated_weight: 45, actual_reps: null, exercise_key: initial.sets[0].exercise_key });
  expect(service.addQuickExercise(input).sets).toHaveLength(withSecond.sets.length + 1);
});

it("returns current name and date with an actual save so the latest revision never acknowledges stale metadata", () => {
  const session = row(workout("Original name").id);
  service.updateQuickStructure({ userId, sessionId: session.id, expectedRevision: session.revision, name: "Renamed elsewhere", date: "2026-09-03" });
  const result = service.saveActualSet({ userId, sessionId: session.id, setId: session.sets[0].id, actualReps: 8, actualWeight: 40, expectedActual: { reps: null, weight: null } });
  expect(result.sessionMetadata).toEqual({ name: "Renamed elsewhere", date: "2026-09-03", unit: "lb", revision: result.sessionRevision });
});
