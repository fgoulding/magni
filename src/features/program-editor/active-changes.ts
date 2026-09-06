import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { validateDocument, type ProgramDocumentV1, type ProgramExerciseV1, type ProgramDayV1 } from "./document";
import { getBlockRange } from "./operations";
import { EditorRepositoryError, getEditorDraft, saveEditorDraft, type EditorPrescriptionSet } from "./repository";
import { evaluateProgression, type ProgressionState } from "./progression";
import { resolveEditorPrescription } from "./execution";

export type ActiveEditorChangeInput = {
  userId: number; programId: number; draftId: string; expectedDraftRevision: number;
  scope: "occurrence" | "remaining_block" | "definition"; occurrenceId?: number;
  progressionState: "preserve" | "use_draft";
};
type Occurrence = {
  id: number; slot_index: number | null; week_number: number; day_number: number; scheduled_date: string;
  status: string; revision: number; day_name: string; prescription_json: string;
  definition_day_id: number; legacy_day_id: number; session_id: number | null;
};
type Version = { id: number; draft_id: string; run_id: number; document_json: string };
const stable = (value: unknown): string => JSON.stringify(value, (_key, row) => row && typeof row === "object" && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
const hash = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
function fail(message: string, code = "edit_conflict", status = 409): never { throw new EditorRepositoryError(status, code, message); }

function context(userId: number, programId: number) {
  const version = db.prepare(`SELECT v.* FROM program_editor_versions v JOIN programs p ON p.id=v.program_id
    JOIN program_runs r ON r.id=v.run_id WHERE v.program_id=? AND v.user_id=? AND p.user_id=? AND r.archived_at IS NULL`)
    .get(programId, userId, userId) as Version | undefined;
  if (!version) fail("Active editor program not found.", "not_found", 404);
  const document = JSON.parse(version.document_json) as ProgramDocumentV1;
  const rows = db.prepare(`SELECT o.*,s.id AS session_id FROM workout_occurrences o LEFT JOIN sessions s ON s.occurrence_id=o.id
    WHERE o.program_id=? AND o.user_id=? ORDER BY o.slot_index,o.id`).all(programId, userId) as Occurrence[];
  const slots = document.weeks.flatMap((week, wi) => week.days.map(day => ({ week, wi, day })));
  return { version, document, rows, slots };
}

function sourceSlot(ctx: ReturnType<typeof context>, row: Occurrence) {
  // Calendar copies are extra workouts without a sequence slot. Their retained
  // logical week/day still identify the source in the immutable activation.
  const cycle = Math.floor((row.week_number - 1) / ctx.document.weeks.length);
  const wi = (row.week_number - 1) % ctx.document.weeks.length;
  const week = ctx.document.weeks[wi];
  const day = week?.days[row.day_number - 1];
  if (!day) fail("This workout's source day is missing. Review the program before editing.");
  return { week, wi, day, cycle };
}

export function listActiveEditorChanges(userId: number, programId: number) {
  const ctx = context(userId, programId);
  const published = db.prepare("SELECT id FROM program_editor_revisions WHERE program_id=? AND user_id=? AND scope='definition' ORDER BY id DESC LIMIT 1").get(programId, userId) as { id: number } | undefined;
  return { draftId: ctx.version.draft_id, publishedRevisionId: published?.id ?? null, occurrences: ctx.rows.map(row => {
    const slot = sourceSlot(ctx, row);
    return { occurrenceId: row.id, date: row.scheduled_date, name: row.day_name, status: row.status,
      editable: row.status === "scheduled" && row.session_id === null, extra: row.slot_index === null, cycle: slot.cycle + 1,
      weekId: slot.week.id, weekName: slot.week.name, dayId: slot.day.id, block: slot.week.block };
  }) };
}

function normalizedRule(exercise: Pick<ProgramExerciseV1, "rule" | "sets">) {
  const rule = structuredClone(exercise.rule);
  if (rule?.condition.type === "designated_set") {
    const id = rule.condition.setId;
    const set = exercise.sets.find(set => set.id === id);
    rule.condition.setId = `${set?.role}:${exercise.sets.filter(row => row.role === set?.role).findIndex(row => row.id === id)}`;
  }
  return rule;
}
const initialState = (exercise: ProgramExerciseV1): ProgressionState => ({ load: exercise.baseLoad, trainingMax: exercise.trainingMax,
  reps: (exercise.sets.find(set => set.role !== "warmup") ?? exercise.sets[0]).repMin, consecutiveFailures: 0, lastEvaluatedWeek: null });
type StateChange = { progressionKey: string; exerciseName: string; beforeState: ProgressionState; afterState: ProgressionState; separated: boolean };
type Prepared = { row: Occurrence; day: ProgramDayV1; sets: EditorPrescriptionSet[] };

function prepare(input: ActiveEditorChangeInput) {
  if (!["occurrence", "remaining_block", "definition"].includes(input.scope) || !["preserve", "use_draft"].includes(input.progressionState)) fail("Choose an edit scope and progression policy.", "invalid_input", 400);
  const ctx = context(input.userId, input.programId);
  if (input.draftId !== ctx.version.draft_id) fail("This draft does not belong to the active program.", "not_found", 404);
  const draft = getEditorDraft(input.userId, input.draftId)!;
  if (draft.revision !== input.expectedDraftRevision) fail("The draft revision changed. Save and review it again.");
  const issues = validateDocument(draft.document);
  if (issues.length) throw new EditorRepositoryError(400, "invalid_document", "Resolve the draft validation issues before applying changes.", issues);
  const nextRevision = Number((db.prepare("SELECT COALESCE(MAX(id),0)+1 AS id FROM program_editor_revisions").get() as { id: number }).id);
  const states = db.prepare("SELECT progression_key,state_json,revision FROM program_editor_progression_state WHERE run_id=? ORDER BY progression_key").all(ctx.version.run_id) as { progression_key: string; state_json: string; revision: number }[];
  let candidates: Occurrence[] = [];
  if (input.scope !== "definition") {
    const anchor = ctx.rows.find(row => row.id === input.occurrenceId);
    if (!anchor) fail("Choose a workout from this program.", "not_found", 404);
    if (anchor.status !== "scheduled" || anchor.session_id !== null) fail("Choose an unstarted scheduled workout. Started workouts keep their prescriptions.");
    if (input.scope === "remaining_block" && anchor.slot_index === null) fail("This is an extra copy. Edit this workout only, or choose a scheduled program workout for a block change.");
    const slot = sourceSlot(ctx, anchor);
    const block = getBlockRange(ctx.document.weeks, slot.wi);
    const cycle = slot.cycle;
    candidates = input.scope === "occurrence" ? [anchor] : ctx.rows.filter(row => {
      const target = sourceSlot(ctx, row);
      return row.slot_index !== null && anchor.slot_index !== null && row.slot_index >= anchor.slot_index && target.cycle === cycle && target.wi >= block.start && target.wi < block.end;
    });
  }
  const excluded = candidates.filter(row => row.status !== "scheduled" || row.session_id !== null);
  const affected = candidates.filter(row => row.status === "scheduled" && row.session_id === null);
  const stateChanges = new Map<string, StateChange>();
  const prepared: Prepared[] = affected.map(row => {
    const slot = sourceSlot(ctx, row);
    const week = draft.document.weeks.find(week => week.id === slot.week.id);
    const day = week?.days.find(day => day.id === slot.day.id);
    if (!week || !day) fail(`The source day ${slot.week.name} / ${slot.day.name} was removed. Restore its structure or apply the reusable definition instead.`);
    const before = JSON.parse(row.prescription_json) as EditorPrescriptionSet[];
    if (input.progressionState === "preserve" && before.some(set => set.editor.unit !== draft.document.unit)) fail("Changing units requires explicitly using the draft starting values; current values are not converted.");
    const sets: EditorPrescriptionSet[] = day.exercises.flatMap(exercise => {
      const prior = before.filter(set => set.editor.exerciseId === exercise.id);
      const metadata = prior[0]?.editor;
      const stored = metadata ? states.find(state => state.progression_key === metadata.progressionKey) : undefined;
      if (metadata && !stored) fail("Current progression state is missing. Review this program before editing.");
      const beforeState = stored ? JSON.parse(stored.state_json) as ProgressionState : initialState(exercise);
      const changed = !metadata || stable([metadata.baseLoad, metadata.trainingMax, metadata.definitionProgressionKey ?? metadata.progressionKey, metadata.unit,
        normalizedRule({ rule: metadata.rule, sets: prior.map(set => set.editor.set) })]) !== stable([exercise.baseLoad, exercise.trainingMax, exercise.progressionKey, draft.document.unit, normalizedRule(exercise)]);
      const separated = changed || input.progressionState === "use_draft";
      // An explicit reset also adopts the draft's deliberate sharing. Keeping
      // current values preserves previously separated histories within scope.
      const progressionKey = separated ? `revision:${nextRevision}:${hash([input.progressionState === "use_draft" ? "draft" : metadata?.progressionKey ?? exercise.progressionKey, exercise.progressionKey]).slice(0, 24)}` : metadata!.progressionKey;
      const afterState = input.progressionState === "use_draft" || !metadata ? initialState(exercise) : beforeState;
      evaluateProgression({ rule: null, state: afterState, sets: [], week: row.week_number, status: "completed" });
      stateChanges.set(progressionKey, { progressionKey, exerciseName: exercise.name, beforeState, afterState, separated });
      return exercise.sets.map((set, index) => {
        const repsDelta = exercise.rule?.action.variable === "reps" ? afterState.reps - (input.progressionState === "use_draft" ? initialState(exercise).reps : metadata?.initialReps ?? initialState(exercise).reps) : 0;
        const reps = Math.max(1, set.repMin + (set.role === "warmup" ? 0 : repsDelta));
        const maximum = Math.max(reps, set.repMax + (set.role === "warmup" ? 0 : repsDelta));
        const load = Number((set.loadMode === "working" ? afterState.load : set.loadMode === "percent" ? afterState.trainingMax * set.load / 100 : set.loadMode === "bodyweight" ? 0 : set.load).toPrecision(15));
        return { week_setting_id: 0, legacy_week_setting_id: 0, exercise_id: 0, stable_key: progressionKey,
          exercise_name: exercise.name, category: "main", progression_type: set.loadMode === "bodyweight" || set.loadMode === "added" ? "bodyweight" : "custom",
          superset_group: exercise.supersetGroup || null, week_number: row.week_number, set_number: index + 1,
          intensity_pct: 0, reps, sets: 1, rep_out_target: maximum, weight: load, training_max: afterState.trainingMax, calculated_weight: load,
          editor: { exerciseId: exercise.id, progressionKey, definitionProgressionKey: exercise.progressionKey, baseLoad: exercise.baseLoad, trainingMax: exercise.trainingMax,
            rule: exercise.rule, set, unit: draft.document.unit, deload: week.deload, versionId: ctx.version.id, revisionId: nextRevision,
            initialReps: input.progressionState === "use_draft" ? initialState(exercise).reps : metadata?.initialReps ?? initialState(exercise).reps, prescribedState: afterState },
        } satisfies EditorPrescriptionSet;
      });
    });
    return { row, day, sets };
  });
  const previewToken = hash([input, draft.document, ctx.rows, states, nextRevision]);
  const describe = (row: Occurrence) => ({ occurrenceId: row.id, date: row.scheduled_date, name: row.day_name, status: row.status });
  const preview = { previewToken, scope: input.scope, affected: prepared.map(({ row, day, sets }) => ({ ...describe(row), newName: day.name,
    before: (JSON.parse(row.prescription_json) as EditorPrescriptionSet[]).map(set => resolveEditorPrescription(set, ctx.version.run_id)), after: sets })),
    excluded: excluded.map(describe), progressionChanges: [...stateChanges.values()],
    explanation: input.scope === "definition" ? "Publish a reusable definition for future copies. Existing workouts keep their prescriptions."
      : "Only the listed unstarted workouts change. Dates and program positions stay fixed. Started and completed workouts retain their saved prescriptions. Extra Calendar copies are edited individually and stay outside block changes. Changed rules use separate progression so older sessions cannot change them." };
  return { ctx, draft, nextRevision, preview, prepared, stateChanges };
}

export function previewActiveEditorChanges(input: ActiveEditorChangeInput) { return db.transaction(() => prepare(input).preview)(); }

function priorRequest(userId: number, requestKey: string, input: unknown): string | null {
  if (!/^[0-9a-f-]{36}$/i.test(requestKey)) fail("Use a valid request key.", "invalid_input", 400);
  const prior = db.prepare("SELECT request_json,result_json FROM program_editor_change_requests WHERE user_id=? AND request_key=?").get(userId, requestKey) as { request_json: string; result_json: string } | undefined;
  if (prior && prior.request_json !== stable(input)) fail("This request key was already used for a different edit.");
  return prior?.result_json ?? null;
}
function rememberRequest(userId: number, requestKey: string, input: unknown, result: unknown) {
  db.prepare("INSERT INTO program_editor_change_requests(user_id,request_key,request_json,result_json) VALUES (?,?,?,?)").run(userId, requestKey, stable(input), stable(result));
}

export function applyActiveEditorChanges(input: ActiveEditorChangeInput & { expectedPreviewToken: string; requestKey: string }) {
  return db.transaction(() => {
    const prior = priorRequest(input.userId, input.requestKey, input);
    if (prior) return JSON.parse(prior) as { revisionId: number; changed: number };
    const { expectedPreviewToken, requestKey, ...selection } = input;
    const plan = prepare(selection);
    if (expectedPreviewToken !== plan.preview.previewToken) fail("The program changed since this preview. Review the updated changes before applying them.");
    const revisionId = Number(db.prepare("INSERT INTO program_editor_revisions(user_id,program_id,draft_id,source_revision,scope,document_json,preview_json) VALUES (?,?,?,?,?,?,?)")
      .run(input.userId, input.programId, input.draftId, plan.draft.revision, input.scope, stable(plan.draft.document), stable(plan.preview)).lastInsertRowid);
    for (const state of plan.stateChanges.values()) if (state.separated) db.prepare("INSERT INTO program_editor_progression_state(run_id,progression_key,state_json) VALUES (?,?,?)").run(plan.ctx.version.run_id, state.progressionKey, stable(state.afterState));
    for (const { row, day, sets } of plan.prepared) {
      const exerciseIds = new Map<string, { definition: number; legacy: number }>();
      for (const [index, set] of sets.entries()) {
        let ids = exerciseIds.get(set.editor.exerciseId);
        if (!ids) {
          const compatibilityMax = set.training_max > 0 ? set.training_max : 1;
          const definition = Number(db.prepare("INSERT INTO program_definition_exercises(program_definition_day_id,name,category,progression_type,sort_order,stable_key,superset_group,archived_at) VALUES (?,?,'main',?,?,?,?,datetime('now'))")
            .run(row.definition_day_id, set.exercise_name, set.progression_type, index, set.stable_key, set.superset_group).lastInsertRowid);
          const legacy = Number(db.prepare("INSERT INTO exercises(day_id,name,training_max,category,progression_type,auto_progression_enabled,sort_order,shared_exercise_key,superset_group,archived_at) VALUES (?,?,?,'main',?,0,?,?,?,datetime('now'))")
            .run(row.legacy_day_id, set.exercise_name, compatibilityMax, set.progression_type, index, set.stable_key, set.superset_group).lastInsertRowid);
          ids = { definition, legacy }; exerciseIds.set(set.editor.exerciseId, ids);
        }
        set.exercise_id = ids.definition;
        set.week_setting_id = Number(db.prepare("INSERT INTO program_definition_week_settings(program_definition_exercise_id,week_number,set_number,intensity_pct,reps,sets,rep_out_target,weight) VALUES (?,?,?,0,?,1,?,?)")
          .run(ids.definition, row.week_number, set.set_number, set.reps, set.rep_out_target, set.calculated_weight).lastInsertRowid);
        set.legacy_week_setting_id = Number(db.prepare("INSERT INTO week_settings(exercise_id,week_number,set_number,intensity_pct,reps,sets,rep_out_target,calculated_weight) VALUES (?,?,?,0,?,1,?,?)")
          .run(ids.legacy, row.week_number, set.set_number, set.reps, set.rep_out_target, set.calculated_weight).lastInsertRowid);
      }
      db.prepare("UPDATE workout_occurrences SET day_name=?,prescription_json=?,revision=revision+1 WHERE id=? AND user_id=?").run(day.name, stable(sets), row.id, input.userId);
    }
    const result = { revisionId, changed: plan.prepared.length };
    rememberRequest(input.userId, requestKey, input, result);
    return result;
  }).immediate();
}

export function copyPublishedEditorDefinition(input: { userId: number; programId: number; publishedRevisionId: number; requestKey: string }) {
  return db.transaction(() => {
    const prior = priorRequest(input.userId, input.requestKey, input);
    if (prior) return JSON.parse(prior) as { draftId: string };
    context(input.userId, input.programId);
    const revision = db.prepare("SELECT document_json FROM program_editor_revisions WHERE id=? AND user_id=? AND program_id=? AND scope='definition'").get(input.publishedRevisionId, input.userId, input.programId) as { document_json: string } | undefined;
    if (!revision) fail("Published definition not found.", "not_found", 404);
    const document = JSON.parse(revision.document_json) as ProgramDocumentV1;
    document.name = `${document.name.slice(0, 130)} copy`;
    const result = { draftId: crypto.randomUUID() };
    saveEditorDraft({ userId: input.userId, id: result.draftId, expectedRevision: 0, document });
    rememberRequest(input.userId, input.requestKey, input, result);
    return result;
  }).immediate();
}
