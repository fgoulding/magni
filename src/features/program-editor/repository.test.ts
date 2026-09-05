import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let document: typeof import("./document");
let repository: typeof import("./repository");
let migration: typeof import("./migration");
let database: typeof import("@/lib/db");
let directory: string;
let userId: number;
let otherId: number;

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "magni-editor-"));
  vi.stubEnv("DB_PATH", path.join(directory, "editor.sqlite"));
  database = await import("@/lib/db");
  userId = Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('editor@example.com','hash')").run().lastInsertRowid);
  otherId = Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('other@example.com','hash')").run().lastInsertRowid);
  document = await import("./document");
  migration = await import("./migration");
  migration.runProgramEditorMigration(database.db);
  repository = await import("./repository");
});
afterAll(() => { database?.db.close(); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });

function completeDocument() {
  const doc = document.createBlankDocument();
  doc.name = "Direct strength";
  doc.startDate = "2026-09-09";
  doc.weekdays = [1, 4];
  const day = document.createDay("Upper A");
  const exercise = document.createExercise("Dumbbell Row");
  exercise.baseLoad = 40;
  exercise.trainingMax = 100;
  exercise.sets = Array.from({ length: 3 }, () => document.createSet());
  exercise.sets.forEach((set) => { set.repMin = 8; set.repMax = 12; });
  day.exercises = [exercise];
  doc.weeks = [{ ...document.createWeek("Build"), days: [day] }];
  return doc;
}

describe("program editor documents", () => {
  it("creates editable defaults with unique IDs and allows incomplete structural drafts", () => {
    const first = document.createBlankDocument();
    expect(document.validateDraftStructure(first)).toEqual([]);
    expect(document.validateDocument(first).length).toBeGreaterThan(0);
    expect(document.createSet().id).not.toBe(document.createSet().id);
    expect(document.createExercise().progressionKey).not.toBe(document.createExercise().progressionKey);
    expect(document.validateDocument(completeDocument())).toEqual([]);
  });
  it("returns contextual validation for invalid ranges, missing maxes, dates and duplicate IDs", () => {
    const doc = completeDocument();
    doc.startDate = "2026-02-30";
    const exercise = doc.weeks[0].days[0].exercises[0];
    exercise.trainingMax = 0;
    exercise.sets[0].loadMode = "percent";
    exercise.sets[0].repMax = 4;
    exercise.sets[1].id = exercise.sets[0].id;
    const issues = document.validateDocument(doc);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "startDate" }),
      expect.objectContaining({ path: "weeks.0.days.0.exercises.0.trainingMax" }),
      expect.objectContaining({ path: "weeks.0.days.0.exercises.0.sets.0.repMax" }),
      expect.objectContaining({ path: "weeks.0.days.0.exercises.0.sets.1.id" }),
    ]));
  });
  it("rejects structurally hostile documents without throwing", () => {
    for (const value of [null, [], {}, { schemaVersion: 1, weeks: null }, { ...completeDocument(), cycles: Infinity }]) {
      expect(document.validateDraftStructure(value).length).toBeGreaterThan(0);
      expect(document.validateDocument(value).length).toBeGreaterThan(0);
    }
  });
  it("allows copied designated-set rules to share progression after their target IDs are remapped", () => {
    const doc = completeDocument();
    const original = doc.weeks[0].days[0].exercises[0];
    original.sets[1].role = "amrap";
    original.rule = { version: 1, condition: { type: "designated_set", setId: original.sets[1].id, targetReps: 12 }, action: { variable: "load", unit: "lb", operation: "add", amount: 2.5, rounding: { mode: "nearest", quantum: 2.5 }, timing: "per_exposure" } };
    const copied = structuredClone(original);
    copied.id = crypto.randomUUID();
    copied.sets.forEach((set) => { set.id = crypto.randomUUID(); });
    copied.rule!.condition = { type: "designated_set", setId: copied.sets[1].id, targetReps: 12 };
    doc.weeks.push({ ...document.createWeek("Build again"), days: [{ ...document.createDay(), exercises: [copied] }] });
    expect(document.validateDocument(doc)).toEqual([]);
    copied.rule!.condition = { type: "designated_set", setId: copied.sets[0].id, targetReps: 12 };
    expect(document.validateDocument(doc)).toContainEqual(expect.objectContaining({ path: "weeks.1.days.0.exercises.0.progressionKey" }));
  });
  it("rejects designated progression targeting an ordinary work set unsupported by the evaluator", () => {
    const doc = completeDocument();
    const exercise = doc.weeks[0].days[0].exercises[0];
    exercise.rule = { version: 1, condition: { type: "designated_set", setId: exercise.sets[0].id, targetReps: 12 }, action: { variable: "load", unit: "lb", operation: "add", amount: 2.5, rounding: { mode: "nearest", quantum: 2.5 }, timing: "per_exposure" } };
    expect(document.validateDocument(doc)).toContainEqual(expect.objectContaining({ path: "weeks.0.days.0.exercises.0.rule.condition.setId" }));
  });
  it("reports dates whose schedule would exceed the supported calendar range", () => {
    const doc = completeDocument();
    doc.startDate = "9999-12-31";
    expect(document.validateDocument(doc)).toContainEqual(expect.objectContaining({ path: "startDate" }));
  });
});

describe("editor draft persistence and activation", () => {
  it("saves and reloads an incomplete draft with optimistic revisions and safe save retries", () => {
    const id = crypto.randomUUID();
    const doc = document.createBlankDocument();
    const created = repository.saveEditorDraft({ userId, id, expectedRevision: 0, document: doc });
    expect(created.revision).toBe(1);
    expect(repository.getEditorDraft(userId, id)?.document).toEqual(doc);
    expect(repository.saveEditorDraft({ userId, id, expectedRevision: 0, document: doc }).revision).toBe(1);
    const updated = { ...doc, name: "Edited draft" };
    expect(repository.saveEditorDraft({ userId, id, expectedRevision: 1, document: updated }).revision).toBe(2);
    expect(() => repository.saveEditorDraft({ userId, id, expectedRevision: 1, document: { ...doc, name: "Stale tab" } })).toThrow(/changed/i);
    expect(repository.getEditorDraft(userId, id)?.document.name).toBe("Edited draft");
    expect(repository.listEditorDrafts(userId).some((draft) => draft.id === id)).toBe(true);
    expect(() => repository.activateEditorDraft({ userId, id, expectedRevision: 2 })).toThrow(/valid/i);
  });
  it("enforces ownership on reads, saves and activation", () => {
    const id = crypto.randomUUID();
    repository.saveEditorDraft({ userId, id, expectedRevision: 0, document: completeDocument() });
    expect(repository.getEditorDraft(otherId, id)).toBeNull();
    expect(repository.listEditorDrafts(otherId)).toEqual([]);
    expect(() => repository.saveEditorDraft({ userId: otherId, id, expectedRevision: 1, document: completeDocument() })).toThrow(/not found/i);
    expect(() => repository.activateEditorDraft({ userId: otherId, id, expectedRevision: 1 })).toThrow(/not found/i);
  });
  it("activates once into immutable snapshots and schedules logical cycles independently of partial starting weeks", () => {
    const id = crypto.randomUUID();
    const doc = completeDocument();
    doc.cycles = 2;
    doc.weeks.push({ ...document.createWeek("Deload"), deload: true, days: [document.createDay("Easy")] });
    doc.weeks[1].days[0].exercises.push(document.createExercise("Push-up"));
    repository.saveEditorDraft({ userId, id, expectedRevision: 0, document: doc });
    const result = repository.activateEditorDraft({ userId, id, expectedRevision: 1 });
    expect(repository.activateEditorDraft({ userId, id, expectedRevision: 1 })).toEqual(result);
    const occurrences = database.db.prepare("SELECT * FROM workout_occurrences WHERE program_run_id = ? ORDER BY slot_index").all(result.runId) as { week_number: number; day_number: number; scheduled_date: string; prescription_json: string }[];
    expect(occurrences.map((row) => [row.week_number, row.day_number, row.scheduled_date])).toEqual([
      [1, 1, "2026-09-10"], [2, 1, "2026-09-14"], [3, 1, "2026-09-17"], [4, 1, "2026-09-21"],
    ]);
    const firstSet = JSON.parse(occurrences[0].prescription_json)[0];
    expect(firstSet.calculated_weight).toBe(40);
    expect(firstSet.sets).toBe(1);
    expect(firstSet.editor).toMatchObject({ progressionKey: doc.weeks[0].days[0].exercises[0].progressionKey, unit: "lb", versionId: result.versionId });
    expect(JSON.parse(occurrences[1].prescription_json)[0].editor.deload).toBe(true);
    const versionBefore = database.db.prepare("SELECT document_json FROM program_editor_versions WHERE id = ?").get(result.versionId);
    repository.saveEditorDraft({ userId, id, expectedRevision: 1, document: { ...doc, name: "Future changes" } });
    expect(database.db.prepare("SELECT document_json FROM program_editor_versions WHERE id = ?").get(result.versionId)).toEqual(versionBefore);
    expect(() => repository.activateEditorDraft({ userId, id, expectedRevision: 2 })).toThrow(/already active/i);
    expect(database.db.prepare("SELECT editor_version_id FROM program_runs WHERE id = ?").get(result.runId)).toEqual({ editor_version_id: result.versionId });
    expect(database.db.pragma("foreign_key_check")).toEqual([]);
  });
  it("is additive and idempotent when migrating populated programs and completed history", () => {
    const old = new Database(":memory:");
    old.pragma("foreign_keys = ON");
    old.exec(fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
    old.prepare("INSERT INTO users(id,email,password_hash) VALUES (1,'old@example.com','hash')").run();
    old.prepare("INSERT INTO program_definitions(id,owner_user_id,name) VALUES (1,1,'Existing definition')").run();
    old.prepare("INSERT INTO program_runs(id,user_id,name,program_definition_id) VALUES (1,1,'Existing',1)").run();
    old.prepare("INSERT INTO program_run_expected_maxes(program_run_id,shared_exercise_key,expected_max) VALUES (1,'squat',150)").run();
    old.prepare("INSERT INTO programs(id,user_id,name,program_run_id,program_definition_id) VALUES (1,1,'Existing',1,1)").run();
    old.prepare("INSERT INTO sessions(id,user_id,program_id,week_number,date,completed) VALUES (1,1,1,1,'2026-08-01',1)").run();
    old.prepare("INSERT INTO session_sets(session_id,exercise_name,actual_reps,actual_weight,training_max) VALUES (1,'Old Row',10,40,100)").run();
    const before = old.prepare("SELECT exercise_name,actual_reps,actual_weight,training_max FROM session_sets").all();
    expect((old.pragma("table_info(program_runs)") as { name: string }[]).some((column) => column.name === "editor_version_id")).toBe(false);
    migration.runProgramEditorMigration(old);
    migration.runProgramEditorMigration(old);
    expect(old.prepare("SELECT exercise_name,actual_reps,actual_weight,training_max FROM session_sets").all()).toEqual(before);
    expect(old.prepare("SELECT name,editor_version_id FROM program_runs WHERE id = 1").get()).toEqual({ name: "Existing", editor_version_id: null });
    expect(old.prepare("SELECT expected_max FROM program_run_expected_maxes").get()).toEqual({ expected_max: 150 });
    expect(old.pragma("foreign_key_check")).toEqual([]);
    old.close();
  });

  it("rolls back an interrupted activation without creating any partial run or version", () => {
    const id = crypto.randomUUID();
    const doc = { ...completeDocument(), name: "Activation rollback" };
    repository.saveEditorDraft({ userId, id, expectedRevision: 0, document: doc });
    database.db.exec(`CREATE TRIGGER reject_editor_occurrence BEFORE INSERT ON workout_occurrences
      WHEN NEW.program_name = 'Activation rollback' BEGIN SELECT RAISE(ABORT, 'Storage write failed'); END;`);
    try {
      expect(() => repository.activateEditorDraft({ userId, id, expectedRevision: 1 })).toThrow("Storage write failed");
      for (const table of ["programs", "program_runs", "program_definitions"]) expect(database.db.prepare(`SELECT count(*) AS count FROM ${table} WHERE name = ?`).get(doc.name)).toEqual({ count: 0 });
      expect(database.db.prepare("SELECT count(*) AS count FROM program_editor_versions WHERE draft_id = ?").get(id)).toEqual({ count: 0 });
      expect(repository.getEditorDraft(userId, id)?.revision).toBe(1);
    } finally { database.db.exec("DROP TRIGGER reject_editor_occurrence"); }
    expect(repository.activateEditorDraft({ userId, id, expectedRevision: 1 }).programId).toBeGreaterThan(0);
  });

  it("materializes all load modes and preserves roles, ranges, effort, supersets and notes exactly", () => {
    const id = crypto.randomUUID();
    const doc = completeDocument();
    const exercise = doc.weeks[0].days[0].exercises[0];
    exercise.supersetGroup = "A";
    exercise.notes = "Strict form";
    exercise.sets = (["working", "fixed", "percent", "bodyweight", "added"] as const).map((loadMode, index) => ({
      ...document.createSet(), loadMode, load: loadMode === "percent" ? 150 : 20,
      role: (["warmup", "work", "top", "backoff", "amrap"] as const)[index], effortKind: "rir", effort: 2, tempo: "3-1-1", notes: "Controlled",
    }));
    repository.saveEditorDraft({ userId, id, expectedRevision: 0, document: doc });
    const result = repository.activateEditorDraft({ userId, id, expectedRevision: 1 });
    const row = database.db.prepare("SELECT prescription_json FROM workout_occurrences WHERE program_run_id = ?").get(result.runId) as { prescription_json: string };
    const sets = JSON.parse(row.prescription_json) as import("./repository").EditorPrescriptionSet[];
    expect(sets.map((set) => set.calculated_weight)).toEqual([40, 20, 150, 0, 20]);
    expect(sets.map((set) => set.editor.set)).toEqual(exercise.sets);
    expect(sets.every((set) => set.superset_group === "A" && set.editor.initialReps === 8)).toBe(true);
    const state = database.db.prepare("SELECT state_json FROM program_editor_progression_state WHERE run_id = ? AND progression_key = ?").get(result.runId, exercise.progressionKey) as { state_json: string };
    expect(JSON.parse(state.state_json)).toEqual({ load: 40, trainingMax: 100, reps: 8, consecutiveFailures: 0, lastEvaluatedWeek: null });
    expect(() => database.db.prepare("UPDATE program_editor_versions SET document_json = '{}' WHERE id = ?").run(result.versionId)).toThrow(/immutable/);
  });

  it("rejects malformed save identities, unsafe structure and stale activation revisions", () => {
    const id = crypto.randomUUID();
    const doc = completeDocument();
    expect(() => repository.saveEditorDraft({ userId, id: "bad", expectedRevision: 0, document: doc })).toThrow(/UUID/);
    expect(() => repository.saveEditorDraft({ userId, id, expectedRevision: -1, document: doc })).toThrow(/revision/);
    expect(() => repository.saveEditorDraft({ userId, id, expectedRevision: 0, document: null })).toThrow(/structure/);
    repository.saveEditorDraft({ userId, id, expectedRevision: 0, document: doc });
    expect(() => repository.activateEditorDraft({ userId, id, expectedRevision: 0 })).toThrow(/changed/);
    expect(repository.getEditorDraft(userId, crypto.randomUUID())).toBeNull();
  });

  it("freezes one shared rep baseline while retaining later per-week range overrides", () => {
    const id = crypto.randomUUID();
    const doc = completeDocument();
    const first = doc.weeks[0].days[0].exercises[0];
    first.rule = { version: 1, condition: { type: "all_work_sets", target: "maximum" }, action: { variable: "reps", unit: "reps", operation: "add", amount: 1, rounding: { mode: "nearest", quantum: 1 }, timing: "per_exposure" } };
    const second = structuredClone(first);
    second.id = crypto.randomUUID();
    second.sets.forEach((set) => { set.id = crypto.randomUUID(); set.repMin = 10; set.repMax = 15; });
    doc.weeks.push({ ...document.createWeek("Higher reps"), days: [{ ...document.createDay(), exercises: [second] }] });
    repository.saveEditorDraft({ userId, id, expectedRevision: 0, document: doc });
    const activation = repository.activateEditorDraft({ userId, id, expectedRevision: 1 });
    const rows = database.db.prepare("SELECT prescription_json FROM workout_occurrences WHERE program_run_id = ? ORDER BY slot_index").all(activation.runId) as { prescription_json: string }[];
    const targets = rows.map((row) => JSON.parse(row.prescription_json)[0].editor);
    expect(targets.map((target) => target.initialReps)).toEqual([8, 8]);
    expect(targets.map((target) => [target.set.repMin, target.set.repMax])).toEqual([[8, 12], [10, 15]]);
  });
  it("retains decimal percentage precision in the initial prescription", () => {
    const id = crypto.randomUUID();
    const doc = completeDocument();
    const exercise = doc.weeks[0].days[0].exercises[0];
    exercise.trainingMax = 333.33;
    exercise.sets[0].loadMode = "percent";
    exercise.sets[0].load = 67.123;
    repository.saveEditorDraft({ userId, id, expectedRevision: 0, document: doc });
    const result = repository.activateEditorDraft({ userId, id, expectedRevision: 1 });
    const row = database.db.prepare("SELECT prescription_json FROM workout_occurrences WHERE program_run_id = ?").get(result.runId) as { prescription_json: string };
    expect(JSON.parse(row.prescription_json)[0].calculated_weight).toBe(223.7410959);
  });
});
