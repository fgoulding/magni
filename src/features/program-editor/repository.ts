import { db } from "@/lib/db";
import type { PrescriptionSet } from "@/features/programs/occurrences";
import { validateDocument, validateDraftStructure, type DocumentIssue, type ProgramDocumentV1, type ProgramExerciseV1, type ProgramSetV1 } from "./document";
import type { ProgressionState } from "./progression";

export class EditorRepositoryError extends Error {
  constructor(public status: number, public code: string, message: string, public issues: DocumentIssue[] = []) {
    super(message);
    this.name = "EditorRepositoryError";
  }
}
export type EditorDraft = {
  id: string; revision: number; document: ProgramDocumentV1; activatedProgramId: number | null; updatedAt: string;
};
export type EditorActivation = { programId: number; runId: number; versionId: number; draftId: string };
export type EditorSetMetadata = {
  exerciseId: string; progressionKey: string; baseLoad: number; trainingMax: number;
  rule: ProgramExerciseV1["rule"]; set: ProgramSetV1; unit: ProgramDocumentV1["unit"]; deload: boolean; versionId: number;
  initialReps?: number; prescribedState?: ProgressionState;
  revisionId?: number; definitionProgressionKey?: string;
};
export type EditorPrescriptionSet = PrescriptionSet & { editor: EditorSetMetadata };
type DraftRow = { id: string; user_id: number; revision: number; document_json: string; updated_at: string; activated_program_id: number | null };

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, row) => row && typeof row === "object" && !Array.isArray(row)
    ? Object.fromEntries(Object.keys(row).sort().map((key) => [key, row[key]])) : row);
}
function asDraft(row: DraftRow): EditorDraft {
  return { id: row.id, revision: row.revision, document: JSON.parse(row.document_json), activatedProgramId: row.activated_program_id, updatedAt: row.updated_at };
}
const draftSelect = `SELECT d.*, v.program_id AS activated_program_id FROM program_editor_drafts d
  LEFT JOIN program_editor_versions v ON v.draft_id = d.id`;

export function getEditorDraft(userId: number, id: string): EditorDraft | null {
  const row = db.prepare(`${draftSelect} WHERE d.id = ? AND d.user_id = ?`).get(id, userId) as DraftRow | undefined;
  return row ? asDraft(row) : null;
}
export function listEditorDrafts(userId: number): EditorDraft[] {
  return (db.prepare(`${draftSelect} WHERE d.user_id = ? ORDER BY d.updated_at DESC, d.id`).all(userId) as DraftRow[]).map(asDraft);
}

/** Client-generated draft identity and compare-and-swap revisions make both
 * creation and saving safe to retry when a committed response was lost. */
export function saveEditorDraft(input: { userId: number; id: string; expectedRevision: number; document: unknown }): EditorDraft {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id)) throw new EditorRepositoryError(400, "invalid_id", "Draft ID must be a UUID.");
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new EditorRepositoryError(400, "invalid_revision", "Expected revision must be a nonnegative integer.");
  const issues = validateDraftStructure(input.document);
  if (issues.length) throw new EditorRepositoryError(400, "invalid_document", "Draft structure is invalid.", issues);
  const json = stableJson(input.document);
  return db.transaction(() => {
    const current = db.prepare(`${draftSelect} WHERE d.id = ?`).get(input.id) as DraftRow | undefined;
    if (current && current.user_id !== input.userId) throw new EditorRepositoryError(404, "not_found", "Draft not found.");
    if (current?.document_json === json) return asDraft(current);
    if ((current?.revision ?? 0) !== input.expectedRevision) throw new EditorRepositoryError(409, "revision_conflict", "This draft changed in another tab or device. Reload it before saving.");
    if (current) db.prepare("UPDATE program_editor_drafts SET document_json = ?, revision = revision + 1, updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(json, input.id, input.userId);
    else db.prepare("INSERT INTO program_editor_drafts(id,user_id,document_json,revision) VALUES (?,?,?,1)").run(input.id, input.userId, json);
    return getEditorDraft(input.userId, input.id)!;
  }).immediate();
}

/** Activation is one transaction: no run, snapshot or occurrence can escape if
 * materialization fails. Further draft edits never mutate this activated version. */
export function activateEditorDraft(input: { userId: number; id: string; expectedRevision: number }): EditorActivation {
  return db.transaction(() => {
    const draft = getEditorDraft(input.userId, input.id);
    if (!draft) throw new EditorRepositoryError(404, "not_found", "Draft not found.");
    const prior = db.prepare("SELECT id, program_id, run_id, source_revision FROM program_editor_versions WHERE draft_id = ? AND user_id = ?").get(input.id, input.userId) as { id: number; program_id: number; run_id: number; source_revision: number } | undefined;
    if (prior) {
      if (prior.source_revision !== input.expectedRevision) throw new EditorRepositoryError(409, "already_active", "This draft is already active. Duplicate it to activate a separate program; edits remain in the draft.");
      return { programId: prior.program_id, runId: prior.run_id, versionId: prior.id, draftId: input.id };
    }
    if (draft.revision !== input.expectedRevision) throw new EditorRepositoryError(409, "revision_conflict", "This draft changed. Save and review the current revision before activating.");
    const issues = validateDocument(draft.document);
    if (issues.length) throw new EditorRepositoryError(400, "invalid_document", "Program must be valid before activation.", issues);
    const versionId = Number(db.prepare("INSERT INTO program_editor_versions(draft_id,user_id,source_revision,document_json) VALUES (?,?,?,?)").run(input.id, input.userId, draft.revision, stableJson(draft.document)).lastInsertRowid);
    const result = materializeProgram(input.userId, input.id, versionId, draft.document);
    db.prepare("UPDATE program_editor_versions SET program_id = ?, run_id = ? WHERE id = ?").run(result.programId, result.runId, versionId);
    return result;
  }).immediate();
}

function resolvedLoad(exercise: ProgramExerciseV1, set: ProgramSetV1): number {
  switch (set.loadMode) {
    case "working": return exercise.baseLoad;
    case "percent": return Number((exercise.trainingMax * set.load / 100).toPrecision(15));
    case "bodyweight": return 0;
    case "fixed": case "added": return set.load;
  }
}
function plusDay(key: string): string {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function materializeProgram(userId: number, draftId: string, versionId: number, doc: ProgramDocumentV1): EditorActivation {
  const numWeeks = doc.weeks.length * doc.cycles;
  const weekdays = JSON.stringify([...doc.weekdays].sort());
  const definitionId = Number(db.prepare("INSERT INTO program_definitions(owner_user_id,name,description,num_weeks,source_type,visibility) VALUES (?,?,?,?,'custom','private')").run(userId, doc.name.trim(), doc.description, numWeeks).lastInsertRowid);
  const runId = Number(db.prepare(`INSERT INTO program_runs(user_id,program_definition_id,name,schedule_weekdays,schedule_mode,start_date,editor_version_id)
    VALUES (?,?,?,?,'scheduled',?,?)`).run(userId, definitionId, doc.name.trim(), weekdays, doc.startDate, versionId).lastInsertRowid);
  const programId = Number(db.prepare(`INSERT INTO programs(user_id,name,description,num_weeks,program_definition_id,program_run_id,schedule_weekdays,schedule_mode)
    VALUES (?,?,?,?,?,?,?,'scheduled')`).run(userId, doc.name.trim(), doc.description, numWeeks, definitionId, runId, weekdays).lastInsertRowid);
  for (const weekday of doc.weekdays) db.prepare("INSERT INTO program_run_schedule_days(program_run_id,weekday) VALUES (?,?)").run(runId, weekday);
  let slotIndex = 0;
  let scheduledDate = doc.startDate;
  const initialRepsByKey = new Map<string, number>();
  for (let cycle = 0; cycle < doc.cycles; cycle++) {
    for (const [weekIndex, week] of doc.weeks.entries()) {
      const logicalWeek = cycle * doc.weeks.length + weekIndex + 1;
      for (const [dayIndex, day] of week.days.entries()) {
        while (!doc.weekdays.includes(new Date(`${scheduledDate}T12:00:00Z`).getUTCDay())) scheduledDate = plusDay(scheduledDate);
        const dayKey = `editor:${versionId}:${cycle}:${day.id}`;
        const definitionDayId = Number(db.prepare("INSERT INTO program_definition_days(program_definition_id,name,day_number,sort_order,stable_key) VALUES (?,?,?,?,?)").run(definitionId, day.name.trim(), slotIndex + 1, slotIndex, dayKey).lastInsertRowid);
        const legacyDayId = Number(db.prepare("INSERT INTO days(program_id,name,day_number,sort_order,shared_day_key) VALUES (?,?,?,?,?)").run(programId, day.name.trim(), slotIndex + 1, slotIndex, dayKey).lastInsertRowid);
        const prescription: EditorPrescriptionSet[] = [];
        for (const [exerciseIndex, exercise] of day.exercises.entries()) {
          // The legacy positive-TM constraint needs a compatibility value for a
          // manual/bodyweight zero max. Exact editor values stay in its snapshot.
          const compatibilityMax = exercise.trainingMax > 0 ? exercise.trainingMax : exercise.baseLoad > 0 ? exercise.baseLoad : 1;
          const progressionType = exercise.sets.every((set) => set.loadMode === "bodyweight" || set.loadMode === "added") ? "bodyweight" : "custom";
          const supersetGroup = exercise.supersetGroup.trim() || null;
          const definitionExerciseId = Number(db.prepare(`INSERT INTO program_definition_exercises(program_definition_day_id,name,category,progression_type,sort_order,stable_key,superset_group)
            VALUES (?,?,'main',?,?,?,?)`).run(definitionDayId, exercise.name.trim(), progressionType, exerciseIndex, exercise.progressionKey, supersetGroup).lastInsertRowid);
          const legacyExerciseId = Number(db.prepare(`INSERT INTO exercises(day_id,name,training_max,category,progression_type,auto_progression_enabled,sort_order,shared_exercise_key,superset_group)
            VALUES (?,?,?,'main',?,0,?,?,?)`).run(legacyDayId, exercise.name.trim(), compatibilityMax, progressionType, exerciseIndex, exercise.progressionKey, supersetGroup).lastInsertRowid);
          const state: ProgressionState = { load: exercise.baseLoad, trainingMax: exercise.trainingMax, reps: (exercise.sets.find((set) => set.role !== "warmup") ?? exercise.sets[0]).repMin, consecutiveFailures: 0, lastEvaluatedWeek: null };
          const initialReps = initialRepsByKey.get(exercise.progressionKey) ?? state.reps;
          initialRepsByKey.set(exercise.progressionKey, initialReps);
          db.prepare("INSERT OR IGNORE INTO program_editor_progression_state(run_id,progression_key,state_json) VALUES (?,?,?)").run(runId, exercise.progressionKey, JSON.stringify(state));
          db.prepare("INSERT OR IGNORE INTO program_run_expected_maxes(program_run_id,shared_exercise_key,expected_max) VALUES (?,?,?)").run(runId, exercise.progressionKey, compatibilityMax);
          for (const [setIndex, set] of exercise.sets.entries()) {
            const load = resolvedLoad(exercise, set);
            // Absolute weight is the compatibility prescription. Full percentage,
            // effort and set-role semantics are retained verbatim under editor.
            const definitionWeekId = Number(db.prepare(`INSERT INTO program_definition_week_settings(program_definition_exercise_id,week_number,set_number,intensity_pct,reps,sets,rep_out_target,weight)
              VALUES (?,?,?,0,?,1,?,?)`).run(definitionExerciseId, logicalWeek, setIndex + 1, set.repMin, set.repMax, load).lastInsertRowid);
            const legacyWeekId = Number(db.prepare(`INSERT INTO week_settings(exercise_id,week_number,set_number,intensity_pct,reps,sets,rep_out_target,calculated_weight)
              VALUES (?,?,?,0,?,1,?,?)`).run(legacyExerciseId, logicalWeek, setIndex + 1, set.repMin, set.repMax, load).lastInsertRowid);
            prescription.push({ week_setting_id: definitionWeekId, legacy_week_setting_id: legacyWeekId, exercise_id: definitionExerciseId, stable_key: exercise.progressionKey,
              exercise_name: exercise.name.trim(), category: "main", progression_type: progressionType, superset_group: supersetGroup,
              week_number: logicalWeek, set_number: setIndex + 1, intensity_pct: 0, reps: set.repMin, sets: 1, rep_out_target: set.repMax,
              weight: load, training_max: compatibilityMax, calculated_weight: load,
              editor: { exerciseId: exercise.id, progressionKey: exercise.progressionKey, baseLoad: exercise.baseLoad, trainingMax: exercise.trainingMax,
                rule: exercise.rule, set, unit: doc.unit, deload: week.deload, versionId, initialReps } });
          }
        }
        db.prepare(`INSERT INTO workout_occurrences(user_id,program_id,program_run_id,definition_day_id,legacy_day_id,slot_index,week_number,day_number,program_name,day_name,scheduled_date,original_date,prescription_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(userId, programId, runId, definitionDayId, legacyDayId, slotIndex, logicalWeek, dayIndex + 1, doc.name.trim(), day.name.trim(), scheduledDate, scheduledDate, JSON.stringify(prescription));
        slotIndex++;
        scheduledDate = plusDay(scheduledDate);
      }
    }
  }
  return { programId, runId, versionId, draftId };
}
