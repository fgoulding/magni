import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { EditorPrescriptionSet, EditorActivation } from "./repository";
import type { ProgramDocumentV1, ProgramExerciseV1 } from "./document";
import type { ProgressionRuleV1, ProgressionState } from "./progression";

let db: (typeof import("@/lib/db"))["db"];
let document: typeof import("./document");
let repository: typeof import("./repository");
let execution: typeof import("./execution");
let directory: string;
let userId: number;
let otherId: number;
const rule: ProgressionRuleV1 = {
  version: 1, condition: { type: "double_progression" },
  action: { variable: "load", unit: "lb", operation: "add", amount: 2.5, rounding: { mode: "nearest", quantum: 2.5 }, timing: "per_exposure" },
};

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "magni-execution-"));
  vi.stubEnv("DB_PATH", path.join(directory, "execution.sqlite"));
  db = (await import("@/lib/db")).db;
  (await import("./migration")).runProgramEditorMigration(db);
  document = await import("./document");
  repository = await import("./repository");
  execution = await import("./execution");
  userId = Number(db.prepare("INSERT INTO users(email,password_hash) VALUES ('execution@example.test','hash')").run().lastInsertRowid);
  otherId = Number(db.prepare("INSERT INTO users(email,password_hash) VALUES ('other-execution@example.test','hash')").run().lastInsertRowid);
});
afterAll(() => { db?.close(); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });

type OccurrenceRow = { id: number; legacy_day_id: number; definition_day_id: number; week_number: number; scheduled_date: string; prescription_json: string };
function fixture(edit?: (exercise: ProgramExerciseV1, doc: ProgramDocumentV1) => void) {
  const doc = document.createBlankDocument();
  doc.name = "Execution program";
  doc.startDate = "2026-09-05";
  doc.weekdays = [0, 1, 2, 3, 4, 5, 6];
  doc.cycles = 6;
  const exercise = document.createExercise("Dumbbell Row");
  exercise.rule = structuredClone(rule);
  doc.weeks[0].days[0].exercises = [exercise];
  edit?.(exercise, doc);
  const id = crypto.randomUUID();
  repository.saveEditorDraft({ userId, id, expectedRevision: 0, document: doc });
  const activation = repository.activateEditorDraft({ userId, id, expectedRevision: 1 });
  const occurrences = db.prepare("SELECT * FROM workout_occurrences WHERE program_run_id=? ORDER BY slot_index").all(activation.runId) as OccurrenceRow[];
  return { doc, exercise, activation, occurrences, draftId: id };
}
function prescription(occurrence: OccurrenceRow): EditorPrescriptionSet[] { return JSON.parse(occurrence.prescription_json); }
function getState(activation: EditorActivation, key: string): ProgressionState {
  return JSON.parse((db.prepare("SELECT state_json FROM program_editor_progression_state WHERE run_id=? AND progression_key=?").get(activation.runId, key) as { state_json: string }).state_json);
}
function setState(activation: EditorActivation, key: string, partial: Partial<ProgressionState>) {
  db.prepare("UPDATE program_editor_progression_state SET state_json=? WHERE run_id=? AND progression_key=?").run(JSON.stringify({ ...getState(activation, key), ...partial }), activation.runId, key);
}
function start(activation: EditorActivation, occurrence: OccurrenceRow, actuals: Array<number | null>, status = "in_progress") {
  const program = db.prepare("SELECT program_definition_id FROM programs WHERE id=?").get(activation.programId) as { program_definition_id: number };
  const sessionId = Number(db.prepare(`INSERT INTO sessions(user_id,program_id,program_run_id,program_definition_id,program_definition_day_id,day_id,occurrence_id,week_number,scheduled_date,date,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(userId, activation.programId, activation.runId, program.program_definition_id, occurrence.definition_day_id, occurrence.legacy_day_id, occurrence.id, occurrence.week_number, occurrence.scheduled_date, occurrence.scheduled_date, status).lastInsertRowid);
  if (status === "skipped") return sessionId;
  const insert = db.prepare(`INSERT INTO session_sets(session_id,program_definition_exercise_id,shared_exercise_key,exercise_name,week_number,set_number,reps,sets,rep_out_target,calculated_weight,training_max,actual_reps,actual_weight,editor_json)
    VALUES (?,?,?,?,?,?,?,1,?,?,?,?,?,?)`);
  prescription(occurrence).forEach((set, index) => {
    const resolved = execution.resolveEditorPrescription(set, activation.runId);
    insert.run(sessionId, set.exercise_id, set.stable_key, set.exercise_name, occurrence.week_number, set.set_number,
      resolved.reps, resolved.rep_out_target, resolved.calculated_weight, resolved.training_max, actuals[index] ?? null,
      actuals[index] == null ? null : resolved.calculated_weight, JSON.stringify(resolved.editor));
  });
  return sessionId;
}

describe("resolving editor prescriptions", () => {
  it("uses current working load and preserves the immutable source snapshot", () => {
    const { activation, exercise, occurrences } = fixture();
    const source = prescription(occurrences[0])[0];
    const before = JSON.stringify(source);
    setState(activation, exercise.progressionKey, { load: 42.5 });
    const resolved = execution.resolveEditorPrescription(source, activation.runId);
    expect(resolved.weight).toBe(42.5);
    expect(resolved.calculated_weight).toBe(42.5);
    expect(resolved.editor.prescribedState?.load).toBe(42.5);
    expect(JSON.stringify(source)).toBe(before);
    expect(resolved.editor).not.toBe(source.editor);
  });

  it("keeps fixed and added overrides literal, resolves percent from the explicit max, and bodyweight to zero", () => {
    const { activation, exercise, occurrences } = fixture((exercise) => {
      exercise.sets = ["working", "fixed", "percent", "bodyweight", "added"].map((mode) => ({ ...document.createSet(), loadMode: mode as "working", load: mode === "percent" ? 75 : 17.5 }));
    });
    setState(activation, exercise.progressionKey, { load: 50, trainingMax: 120 });
    const resolved = prescription(occurrences[0]).map((set) => execution.resolveEditorPrescription(set, activation.runId));
    expect(resolved.map((set) => set.calculated_weight)).toEqual([50, 17.5, 90, 0, 17.5]);
    expect(resolved.map((set) => set.training_max)).toEqual([120, 120, 120, 120, 120]);
  });

  it("shifts every work range by the reps-state delta and keeps warmup targets fixed", () => {
    const { activation, exercise, occurrences } = fixture((exercise) => {
      exercise.rule = { ...rule, action: { ...rule.action, variable: "reps", unit: "reps", amount: 1, rounding: { mode: "nearest", quantum: 1 } } };
      exercise.sets.unshift({ ...document.createSet(), role: "warmup", repMin: 5, repMax: 5 });
      exercise.sets[2].repMin = 10;
      exercise.sets[2].repMax = 14;
    });
    setState(activation, exercise.progressionKey, { reps: 10 });
    const resolved = prescription(occurrences[0]).map((set) => execution.resolveEditorPrescription(set, activation.runId));
    expect(resolved.map((set) => [set.reps, set.rep_out_target])).toEqual([[5, 5], [10, 14], [12, 16], [10, 14]]);
    expect(resolved[1].editor.set.repMin).toBe(8);
  });

  it("rejects missing state and mismatched activated versions instead of reverting load", () => {
    const first = fixture();
    const second = fixture();
    const set = prescription(first.occurrences[0])[0];
    expect(() => execution.resolveEditorPrescription(set, second.activation.runId)).toThrow(/state|version/i);
    db.prepare("DELETE FROM program_editor_progression_state WHERE run_id=?").run(first.activation.runId);
    expect(() => execution.resolveEditorPrescription(set, first.activation.runId)).toThrow(/state/i);
  });

  it("preserves a later week's rep override while applying the shared reps delta", () => {
    const { activation, exercise, occurrences } = fixture((exercise, doc) => {
      exercise.rule = { ...rule, action: { ...rule.action, variable: "reps", unit: "reps", amount: 1, rounding: { mode: "nearest", quantum: 1 } } };
      const override = structuredClone(exercise);
      override.id = crypto.randomUUID();
      override.sets = override.sets.map((set) => ({ ...set, id: crypto.randomUUID(), repMin: 10, repMax: 15 }));
      doc.weeks.push({ ...document.createWeek("Override"), days: [{ ...document.createDay("Override day"), exercises: [override] }] });
    });
    const source = prescription(occurrences[1])[0];
    expect(execution.resolveEditorPrescription(source, activation.runId).reps).toBe(10);
    setState(activation, exercise.progressionKey, { reps: 9 });
    const result = execution.resolveEditorPrescription(source, activation.runId);
    expect([result.reps, result.rep_out_target]).toEqual([11, 16]);
  });
});

describe("persisting completion decisions", () => {
  it("holds 40 after 12/12/11 and advances once to exactly 42.5 after 12/12/12", () => {
    const { activation, exercise, occurrences } = fixture();
    const heldSession = start(activation, occurrences[0], [12, 12, 11]);
    const held = execution.applyEditorCompletion({ userId, sessionId: heldSession });
    expect(held[0].result.reason).toBe("within_rep_range");
    expect(getState(activation, exercise.progressionKey).load).toBe(40);
    const sessionId = start(activation, occurrences[1], [12, 12, 12]);
    const result = execution.applyEditorCompletion({ userId, sessionId });
    expect(result[0].result.nextState.load).toBe(42.5);
    expect(result[0].beforeState.load).toBe(40);
    expect(result[0].afterState.load).toBe(42.5);
    expect(result[0].prescribedStates[0].load).toBe(40);
    expect(execution.applyEditorCompletion({ userId, sessionId })).toEqual(result);
    expect(getState(activation, exercise.progressionKey).load).toBe(42.5);
    expect(db.prepare("SELECT COUNT(*) AS n FROM program_editor_progression_events WHERE session_id=?").get(sessionId)).toEqual({ n: 1 });
    expect(execution.resolveEditorPrescription(prescription(occurrences[2])[0], activation.runId).calculated_weight).toBe(42.5);
  });

  it("agrees exactly with the preview evaluator", async () => {
    const { evaluateProgression } = await import("./progression");
    const { activation, occurrences } = fixture();
    const decisions = execution.applyEditorCompletion({ userId, sessionId: start(activation, occurrences[0], [12, 12, 12]) });
    expect(decisions[0].result).toEqual(evaluateProgression(decisions[0].input));
  });

  it("holds partial and skipped results by default and leaves unlogged sets unperformed", () => {
    const { activation, exercise, occurrences } = fixture();
    const partialId = start(activation, occurrences[0], [12, null, null]);
    const partial = execution.applyEditorCompletion({ userId, sessionId: partialId });
    expect(partial[0].result.reason).toBe("partial");
    expect(partial[0].input.status).toBe("partial");
    const skipped = execution.applyEditorCompletion({ userId, sessionId: start(activation, occurrences[1], [], "skipped") });
    expect(skipped[0].result.reason).toBe("skipped");
    expect(getState(activation, exercise.progressionKey).load).toBe(40);
    expect(db.prepare("SELECT actual_reps FROM session_sets WHERE session_id=? ORDER BY id").all(partialId)).toEqual([{ actual_reps: 12 }, { actual_reps: null }, { actual_reps: null }]);
  });

  it("applies configured partial/skip failure counting and percentage reset once", () => {
    const { activation, exercise, occurrences } = fixture((exercise) => {
      exercise.rule = { ...rule, partialPolicy: "count_failure", skipPolicy: "count_failure", failureReset: { afterFailures: 2, percent: 10, rounding: { mode: "down", quantum: 2.5 } } };
    });
    execution.applyEditorCompletion({ userId, sessionId: start(activation, occurrences[0], [12, null, null]) });
    expect(getState(activation, exercise.progressionKey).consecutiveFailures).toBe(1);
    const sessionId = start(activation, occurrences[1], [], "skipped");
    const result = execution.applyEditorCompletion({ userId, sessionId });
    expect(result[0].result.outcome).toBe("reset");
    expect(getState(activation, exercise.progressionKey).load).toBe(35);
    execution.applyEditorCompletion({ userId, sessionId });
    expect(getState(activation, exercise.progressionKey).load).toBe(35);
  });

  it("excludes unperformed warmups and respects fixed deload precedence", () => {
    const normal = fixture((exercise) => { exercise.sets.unshift({ ...document.createSet(), role: "warmup" }); });
    const result = execution.applyEditorCompletion({ userId, sessionId: start(normal.activation, normal.occurrences[0], [null, 12, 12, 12]) });
    expect(result[0].result.outcome).toBe("advance");
    const deload = fixture((_exercise, doc) => { doc.weeks[0].deload = true; });
    expect(execution.applyEditorCompletion({ userId, sessionId: start(deload.activation, deload.occurrences[0], [12, 12, 12]) })[0].result.reason).toBe("fixed_deload");
  });

  it("uses latest state when two sessions were started before either finished", () => {
    const { activation, exercise, occurrences } = fixture();
    const earlier = start(activation, occurrences[0], [12, 12, 12]);
    const later = start(activation, occurrences[1], [12, 12, 12]);
    execution.applyEditorCompletion({ userId, sessionId: later });
    const completedLaterSnapshot = db.prepare("SELECT * FROM session_sets WHERE session_id=?").all(later);
    const result = execution.applyEditorCompletion({ userId, sessionId: earlier });
    expect(result[0].beforeState.load).toBe(42.5);
    expect(result[0].prescribedStates[0].load).toBe(40);
    expect(getState(activation, exercise.progressionKey).load).toBe(45);
    expect(db.prepare("SELECT * FROM session_sets WHERE session_id=?").all(later)).toEqual(completedLaterSnapshot);
  });

  it("retains frozen rule and targets after the draft changes", () => {
    const { activation, draftId, doc, exercise, occurrences } = fixture();
    const sessionId = start(activation, occurrences[0], [12, 12, 12]);
    const before = db.prepare("SELECT editor_json FROM session_sets WHERE session_id=?").all(sessionId);
    doc.weeks[0].days[0].exercises[0].rule!.action.amount = 100;
    repository.saveEditorDraft({ userId, id: draftId, expectedRevision: 1, document: doc });
    execution.applyEditorCompletion({ userId, sessionId });
    expect(getState(activation, exercise.progressionKey).load).toBe(42.5);
    expect(db.prepare("SELECT editor_json FROM session_sets WHERE session_id=?").all(sessionId)).toEqual(before);
  });

  it("uses the session's frozen increased rep targets for subsequent reps progression", () => {
    const { activation, exercise, occurrences } = fixture((exercise) => {
      exercise.rule = { ...rule, condition: { type: "all_work_sets", target: "minimum" }, action: { ...rule.action, variable: "reps", unit: "reps", amount: 1, rounding: { mode: "nearest", quantum: 1 } } };
    });
    execution.applyEditorCompletion({ userId, sessionId: start(activation, occurrences[0], [8, 8, 8]) });
    expect(getState(activation, exercise.progressionKey).reps).toBe(9);
    const result = execution.applyEditorCompletion({ userId, sessionId: start(activation, occurrences[1], [8, 8, 8]) });
    expect(result[0].input.sets[0].repMin).toBe(9);
    expect(result[0].result.reason).toBe("target_missed");
    expect(getState(activation, exercise.progressionKey).reps).toBe(9);
  });

  it("rolls decisions and state back with the caller's completion transaction", () => {
    const { activation, exercise, occurrences } = fixture();
    const sessionId = start(activation, occurrences[0], [12, 12, 12]);
    expect(() => db.transaction(() => {
      execution.applyEditorCompletion({ userId, sessionId });
      throw new Error("status write failed");
    }).immediate()).toThrow("status write failed");
    expect(getState(activation, exercise.progressionKey).load).toBe(40);
    expect(db.prepare("SELECT * FROM program_editor_progression_events WHERE session_id=?").get(sessionId)).toBeUndefined();
  });

  it("does not touch a legacy session or create a progression event for it", () => {
    const sessionId = Number(db.prepare("INSERT INTO sessions(user_id,week_number,date) VALUES (?,1,'2026-09-05')").run(userId).lastInsertRowid);
    db.prepare("INSERT INTO session_sets(session_id,exercise_name,actual_reps,actual_weight) VALUES (?,'Legacy',10,40)").run(sessionId);
    expect(execution.applyEditorCompletion({ userId, sessionId })).toEqual([]);
    expect(db.prepare("SELECT * FROM program_editor_progression_events WHERE session_id=?").get(sessionId)).toBeUndefined();
  });

  it("rejects another user's session even on an already-applied retry", () => {
    const { activation, occurrences } = fixture();
    const sessionId = start(activation, occurrences[0], [12, 12, 12]);
    expect(() => execution.applyEditorCompletion({ userId: otherId, sessionId })).toThrow(/not found/i);
    execution.applyEditorCompletion({ userId, sessionId });
    expect(() => execution.applyEditorCompletion({ userId: otherId, sessionId })).toThrow(/not found/i);
  });

  it("rejects completed editor history without an original decision instead of silently replaying progression", () => {
    const { activation, exercise, occurrences } = fixture();
    const sessionId = start(activation, occurrences[0], [12, 12, 12]);
    db.prepare("UPDATE sessions SET completed=1 WHERE id=?").run(sessionId);
    expect(() => execution.applyEditorCompletion({ userId, sessionId })).toThrow(/completed/i);
    expect(getState(activation, exercise.progressionKey).load).toBe(40);
  });

  it("returns the recorded decision after the enclosing completion marks the session completed", () => {
    const { activation, exercise, occurrences } = fixture();
    const sessionId = start(activation, occurrences[0], [12, 12, 12]);
    const original = db.transaction(() => {
      const decisions = execution.applyEditorCompletion({ userId, sessionId });
      db.prepare("UPDATE sessions SET completed=1 WHERE id=?").run(sessionId);
      return decisions;
    }).immediate();
    expect(execution.applyEditorCompletion({ userId, sessionId })).toEqual(original);
    expect(getState(activation, exercise.progressionKey).load).toBe(42.5);
  });

  it("uses separate progression keys independently within one workout", () => {
    const { activation, doc, exercise, occurrences } = fixture((_exercise, doc) => {
      const other = document.createExercise("Press");
      other.rule = structuredClone(rule);
      other.baseLoad = 60;
      doc.weeks[0].days[0].exercises.push(other);
    });
    const decisions = execution.applyEditorCompletion({ userId, sessionId: start(activation, occurrences[0], [12, 12, 12, 12, 12, 11]) });
    expect(decisions).toHaveLength(2);
    expect(getState(activation, exercise.progressionKey).load).toBe(42.5);
    expect(getState(activation, doc.weeks[0].days[0].exercises[1].progressionKey).load).toBe(60);
  });

  it("updates percentage prescriptions from training-max progression without changing fixed overrides", () => {
    const { activation, exercise, occurrences } = fixture((exercise) => {
      exercise.rule = { ...rule, action: { ...rule.action, variable: "trainingMax", operation: "percent", amount: 10 } };
      exercise.sets[0].loadMode = "percent";
      exercise.sets[0].load = 75;
      exercise.sets[1].loadMode = "fixed";
      exercise.sets[1].load = 25;
    });
    execution.applyEditorCompletion({ userId, sessionId: start(activation, occurrences[0], [12, 12, 12]) });
    expect(getState(activation, exercise.progressionKey).trainingMax).toBe(110);
    const next = prescription(occurrences[1]).map((set) => execution.resolveEditorPrescription(set, activation.runId));
    expect(next.map((set) => set.calculated_weight)).toEqual([82.5, 25, 40]);
  });

  it("records manual holds without changing state or revision", () => {
    const { activation, exercise, occurrences } = fixture((exercise) => { exercise.rule = null; });
    const before = getState(activation, exercise.progressionKey);
    const decisions = execution.applyEditorCompletion({ userId, sessionId: start(activation, occurrences[0], [12, 12, 12]) });
    expect(decisions[0].result.reason).toBe("manual");
    expect(decisions[0].stateRevisionAfter).toBe(decisions[0].stateRevisionBefore);
    expect(getState(activation, exercise.progressionKey)).toEqual(before);
  });

  it("rejects inconsistent frozen rules without changing state or writing an event", () => {
    const { activation, exercise, occurrences } = fixture();
    const sessionId = start(activation, occurrences[0], [12, 12, 12]);
    const row = db.prepare("SELECT id,editor_json FROM session_sets WHERE session_id=? ORDER BY id LIMIT 1").get(sessionId) as { id: number; editor_json: string };
    const metadata = JSON.parse(row.editor_json);
    metadata.rule.action.amount = 100;
    db.prepare("UPDATE session_sets SET editor_json=? WHERE id=?").run(JSON.stringify(metadata), row.id);
    expect(() => execution.applyEditorCompletion({ userId, sessionId })).toThrow(/inconsistent/i);
    expect(getState(activation, exercise.progressionKey).load).toBe(40);
    expect(db.prepare("SELECT * FROM program_editor_progression_events WHERE session_id=?").get(sessionId)).toBeUndefined();
  });

  it.each(["{broken", "null", JSON.stringify({ progressionKey: "missing-fields" })])("rejects corrupt metadata %s without applying state", (invalid) => {
    const { activation, exercise, occurrences } = fixture();
    const sessionId = start(activation, occurrences[0], [12, 12, 12]);
    db.prepare("UPDATE session_sets SET editor_json=? WHERE session_id=?").run(invalid, sessionId);
    expect(() => execution.applyEditorCompletion({ userId, sessionId })).toThrow(/prescription/i);
    expect(getState(activation, exercise.progressionKey).load).toBe(40);
  });
});
