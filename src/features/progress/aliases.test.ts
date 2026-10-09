import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { runMigrations } from "@/lib/db/migrations";

let database: typeof import("@/lib/db");
let history: typeof import("@/features/workouts/history-service");
let identity: typeof import("./identity");
let queries: typeof import("./queries");
let directory: string;
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "magni-owned-aliases-"));
  vi.stubEnv("DB_PATH", path.join(directory, "test.sqlite"));
  database = await import("@/lib/db");
  history = await import("@/features/workouts/history-service");
  identity = await import("./identity");
  queries = await import("./queries");
});
afterAll(() => { database?.db.close(); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const owner = () => Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES (?,'hash')").run(`${crypto.randomUUID()}@example.test`).lastInsertRowid);
function workout(userId: number, name: string, date = "2026-10-01", catalogExerciseId?: string) {
  const session = history.createQuickSession({ userId, date, newWorkout: true }).session;
  const result = history.addQuickExercise({ userId, sessionId: session.id, name, catalogExerciseId, sets: [{ reps: 5, weight: 100 }] });
  history.saveActualSet({ userId, sessionId: session.id, setId: result.addedSetIds[0], actualReps: 5, actualWeight: 100 });
  history.finishQuickSession(userId, session.id);
  return { sessionId: session.id, setId: result.addedSetIds[0], id: identity.resolveSetExerciseIdentities(userId, session.id).get(result.addedSetIds[0])!.exerciseId };
}
function legacyRecord(userId: number, name: string, date: string, kind = "quick", family?: string) {
  const sessionId = Number(database.db.prepare("INSERT INTO sessions(user_id,date,week_number,status,completed,unit) VALUES (?,?,1,'completed',1,'kg')").run(userId, date).lastInsertRowid);
  const id = crypto.randomUUID(), source = `${kind}:${crypto.randomUUID()}`;
  const metadata = family ? JSON.stringify({ exerciseId: crypto.randomUUID(), set: { loadMode: family, role: "work" } }) : null;
  const setId = Number(database.db.prepare("INSERT INTO session_sets(session_id,exercise_name,exercise_key,actual_reps,actual_weight,sets,editor_json) VALUES (?,?,?,5,100,1,?)").run(sessionId, name, crypto.randomUUID(), metadata).lastInsertRowid);
  database.db.prepare("INSERT INTO exercise_catalog(id,user_id,name,origin) VALUES (?,?,?,?)").run(id, userId, name, kind === "legacy" ? "lineage" : "unlinked");
  database.db.prepare("INSERT INTO exercise_sources(user_id,source_key,exercise_id,kind) VALUES (?,?,?,?)").run(userId, source, id, kind);
  database.db.prepare("INSERT INTO exercise_set_sources(session_set_id,user_id,source_key,observation_key,exercise_id) VALUES (?,?,?,?,?)").run(setId, userId, source, source, id);
  return { id, sessionId, setId, source };
}

it("automatically reuses exact normalized names and narrow aliases without changing saved labels", () => {
  const userId = owner();
  const first = workout(userId, "Deadlift", "2026-02-03");
  const next = workout(userId, "  DEADLIFT  ", "2026-09-02");
  const alias = workout(userId, "Dead lift", "2026-10-01");
  expect(new Set([first.id, next.id, alias.id])).toEqual(new Set([first.id]));
  expect(queries.getExerciseDetail(userId, first.id, { period: "all" })?.chart.totalObservations).toBe(3);
  expect(queries.listProgressExercises(userId).items).toMatchObject([{ kind: "exercise", historyCount: 3 }]);
  expect(database.db.prepare("SELECT exercise_name FROM session_sets WHERE id=?").get(next.setId)).toEqual({ exercise_name: "DEADLIFT" });
  expect(workout(userId, "Sumo deadlift").id).not.toBe(first.id);
  expect(workout(userId, "Romanian deadlift").id).not.toBe(first.id);
  const bench = workout(userId, "Bench");
  expect(workout(userId, "Bench press").id).toBe(bench.id);
  expect(workout(userId, "Incline bench press").id).not.toBe(bench.id);
  expect(workout(owner(), "Deadlift").id).not.toBe(first.id);
});

it("migrates old planned and quick history, preserving saved data and old IDs", () => {
  const userId = owner();
  const a = legacyRecord(userId, "Deadlift", "2026-02-03", "legacy");
  const b = legacyRecord(userId, "Deadlift", "2026-09-02");
  const c = legacyRecord(userId, "Deadlift", "2026-10-01");
  identity.updateExercisePin(userId, { exerciseId: c.id, pinned: true });
  const tables = ["sessions", "session_sets", "user_settings", "workout_mutation_requests", "workout_corrections", "program_editor_progression_state", "program_editor_progression_events"];
  const before = tables.map(table => database.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  database.db.pragma("user_version=5");
  runMigrations(database.db);
  expect(database.db.pragma("user_version", { simple: true })).toBe(6);
  expect(tables.map(table => database.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())).toEqual(before);
  const ids = [a, b, c].map(row => identity.resolveSetExerciseIdentities(userId, row.sessionId).get(row.setId)!.exerciseId);
  expect(new Set(ids).size).toBe(1);
  for (const previous of [a, b, c]) {
    expect(queries.getExerciseDetail(userId, previous.id, { period: "all" })?.chart.totalObservations).toBe(3);
    expect(identity.requireOwnedExercise(userId, previous.id).id).toBe(ids[0]);
  }
  expect(identity.getPinnedExerciseIds(userId)).toEqual([ids[0]]);
  expect(workout(userId, "Deadlift", "2026-10-02", b.id).id).toBe(ids[0]);
  expect(workout(userId, "Deadlift", "2026-10-03").id).toBe(ids[0]);
  const after = database.db.prepare("SELECT * FROM exercise_set_sources ORDER BY session_set_id").all();
  runMigrations(database.db);
  expect(database.db.prepare("SELECT * FROM exercise_set_sources ORDER BY session_set_id").all()).toEqual(after);
  expect(database.db.pragma("foreign_key_check")).toEqual([]);
  expect(() => identity.requireOwnedExercise(owner(), b.id)).toThrow(/not found/i);
});

it("returns all-history primary lifts in a fixed order, independent of pins and selected dates", () => {
  const userId = owner();
  const deadlift = workout(userId, "Deadlift", "2026-02-03");
  const bench = workout(userId, "Bench press", "2026-03-03");
  workout(userId, "Latest other exercise", "2026-10-01");
  const primary = queries.getProgressHome(userId, { period: "4w" }, new Date("2026-10-02T12:00:00Z")).primary;
  expect(primary).toMatchObject([
    { key: "p:squat", name: "Squat", hasHistory: false, exercise: null },
    { key: "p:bench", name: "Bench", hasHistory: true, exercise: { id: bench.id, sessionCount: 1 } },
    { key: "p:deadlift", name: "Deadlift", hasHistory: true, exercise: { id: deadlift.id, sessionCount: 1 } },
  ]);
});

it("preserves an explicit separation through new workouts and migration; pins never change membership", () => {
  const userId = owner();
  const a = workout(userId, "Deadlift");
  const b = workout(userId, "Deadlift", "2026-10-02", a.id);
  const input = { mode: "detach" as const, observationIds: [b.setId] };
  const preview = identity.previewExerciseLink(userId, input);
  identity.applyExerciseLink(userId, { ...input, previewToken: preview.token, requestKey: crypto.randomUUID() });
  const separated = identity.resolveSetExerciseIdentities(userId, b.sessionId).get(b.setId)!.exerciseId;
  const before = queries.listProgressExercises(userId).items.map(row => [row.key, row.kind, row.historyCount]);
  identity.updateExercisePin(userId, { exerciseId: separated, pinned: true });
  expect(queries.listProgressExercises(userId).items.map(row => [row.key, row.kind, row.historyCount])).toEqual(before);
  expect(queries.getProgressHome(userId).primary[2]).toMatchObject({ hasHistory: true, exercise: null });
  runMigrations(database.db);
  workout(userId, "Deadlift", "2026-10-03");
  expect(identity.resolveSetExerciseIdentities(userId, b.sessionId).get(b.setId)!.exerciseId).toBe(separated);
  expect(separated).not.toBe(a.id);
});

it("backfills compatible external lifts but leaves explicit added/bodyweight families separate", () => {
  const userId = owner();
  const a = legacyRecord(userId, "Deadlift", "2026-02-03", "legacy");
  const b = legacyRecord(userId, "Deadlift", "2026-09-02", "editor", "working");
  const added = legacyRecord(userId, "Deadlift", "2026-10-01", "editor", "added");
  const bodyweight = legacyRecord(userId, "Deadlift", "2026-10-01", "editor", "bodyweight");
  runMigrations(database.db);
  const resolve = (row: typeof a) => identity.resolveSetExerciseIdentities(userId, row.sessionId).get(row.setId)!.exerciseId;
  expect(resolve(a)).toBe(resolve(b));
  expect(new Set([resolve(a), resolve(added), resolve(bodyweight)]).size).toBe(3);
  expect(queries.getProgressHome(userId).primary[2]).toMatchObject({ hasHistory: true, exercise: null });
});

it("preserves historical manual links and their undo across a schema upgrade", () => {
  const userId = owner();
  const a = legacyRecord(userId, "Deadlift", "2026-02-03", "legacy");
  const b = legacyRecord(userId, "Deadlift", "2026-09-02");
  const c = legacyRecord(userId, "Deadlift", "2026-10-01");
  const input = { observationIds: [b.setId], targetExerciseId: a.id };
  const preview = identity.previewExerciseLink(userId, input);
  const changed = identity.applyExerciseLink(userId, { ...input, previewToken: preview.token, requestKey: crypto.randomUUID() });
  const before = database.db.prepare("SELECT * FROM exercise_identity_changes WHERE user_id=?").all(userId);
  runMigrations(database.db);
  expect(identity.resolveSetExerciseIdentities(userId, b.sessionId).get(b.setId)!.exerciseId).toBe(a.id);
  expect(identity.resolveSetExerciseIdentities(userId, c.sessionId).get(c.setId)!.exerciseId).toBe(c.id);
  expect(database.db.prepare("SELECT * FROM exercise_identity_changes WHERE user_id=?").all(userId)).toEqual(before);
  expect(identity.undoExerciseLink(userId, { changeId: changed.changeId, requestKey: crypto.randomUUID() }).undone).toBe(true);
  expect(identity.resolveSetExerciseIdentities(userId, b.sessionId).get(b.setId)!.exerciseId).toBe(b.id);
});

it("retains old-ID pagination after consolidation and reuses saved routines and retry payloads", () => {
  const userId = owner();
  const a = legacyRecord(userId, "Deadlift", "2026-02-03", "legacy");
  const b = legacyRecord(userId, "Deadlift", "2026-09-02");
  const c = legacyRecord(userId, "Deadlift", "2026-10-01");
  database.db.prepare("UPDATE exercise_set_sources SET exercise_id=? WHERE session_set_id=?").run(b.id, c.setId);
  database.db.prepare("UPDATE exercise_sources SET exercise_id=? WHERE user_id=? AND source_key=?").run(b.id, userId, c.source);
  const beforePage = queries.getExerciseDetail(userId, b.id, { period: "all", limit: 1 })!;
  expect(beforePage.observations.nextCursor).not.toBeNull();
  const routine = history.saveRoutine({ userId, sessionId: b.sessionId, name: "Saved deadlift" });
  const saved = database.db.prepare("SELECT prescription_json FROM workout_routines WHERE id=?").get(routine.id);
  runMigrations(database.db);
  expect(queries.getExerciseDetail(userId, b.id, { period: "all", limit: 1, cursor: beforePage.observations.nextCursor! })?.observations.items).toHaveLength(1);
  expect(database.db.prepare("SELECT prescription_json FROM workout_routines WHERE id=?").get(routine.id)).toEqual(saved);
  const repeated = history.createQuickSession({ userId, routineId: routine.id, date: "2026-10-02" }).session;
  expect(identity.resolveSetExerciseIdentities(userId, repeated.id).get(repeated.sets[0].id)!.exerciseId).toBe(a.id);
  const request = { userId, sessionId: repeated.id, catalogExerciseId: b.id, name: "Deadlift", requestKey: crypto.randomUUID(), sets: [{ reps: 5, weight: 110 }] };
  const added = history.addQuickExercise(request);
  expect(history.addQuickExercise(request)).toEqual(added);
});

it("restores automatic matching after detach then Undo, including later migration repair", () => {
  const userId = owner(), a = workout(userId, "Deadlift"), b = workout(userId, "Deadlift");
  const input = { mode: "detach" as const, observationIds: [b.setId] };
  const changed = identity.applyExerciseLink(userId, { ...input, previewToken: identity.previewExerciseLink(userId, input).token, requestKey: crypto.randomUUID() });
  const undo = { changeId: changed.changeId, requestKey: crypto.randomUUID() };
  const result = identity.undoExerciseLink(userId, undo);
  expect(identity.undoExerciseLink(userId, undo)).toEqual(result);
  expect(workout(userId, "Deadlift").id).toBe(a.id);
  runMigrations(database.db);
  expect(workout(userId, "Dead lift").id).toBe(a.id);
});

it("rejects Undo atomically when a new same-name workout was created while matching was blocked", () => {
  const userId = owner(), a = workout(userId, "Deadlift"), b = workout(userId, "Deadlift");
  const input = { mode: "detach" as const, observationIds: [b.setId] };
  const changed = identity.applyExerciseLink(userId, { ...input, previewToken: identity.previewExerciseLink(userId, input).token, requestKey: crypto.randomUUID() });
  const separatedId = identity.resolveSetExerciseIdentities(userId, b.sessionId).get(b.setId)!.exerciseId;
  const subsequent = workout(userId, "Deadlift");
  expect(subsequent.id).not.toBe(a.id);
  const before = database.db.prepare("SELECT * FROM exercise_set_sources WHERE user_id=? ORDER BY session_set_id").all(userId);
  expect(() => identity.undoExerciseLink(userId, { changeId: changed.changeId, requestKey: crypto.randomUUID() })).toThrow(/changed/i);
  expect(database.db.prepare("SELECT * FROM exercise_set_sources WHERE user_id=? ORDER BY session_set_id").all(userId)).toEqual(before);
  expect(identity.resolveSetExerciseIdentities(userId, b.sessionId).get(b.setId)!.exerciseId).toBe(separatedId);
});

it("rejects an older Undo after a separate matching-name identity decision", () => {
  const userId = owner(), a = workout(userId, "Deadlift"), b = workout(userId, "Deadlift"), c = workout(userId, "Deadlift");
  const detach = (setId: number) => {
    const input = { mode: "detach" as const, observationIds: [setId] };
    return identity.applyExerciseLink(userId, { ...input, previewToken: identity.previewExerciseLink(userId, input).token, requestKey: crypto.randomUUID() });
  };
  const first = detach(b.setId), second = detach(c.setId);
  expect(() => identity.undoExerciseLink(userId, { changeId: first.changeId, requestKey: crypto.randomUUID() })).toThrow(/changed/i);
  identity.undoExerciseLink(userId, { changeId: second.changeId, requestKey: crypto.randomUUID() });
  expect(identity.resolveSetExerciseIdentities(userId, c.sessionId).get(c.setId)!.exerciseId).toBe(a.id);
  expect(workout(userId, "Deadlift").id).not.toBe(a.id);
});

it("keeps Undo available after unrelated training, actual corrections and pin preferences", () => {
  const userId = owner(), a = workout(userId, "Deadlift"), b = workout(userId, "Deadlift");
  const input = { mode: "detach" as const, observationIds: [b.setId] };
  const changed = identity.applyExerciseLink(userId, { ...input, previewToken: identity.previewExerciseLink(userId, input).token, requestKey: crypto.randomUUID() });
  workout(userId, "Bench");
  identity.updateExercisePin(userId, { exerciseId: a.id, pinned: true });
  database.db.prepare("UPDATE session_sets SET actual_reps=7 WHERE id=?").run(a.setId);
  identity.undoExerciseLink(userId, { changeId: changed.changeId, requestKey: crypto.randomUUID() });
  expect(workout(userId, "Deadlift").id).toBe(a.id);
});


it("explains how an explicit grouping choice affects adding future workouts", () => {
  const userId = owner(), saved = workout(userId, "Deadlift");
  const preview = identity.previewExerciseLink(userId, { mode: "detach", observationIds: [saved.setId] });
  expect(preview.explanation).toBe("Only selected workouts change grouping. Recorded sets and program progression stay unchanged. Choose the saved exercise when adding future workouts to keep the history you want.");
});

it.each(["object", "array"])("retains Undo support for older %s audit snapshots without alias metadata", format => {
  const userId = owner(), a = workout(userId, "Deadlift"), b = workout(userId, "Deadlift");
  const input = { mode: "detach" as const, observationIds: [b.setId] };
  const changed = identity.applyExerciseLink(userId, { ...input, previewToken: identity.previewExerciseLink(userId, input).token, requestKey: crypto.randomUUID() });
  const audit = database.db.prepare("SELECT before_json,after_json FROM exercise_identity_changes WHERE id=?").get(changed.changeId) as { before_json: string; after_json: string };
  const old = (json: string) => {
    const value = JSON.parse(json); delete value.aliases;
    return JSON.stringify(format === "array" ? value.sets : value);
  };
  database.db.prepare("UPDATE exercise_identity_changes SET before_json=?,after_json=? WHERE id=?").run(old(audit.before_json), old(audit.after_json), changed.changeId);
  expect(identity.undoExerciseLink(userId, { changeId: changed.changeId, requestKey: crypto.randomUUID() }).undone).toBe(true);
  expect(identity.resolveSetExerciseIdentities(userId, b.sessionId).get(b.setId)!.exerciseId).toBe(a.id);
});
