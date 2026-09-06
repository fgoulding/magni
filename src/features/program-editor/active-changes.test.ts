import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cloneWeek, applySharedConfiguration, makePreset } from "./operations";
import { createExercise } from "./document";
import type { EditorPrescriptionSet } from "./repository";

let db: (typeof import("@/lib/db"))["db"];
let repository: typeof import("./repository");
let execution: typeof import("./execution");
let changes: typeof import("./active-changes");
let directory: string;
let userId: number;
let otherId: number;
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "magni-active-changes-"));
  vi.stubEnv("DB_PATH", path.join(directory, "test.sqlite"));
  db = (await import("@/lib/db")).db;
  repository = await import("./repository");
  execution = await import("./execution");
  changes = await import("./active-changes");
  userId = Number(db.prepare("INSERT INTO users(email,password_hash) VALUES ('active-change-owner@example.test','hash')").run().lastInsertRowid);
  otherId = Number(db.prepare("INSERT INTO users(email,password_hash) VALUES ('active-change-other@example.test','hash')").run().lastInsertRowid);
});
afterAll(() => { db?.close(); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });

type Row = { id: number; scheduled_date: string; original_date: string; week_number: number; day_number: number; slot_index: number; status: string; prescription_json: string; revision: number; definition_day_id: number; legacy_day_id: number };
function fixture() {
  const doc = makePreset("double", "2026-09-05");
  doc.weekdays = [0, 1, 2, 3, 4, 5, 6];
  doc.weeks = [0, 1, 2, 3].map(index => ({ ...cloneWeek(doc.weeks[0]), name: `Week ${index + 1}`, block: index === 3 ? "Recovery" : "Build" }));
  doc.cycles = 2;
  const draftId = crypto.randomUUID();
  repository.saveEditorDraft({ userId, id: draftId, expectedRevision: 0, document: doc });
  const activation = repository.activateEditorDraft({ userId, id: draftId, expectedRevision: 1 });
  const rows = () => db.prepare("SELECT * FROM workout_occurrences WHERE program_run_id=? ORDER BY week_number,day_number,id").all(activation.runId) as Row[];
  const source = doc.weeks[0].days[0].exercises[0];
  source.baseLoad = 50; source.rule!.action.amount = 5;
  applySharedConfiguration(doc, source);
  repository.saveEditorDraft({ userId, id: draftId, expectedRevision: 1, document: doc });
  const input = { userId, programId: activation.programId, draftId, expectedDraftRevision: 2, scope: "occurrence" as const, occurrenceId: rows()[0].id, progressionState: "preserve" as const };
  return { doc, draftId, activation, rows, input };
}
function apply(input: Parameters<typeof changes.previewActiveEditorChanges>[0]) {
  const preview = changes.previewActiveEditorChanges(input);
  const request = { ...input, expectedPreviewToken: preview.previewToken, requestKey: crypto.randomUUID() };
  return { preview, request, result: changes.applyActiveEditorChanges(request) };
}
function prescribed(row: Row) { return JSON.parse(row.prescription_json) as EditorPrescriptionSet[]; }

describe("reviewed edits to active editor programs", () => {
  it("previews and applies one occurrence without changing its dates or logical identity", () => {
    const f = fixture(); const before = f.rows();
    const preview = changes.previewActiveEditorChanges(f.input);
    expect(preview.affected.map(row => row.occurrenceId)).toEqual([before[0].id]);
    expect(f.rows()).toEqual(before);
    const { result } = apply(f.input);
    expect(result.revisionId).toBeGreaterThan(0);
    const after = f.rows();
    expect(after[0]).toMatchObject({ id: before[0].id, scheduled_date: before[0].scheduled_date, original_date: before[0].original_date, week_number: before[0].week_number, day_number: before[0].day_number, slot_index: before[0].slot_index, revision: before[0].revision + 1 });
    expect(after.slice(1)).toEqual(before.slice(1));
    expect(prescribed(after[0])[0].editor.rule!.action.amount).toBe(5);
    expect(prescribed(after[0])[0].editor.revisionId).toBe(result.revisionId);
    expect(execution.resolveEditorPrescription(prescribed(after[0])[0], f.activation.runId).calculated_weight).toBe(40);
    expect(() => db.prepare("UPDATE program_editor_revisions SET document_json='{}' WHERE id=?").run(result.revisionId)).toThrow(/immutable/i);
  });

  it("limits remaining block by logical cycle and excludes protected workouts even after a move", () => {
    const f = fixture(); const before = f.rows();
    db.prepare("UPDATE workout_occurrences SET status='in_progress' WHERE id=?").run(before[1].id);
    db.prepare("UPDATE workout_occurrences SET status='skipped' WHERE id=?").run(before[2].id);
    db.prepare("UPDATE workout_occurrences SET scheduled_date='2030-01-01',moved=1,revision=revision+1 WHERE id=?").run(before[0].id);
    const snapshots = f.rows();
    const { preview } = apply({ ...f.input, scope: "remaining_block" });
    expect(preview.affected.map(row => row.occurrenceId)).toEqual([before[0].id]);
    expect(preview.excluded.map(row => row.occurrenceId)).toEqual([before[1].id, before[2].id]);
    expect(f.rows().slice(1)).toEqual(snapshots.slice(1));
    expect(f.rows()[0].scheduled_date).toBe("2030-01-01");
  });
  it("edits a Calendar duplicate using its original logical day instead of the first program day", async () => {
    const f = fixture(); const original = f.rows()[1];
    const { applyCalendarAction } = await import("@/features/calendar/calendar-service");
    const result = applyCalendarAction(userId, { type: "duplicate", occurrenceId: original.id, revision: original.revision, date: "2030-03-01", requestKey: crypto.randomUUID(), collision: "move" });
    const duplicateId = result.changes[0].id;
    const source = f.doc.weeks[1].days[0];
    source.name = "Second week override";
    source.exercises[0].sets.forEach(set => { set.loadMode = "fixed"; set.load = 77; });
    repository.saveEditorDraft({ userId, id: f.draftId, expectedRevision: 2, document: f.doc });
    const listed = changes.listActiveEditorChanges(userId, f.activation.programId).occurrences.find(row => row.occurrenceId === duplicateId)!;
    expect(listed.weekId).toBe(f.doc.weeks[1].id);
    const input = { ...f.input, expectedDraftRevision: 3, occurrenceId: duplicateId };
    expect(() => changes.previewActiveEditorChanges({ ...input, scope: "remaining_block" })).toThrow(/extra|copy|scheduled program/i);
    const { preview } = apply(input);
    expect(preview.affected[0].newName).toBe("Second week override");
    expect(preview.affected[0].after[0].calculated_weight).toBe(77);
    expect(preview.affected[0].after[0].editor.exerciseId).toBe(source.exercises[0].id);
  });

  it("preserves shared progression inside the changed block and isolates its new rule from old sessions", () => {
    const f = fixture(); const oldKey = prescribed(f.rows()[0])[0].editor.progressionKey;
    apply({ ...f.input, scope: "remaining_block" });
    const rows = f.rows(); const newKeys = rows.slice(0, 3).map(row => prescribed(row)[0].editor.progressionKey);
    expect(new Set(newKeys).size).toBe(1);
    expect(newKeys[0]).not.toBe(oldKey);
    expect(prescribed(rows[3])[0].editor.progressionKey).toBe(oldKey);
    db.prepare("UPDATE program_editor_progression_state SET state_json=json_set(state_json,'$.load',70),revision=revision+1 WHERE run_id=? AND progression_key=?").run(f.activation.runId, oldKey);
    expect(execution.resolveEditorPrescription(prescribed(rows[0])[0], f.activation.runId).calculated_weight).toBe(40);
  });

  it("can explicitly reset to edited starting values and clears the failure streak", () => {
    const f = fixture(); const key = prescribed(f.rows()[0])[0].editor.progressionKey;
    db.prepare("UPDATE program_editor_progression_state SET state_json=json_set(state_json,'$.load',42.5,'$.consecutiveFailures',2),revision=revision+1 WHERE run_id=? AND progression_key=?").run(f.activation.runId, key);
    const { preview } = apply({ ...f.input, progressionState: "use_draft" });
    expect(preview.progressionChanges[0].beforeState.load).toBe(42.5);
    expect(preview.progressionChanges[0].afterState).toMatchObject({ load: 50, consecutiveFailures: 0, lastEvaluatedWeek: null });
    expect(execution.resolveEditorPrescription(prescribed(f.rows()[0])[0], f.activation.runId).calculated_weight).toBe(50);
  });
  it("rejoins scoped appearances when explicitly resetting to the draft shared progression", () => {
    const f = fixture();
    apply(f.input);
    expect(prescribed(f.rows()[0])[0].editor.progressionKey).not.toBe(prescribed(f.rows()[1])[0].editor.progressionKey);
    apply({ ...f.input, scope: "remaining_block", progressionState: "use_draft" });
    const keys = f.rows().slice(0, 3).map(row => prescribed(row)[0].editor.progressionKey);
    expect(new Set(keys).size).toBe(1);
    expect(f.rows().slice(0, 3).map(row => execution.resolveEditorPrescription(prescribed(row)[0], f.activation.runId).calculated_weight)).toEqual([50, 50, 50]);
  });
  it("previews the same decimal percentage load that the pending workout resolves", () => {
    const f = fixture();
    for (const week of f.doc.weeks) for (const exercise of week.days[0].exercises) {
      exercise.trainingMax = 123.45;
      exercise.sets.forEach(set => { set.loadMode = "percent"; set.load = 67.3; });
    }
    repository.saveEditorDraft({ userId, id: f.draftId, expectedRevision: 2, document: f.doc });
    const { preview } = apply({ ...f.input, expectedDraftRevision: 3, progressionState: "use_draft" });
    expect(preview.affected[0].after[0].calculated_weight).toBe(execution.resolveEditorPrescription(prescribed(f.rows()[0])[0], f.activation.runId).calculated_weight);
  });
  it("uses edited rep targets exactly when resetting a rep progression", () => {
    const f = fixture();
    for (const week of f.doc.weeks) {
      const exercise = week.days[0].exercises[0];
      exercise.rule!.action.variable = "reps"; exercise.rule!.action.unit = "reps";
      exercise.rule!.action.amount = 1; exercise.rule!.action.rounding.quantum = 1;
      exercise.sets.forEach(set => { set.repMin = 9; set.repMax = 12; });
    }
    repository.saveEditorDraft({ userId, id: f.draftId, expectedRevision: 2, document: f.doc });
    const { preview } = apply({ ...f.input, expectedDraftRevision: 3, progressionState: "use_draft" });
    expect(preview.affected[0].after[0].reps).toBe(9);
    expect(execution.resolveEditorPrescription(prescribed(f.rows()[0])[0], f.activation.runId).reps).toBe(9);
  });
  it("requires an explicit reset for a unit change after a previous active revision", () => {
    const f = fixture();
    f.doc.unit = "kg";
    for (const week of f.doc.weeks) week.days[0].exercises[0].rule!.action.unit = "kg";
    repository.saveEditorDraft({ userId, id: f.draftId, expectedRevision: 2, document: f.doc });
    apply({ ...f.input, expectedDraftRevision: 3, progressionState: "use_draft" });
    expect(() => changes.previewActiveEditorChanges({ ...f.input, expectedDraftRevision: 3 })).not.toThrow();
    f.doc.unit = "lb";
    for (const week of f.doc.weeks) week.days[0].exercises[0].rule!.action.unit = "lb";
    repository.saveEditorDraft({ userId, id: f.draftId, expectedRevision: 3, document: f.doc });
    expect(() => changes.previewActiveEditorChanges({ ...f.input, expectedDraftRevision: 4 })).toThrow(/units|convert|starting/i);
  });

  it("keeps deliberate sharing for prescription-only overrides with an unchanged rule", () => {
    const f = fixture(); const original = JSON.parse((db.prepare("SELECT document_json FROM program_editor_versions WHERE id=?").get(f.activation.versionId) as { document_json: string }).document_json);
    original.weeks[0].days[0].exercises[0].sets[0].repMin = 9;
    repository.saveEditorDraft({ userId, id: f.draftId, expectedRevision: 2, document: original });
    const old = prescribed(f.rows()[0])[0].editor.progressionKey;
    apply({ ...f.input, expectedDraftRevision: 3 });
    expect(prescribed(f.rows()[0])[0].editor.progressionKey).toBe(old);
    expect(prescribed(f.rows()[0])[0].reps).toBe(9);
  });

  it.each(["draft", "occurrence", "state"])("rejects a stale preview after a %s change", kind => {
    const f = fixture(); const preview = changes.previewActiveEditorChanges(f.input);
    if (kind === "draft") { f.doc.description = "New remote edit"; repository.saveEditorDraft({ userId, id: f.draftId, expectedRevision: 2, document: f.doc }); }
    if (kind === "occurrence") db.prepare("UPDATE workout_occurrences SET revision=revision+1 WHERE id=?").run(f.input.occurrenceId);
    if (kind === "state") db.prepare("UPDATE program_editor_progression_state SET revision=revision+1 WHERE run_id=?").run(f.activation.runId);
    expect(() => changes.applyActiveEditorChanges({ ...f.input, expectedPreviewToken: preview.previewToken, requestKey: crypto.randomUUID() })).toThrow(/changed|review|revision/i);
  });

  it("returns the exact committed result on lost-response retry and rejects key reuse for another payload", () => {
    const f = fixture(); const { request, result } = apply(f.input); const saved = f.rows();
    expect(changes.applyActiveEditorChanges(request)).toEqual(result);
    expect(f.rows()).toEqual(saved);
    expect(() => changes.applyActiveEditorChanges({ ...request, scope: "remaining_block" })).toThrow(/request|different|reuse/i);
  });

  it("adds, removes and reorders sets/exercises through owned immutable mapping", () => {
    const f = fixture(); const day = f.doc.weeks[0].days[0];
    const added = createExercise("Press"); added.sets = added.sets.slice(0, 1);
    day.exercises[0].sets = day.exercises[0].sets.slice(0, 2);
    day.exercises.unshift(added);
    repository.saveEditorDraft({ userId, id: f.draftId, expectedRevision: 2, document: f.doc });
    apply({ ...f.input, expectedDraftRevision: 3 });
    const sets = prescribed(f.rows()[0]);
    expect(sets.map(set => set.exercise_name)).toEqual(["Press", "Dumbbell row", "Dumbbell row"]);
    expect(sets.every(set => db.prepare("SELECT id FROM program_definition_exercises WHERE id=? AND program_definition_day_id=?").get(set.exercise_id, f.rows()[0].definition_day_id))).toBe(true);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("rejects removed active source days in context instead of falling back to another day", () => {
    const f = fixture(); f.doc.weeks[0].days[0].id = crypto.randomUUID();
    repository.saveEditorDraft({ userId, id: f.draftId, expectedRevision: 2, document: f.doc });
    expect(() => changes.previewActiveEditorChanges({ ...f.input, expectedDraftRevision: 3 })).toThrow(/day|structure|source/i);
  });

  it("publishes a real reusable definition and copies it independently of later draft edits", () => {
    const f = fixture(); const before = f.rows();
    const { result } = apply({ ...f.input, scope: "definition", occurrenceId: undefined });
    expect(f.rows()).toEqual(before);
    f.doc.name = "Unpublished edit";
    repository.saveEditorDraft({ userId, id: f.draftId, expectedRevision: 2, document: f.doc });
    const request = { userId, programId: f.activation.programId, publishedRevisionId: result.revisionId, requestKey: crypto.randomUUID() };
    const copied = changes.copyPublishedEditorDefinition(request);
    expect(repository.getEditorDraft(userId, copied.draftId)!.document.name).toBe("Double progression copy");
    expect(repository.getEditorDraft(userId, copied.draftId)!.document.weeks[0].days[0].exercises[0].baseLoad).toBe(50);
    expect(changes.copyPublishedEditorDefinition(request)).toEqual(copied);
  });

  it("enforces ownership and rejects applying to a started occurrence", () => {
    const f = fixture();
    expect(() => changes.listActiveEditorChanges(otherId, f.activation.programId)).toThrow(/not found/i);
    expect(() => changes.previewActiveEditorChanges({ ...f.input, userId: otherId })).toThrow(/not found/i);
    db.prepare("UPDATE workout_occurrences SET status='in_progress' WHERE id=?").run(f.input.occurrenceId);
    expect(() => changes.previewActiveEditorChanges(f.input)).toThrow(/started|scheduled|unstarted/i);
  });
});
