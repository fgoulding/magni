import { db } from "@/lib/db";
import { EditorRepositoryError, type EditorPrescriptionSet, type EditorSetMetadata } from "./repository";
import { evaluateProgression, validateProgressionRule, type ProgressionInput, type ProgressionResult, type ProgressionState } from "./progression";

export type EditorCompletionDecision = {
  version: 1;
  progressionKey: string;
  exerciseName: string;
  beforeState: ProgressionState;
  afterState: ProgressionState;
  prescribedStates: ProgressionState[];
  input: ProgressionInput;
  result: ProgressionResult;
  stateRevisionBefore: number;
  stateRevisionAfter: number;
};

type StoredState = { state: ProgressionState; revision: number };
type Session = {
  id: number; program_run_id: number | null; occurrence_id: number | null;
  week_number: number; completed: number; status: string;
};
type SetResult = {
  exercise_name: string; reps: number; rep_out_target: number;
  actual_reps: number | null; editor_json: string;
};

function executionError(message: string, code = "invalid_editor_execution", status = 409): never {
  throw new EditorRepositoryError(status, code, message);
}

function readState(runId: number, metadata: EditorSetMetadata): StoredState {
  const stored = db.prepare(`SELECT s.state_json, s.revision FROM program_editor_progression_state s
    JOIN program_runs r ON r.id = s.run_id
    WHERE s.run_id = ? AND s.progression_key = ? AND r.editor_version_id = ?`)
    .get(runId, metadata.progressionKey, metadata.versionId) as { state_json: string; revision: number } | undefined;
  if (!stored) executionError("Progression state or activated version is missing. Reload and review this program before training.", "missing_progression_state");
  const state = JSON.parse(stored.state_json) as ProgressionState;
  // Reuse the evaluator's state validation without performing any progression.
  evaluateProgression({ rule: null, state, sets: [], week: 1, status: "completed" });
  return { state, revision: stored.revision };
}

function readMetadata(json: string): EditorSetMetadata {
  let metadata: EditorSetMetadata;
  try { metadata = JSON.parse(json) as EditorSetMetadata; }
  catch { executionError("The frozen editor prescription is not valid JSON."); }
  if (!metadata || typeof metadata !== "object" || !metadata.set || typeof metadata.set !== "object"
    || typeof metadata.progressionKey !== "string" || !metadata.progressionKey.trim()
    || typeof metadata.exerciseId !== "string" || !metadata.exerciseId.trim()
    || !Number.isSafeInteger(metadata.versionId) || metadata.versionId < 1
    || (metadata.unit !== "lb" && metadata.unit !== "kg") || typeof metadata.deload !== "boolean") {
    executionError("The frozen editor prescription is missing its identity, units, or set metadata.");
  }
  const errors = validateProgressionRule(metadata.rule);
  if (errors.length) executionError(`The frozen progression rule is invalid: ${errors.join(" ")}`);
  if (metadata.rule && metadata.rule.action.variable !== "reps" && metadata.rule.action.unit !== metadata.unit) executionError("Frozen progression units do not match the prescription.");
  return metadata;
}

/** Resolve only pending prescriptions. Started sessions use their persisted values. */
export function resolveEditorPrescription(set: EditorPrescriptionSet, runId: number): EditorPrescriptionSet {
  const metadata = readMetadata(JSON.stringify(set.editor));
  const { state } = readState(runId, metadata);
  let weight: number;
  switch (metadata.set.loadMode) {
    case "working": weight = state.load; break;
    case "percent": weight = state.trainingMax * metadata.set.load / 100; break;
    case "bodyweight": weight = 0; break;
    case "fixed": case "added": weight = metadata.set.load; break;
    default: executionError("The frozen prescription has an unsupported load mode.");
  }
  if (!Number.isFinite(weight) || weight < 0) executionError("The resolved working weight must be nonnegative and finite.");
  // Preserve a decimal percentage without introducing binary floating-point noise.
  weight = Number(weight.toPrecision(15));
  let repMin = metadata.set.repMin;
  let repMax = metadata.set.repMax;
  if (metadata.rule?.action.variable === "reps" && metadata.set.role !== "warmup") {
    if (!Number.isSafeInteger(metadata.initialReps) || metadata.initialReps! < 1) executionError("Rep progression requires the exercise's original minimum rep target.");
    const delta = state.reps - metadata.initialReps!;
    repMin = Math.max(1, repMin + delta);
    repMax = Math.max(repMin, repMax + delta);
  }
  evaluateProgression({ rule: null, state, status: "completed", week: set.week_number,
    sets: [{ ...metadata.set, repMin, repMax, actualReps: null }] });
  return {
    ...set, weight, calculated_weight: weight, training_max: state.trainingMax,
    reps: repMin, rep_out_target: repMax,
    editor: { ...metadata, prescribedState: { ...state } },
  };
}

function skippedPrescription(userId: number, session: Session): SetResult[] {
  if (session.status !== "skipped" || session.occurrence_id === null || session.program_run_id === null) return [];
  const occurrence = db.prepare(`SELECT prescription_json FROM workout_occurrences
    WHERE id = ? AND user_id = ? AND program_run_id = ?`)
    .get(session.occurrence_id, userId, session.program_run_id) as { prescription_json: string } | undefined;
  if (!occurrence) executionError("The skipped workout's frozen occurrence could not be found.");
  const sets = JSON.parse(occurrence.prescription_json) as EditorPrescriptionSet[];
  return sets.filter((set) => set.editor).map((set) => {
    const resolved = resolveEditorPrescription(set, session.program_run_id!);
    return { exercise_name: resolved.exercise_name, reps: resolved.reps, rep_out_target: resolved.rep_out_target,
      actual_reps: null, editor_json: JSON.stringify(resolved.editor) };
  });
}

/**
 * Call before the final status write, inside the completion/skip transaction.
 * The nested transaction is a savepoint when the caller already owns a write
 * lock, so a later status failure rolls back both state and the decision event.
 * This never edits session prescriptions, performed sets, or downstream history.
 */
export function applyEditorCompletion(input: { userId: number; sessionId: number }): EditorCompletionDecision[] {
  return db.transaction(() => {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ?").get(input.sessionId, input.userId) as Session | undefined;
    if (!session) executionError("Session not found.", "not_found", 404);
    const prior = db.prepare("SELECT decision_json FROM program_editor_progression_events WHERE session_id = ? AND run_id = ?")
      .get(session.id, session.program_run_id) as { decision_json: string } | undefined;
    if (prior) return JSON.parse(prior.decision_json) as EditorCompletionDecision[];
    let rows = db.prepare(`SELECT exercise_name, reps, rep_out_target, actual_reps, editor_json
      FROM session_sets WHERE session_id = ? AND editor_json IS NOT NULL ORDER BY id`).all(session.id) as SetResult[];
    if (!rows.length) rows = skippedPrescription(input.userId, session);
    if (!rows.length) return [];
    if (session.completed || session.status === "completed") executionError("This editor session is already completed without its original progression decision. Review the history before correcting it.", "completed_without_decision");
    if (session.status !== "in_progress" && session.status !== "skipped") executionError("Only an in-progress or skipped editor session can be evaluated.");
    if (!session.program_run_id) executionError("The editor session is missing its program run.");
    const ownedRun = db.prepare("SELECT id FROM program_runs WHERE id = ? AND user_id = ?").get(session.program_run_id, input.userId);
    if (!ownedRun) executionError("Program run not found.", "not_found", 404);

    const grouped = new Map<string, Array<{ row: SetResult; metadata: EditorSetMetadata }>>();
    for (const row of rows) {
      const metadata = readMetadata(row.editor_json);
      const group = grouped.get(metadata.progressionKey) ?? [];
      if (group.length) {
        const first = group[0].metadata;
        if (first.versionId !== metadata.versionId || first.exerciseId !== metadata.exerciseId || first.unit !== metadata.unit
          || first.deload !== metadata.deload || JSON.stringify(first.rule) !== JSON.stringify(metadata.rule)) {
          executionError("Sets sharing progression have inconsistent frozen rules or exercise identities.");
        }
      }
      group.push({ row, metadata });
      grouped.set(metadata.progressionKey, group);
    }

    const decisions: EditorCompletionDecision[] = [];
    for (const [progressionKey, group] of grouped) {
      const metadata = group[0].metadata;
      const { state, revision } = readState(session.program_run_id, metadata);
      const evaluationInput: ProgressionInput = {
        rule: metadata.rule, state,
        sets: group.map(({ row, metadata }) => ({ id: metadata.set.id, role: metadata.set.role,
          repMin: row.reps, repMax: row.rep_out_target, actualReps: row.actual_reps })),
        status: session.status === "skipped" ? "skipped"
          : group.some(({ row, metadata }) => metadata.set.role !== "warmup" && row.actual_reps === null) ? "partial" : "completed",
        week: session.week_number, isDeload: metadata.deload,
      };
      const result = evaluateProgression(evaluationInput);
      const changed = JSON.stringify(result.nextState) !== JSON.stringify(state);
      if (changed) {
        const update = db.prepare(`UPDATE program_editor_progression_state SET state_json = ?, revision = revision + 1, updated_at = datetime('now')
          WHERE run_id = ? AND progression_key = ? AND revision = ?`).run(JSON.stringify(result.nextState), session.program_run_id, progressionKey, revision);
        if (!update.changes) executionError("Progression changed during completion. Retry this workout.", "progression_conflict");
      }
      const prescribedStates = [...new Map(group.filter(({ metadata }) => metadata.prescribedState)
        .map(({ metadata }) => [JSON.stringify(metadata.prescribedState), metadata.prescribedState!])).values()];
      decisions.push({ version: 1, progressionKey, exerciseName: group[0].row.exercise_name,
        beforeState: state, afterState: result.nextState, prescribedStates,
        input: evaluationInput, result, stateRevisionBefore: revision, stateRevisionAfter: revision + Number(changed) });
    }
    db.prepare("INSERT INTO program_editor_progression_events(session_id,run_id,decision_json) VALUES (?,?,?)")
      .run(session.id, session.program_run_id, JSON.stringify(decisions));
    return decisions;
  }).immediate();
}
