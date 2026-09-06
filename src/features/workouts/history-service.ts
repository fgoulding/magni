import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { userDateKey } from "@/lib/user-date";
import { getSessionRecap } from "@/features/programs/training-stats";
import { evaluateProgression } from "@/features/program-editor/progression";
import type { EditorCompletionDecision } from "@/features/program-editor/execution";
import type { ActualChange, CorrectionPreview, ExerciseSuggestion, HistorySet, WorkoutHistoryItem, WorkoutRoutine, WorkoutSession } from "./types";

export class WorkoutError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "WorkoutError"; }
}
const itemSelect = `SELECT s.*,
  CASE WHEN s.program_id IS NULL THEN COALESCE(NULLIF(s.day_name,''),'Quick Workout') ELSE s.program_name || ' · ' || s.day_name END AS name,
  COALESCE(SUM(CASE WHEN ss.actual_reps IS NOT NULL THEN ss.actual_reps * COALESCE(ss.actual_weight,0) * MAX(ss.sets,1) ELSE 0 END),0) AS volume,
  COALESCE(SUM(CASE WHEN ss.actual_reps IS NOT NULL THEN MAX(ss.sets,1) ELSE 0 END),0) AS loggedSets,
  COALESCE(SUM(CASE WHEN ss.id IS NOT NULL THEN MAX(ss.sets,1) ELSE 0 END),0) AS totalSets
  FROM sessions s LEFT JOIN session_sets ss ON ss.session_id=s.id`;

function validDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new WorkoutError(400, "Enter a valid workout date.");
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new WorkoutError(400, "Enter a valid workout date.");
  return value;
}
function nameText(value: unknown, fallback?: string): string {
  const name = typeof value === "string" ? value.trim() : fallback ?? "";
  if (!name || name.length > 140) throw new WorkoutError(400, "Enter a name from 1 to 140 characters.");
  return name;
}
function requireWorkout(userId: number, sessionId: number, active = false): WorkoutSession {
  const session = getWorkout(userId, sessionId);
  if (!session) throw new WorkoutError(404, "Workout not found.");
  if (active && session.status !== "in_progress") throw new WorkoutError(400, "Workout must be in progress.");
  return session;
}
function revisionMatches(session: WorkoutSession, revision?: number): void {
  if (revision !== undefined && (!Number.isInteger(revision) || revision !== session.revision)) throw new WorkoutError(409, "This workout changed in another tab or device. Reload the saved workout before editing.");
}
function mutation<T>(userId: number, key: string | undefined, body: unknown, run: () => T): T {
  if (key !== undefined && (typeof key !== "string" || key.length < 8 || key.length > 120)) throw new WorkoutError(400, "Use a valid retry key.");
  const hash = createHash("sha256").update(JSON.stringify(body, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value)).digest("hex");
  return db.transaction(() => {
    if (key) {
      const prior = db.prepare("SELECT request_hash,response_json FROM workout_mutation_requests WHERE user_id=? AND request_key=?").get(userId, key) as { request_hash: string; response_json: string } | undefined;
      if (prior) {
        if (prior.request_hash !== hash) throw new WorkoutError(409, "This retry key belongs to a different change.");
        return JSON.parse(prior.response_json) as T;
      }
    }
    const result = run();
    if (key) db.prepare("INSERT INTO workout_mutation_requests(user_id,request_key,request_hash,response_json) VALUES (?,?,?,?)").run(userId, key, hash, JSON.stringify(result));
    return result;
  }).immediate();
}

export function getWorkout(userId: number, sessionId: number): WorkoutSession | null {
  const item = db.prepare(`${itemSelect} WHERE s.user_id=? AND s.id=? GROUP BY s.id`).get(userId, sessionId) as WorkoutHistoryItem | undefined;
  if (!item) return null;
  const sets = db.prepare("SELECT * FROM session_sets WHERE session_id=? ORDER BY sort_order,id").all(sessionId) as HistorySet[];
  const corrections = db.prepare("SELECT id,reason,created_at FROM workout_corrections WHERE session_id=? AND user_id=? ORDER BY id DESC").all(sessionId, userId) as WorkoutSession["corrections"];
  return { ...item, sets, corrections, recap: item.status === "in_progress" ? null : getSessionRecap(userId, sessionId) };
}
export function listWorkouts(userId: number, before?: string): WorkoutHistoryItem[] {
  const [date, id] = before?.split(":") ?? [];
  if (date) validDate(date);
  if (id !== undefined && (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)))) throw new WorkoutError(400, "Use a valid history cursor.");
  return db.prepare(`${itemSelect} WHERE s.user_id=? AND (? IS NULL OR s.date<? OR (s.date=? AND s.id<?)) GROUP BY s.id ORDER BY s.date DESC,s.id DESC LIMIT 100`).all(userId, date ?? null, date ?? null, id ? date : null, id ? Number(id) : 0) as WorkoutHistoryItem[];
}

type SavedExercise = { name: string; sets: { reps: number; weight: number }[] };
function repeatPrescription(session: WorkoutSession): SavedExercise[] {
  const groups = new Map<string, SavedExercise>();
  for (const set of session.sets) {
    const key = set.exercise_key ?? `${set.exercise_name}:${"program_definition_exercise_id" in set ? set.program_definition_exercise_id : ""}`;
    const exercise = groups.get(key) ?? { name: set.exercise_name, sets: [] };
    for (let count = 0; count < Math.max(set.sets, 1); count++) exercise.sets.push({ reps: Math.max(1, set.actual_reps ?? set.reps), weight: set.actual_reps !== null ? set.actual_weight ?? 0 : set.calculated_weight ?? 0 });
    groups.set(key, exercise);
  }
  return [...groups.values()];
}
function insertExercise(sessionId: number, exercise: SavedExercise, exerciseKey: string = randomUUID()): number[] {
  nameText(exercise.name);
  if (!Array.isArray(exercise.sets) || exercise.sets.length < 1 || exercise.sets.length > 50) throw new WorkoutError(400, "Add between 1 and 50 sets.");
  const position = (db.prepare("SELECT COALESCE(MAX(sort_order),0) AS value FROM session_sets WHERE session_id=?").get(sessionId) as { value: number }).value;
  const ids: number[] = [];
  exercise.sets.forEach((set, index) => {
    if (!Number.isInteger(set.reps) || set.reps < 1 || set.reps > 1000 || !Number.isFinite(set.weight) || set.weight < 0 || set.weight > 10000) throw new WorkoutError(400, "Use whole reps from 1 to 1,000 and a weight from 0 to 10,000.");
    ids.push(Number(db.prepare(`INSERT INTO session_sets(session_id,exercise_name,exercise_key,category,progression_type,set_number,reps,sets,rep_out_target,calculated_weight,sort_order)
      VALUES (?,?,?,'accessory','custom',?,?,1,?,?,?)`).run(sessionId, exercise.name.trim(), exerciseKey, index + 1, set.reps, set.reps, set.weight, position + index + 1).lastInsertRowid));
  });
  return ids;
}

export function createQuickSession(input: { userId: number; requestKey?: string; date?: string; name?: string; unit?: "lb" | "kg"; newWorkout?: boolean; sourceSessionId?: number; routineId?: number }): { session: WorkoutSession; created: boolean } {
  return mutation(input.userId, input.requestKey, { action: "create", ...input }, () => {
    const date = validDate(input.date ?? userDateKey(input.userId));
    let name = nameText(input.name, "Quick Workout");
    let unit = input.unit ?? "lb";
    if (unit !== "lb" && unit !== "kg") throw new WorkoutError(400, "Choose lb or kg.");
    let exercises: SavedExercise[] = [];
    if (input.sourceSessionId !== undefined) {
      const source = requireWorkout(input.userId, input.sourceSessionId);
      exercises = repeatPrescription(source);
      name = nameText(input.name, source.name);
      unit = source.unit;
    } else if (input.routineId !== undefined) {
      const routine = db.prepare("SELECT name,unit,prescription_json FROM workout_routines WHERE id=? AND user_id=?").get(input.routineId, input.userId) as { name: string; unit: "lb" | "kg"; prescription_json: string } | undefined;
      if (!routine) throw new WorkoutError(404, "Routine not found.");
      exercises = JSON.parse(routine.prescription_json);
      name = nameText(input.name, routine.name);
      unit = routine.unit;
    } else if (!input.newWorkout && !input.date && !input.name) {
      const existing = db.prepare("SELECT id FROM sessions WHERE user_id=? AND program_id IS NULL AND status='in_progress' AND date=? ORDER BY id DESC LIMIT 1").get(input.userId, date) as { id: number } | undefined;
      if (existing) return { session: requireWorkout(input.userId, existing.id), created: false };
    }
    const id = Number(db.prepare("INSERT INTO sessions(user_id,program_name,day_name,week_number,date,unit) VALUES (?,'Quick Workout',?,1,?,?)").run(input.userId, name, date, unit).lastInsertRowid);
    exercises.forEach((exercise) => insertExercise(id, exercise));
    return { session: requireWorkout(input.userId, id), created: true };
  });
}

export function addQuickExercise(input: { userId: number; sessionId: number; requestKey?: string; name: string; sets: { reps: number; weight: number }[]; appendToSetId?: number }): WorkoutSession & { addedSetIds: number[] } {
  return mutation(input.userId, input.requestKey, { action: "add_exercise", ...input }, () => {
    const session = requireWorkout(input.userId, input.sessionId, true);
    if (!Array.isArray(input.sets)) throw new WorkoutError(400, "Enter a set prescription.");
    if (session.sets.length + input.sets.length > 300) throw new WorkoutError(400, "Keep workouts within 300 sets.");
    let exerciseKey: string | undefined;
    if (input.appendToSetId !== undefined) {
      const existing = session.sets.find((set) => set.id === input.appendToSetId);
      if (!existing) throw new WorkoutError(404, "Exercise not found in this workout.");
      exerciseKey = existing.exercise_key ?? randomUUID();
      if (!existing.exercise_key) db.prepare("UPDATE session_sets SET exercise_key=? WHERE session_id=? AND exercise_name=? AND exercise_key IS NULL").run(exerciseKey, session.id, existing.exercise_name);
    }
    const addedSetIds = insertExercise(session.id, input, exerciseKey);
    if (input.appendToSetId !== undefined) {
      const reference = session.sets.find((set) => set.id === input.appendToSetId)!;
      const last = session.sets.findLastIndex((set) => reference.exercise_key ? set.exercise_key === reference.exercise_key : set.exercise_name === reference.exercise_name);
      const order = session.sets.map((set) => set.id); order.splice(last + 1, 0, ...addedSetIds);
      order.forEach((id, index) => db.prepare("UPDATE session_sets SET sort_order=? WHERE id=? AND session_id=?").run(index + 1, id, session.id));
    }
    db.prepare("UPDATE sessions SET revision=revision+1 WHERE id=?").run(session.id);
    return { ...requireWorkout(input.userId, session.id), addedSetIds };
  });
}

export function updateQuickStructure(input: { userId: number; sessionId: number; requestKey?: string; expectedRevision?: number; name?: string; date?: string; order?: number[]; removeSetIds?: number[]; exerciseNames?: Record<number, string>; renameExercise?: { setIds: number[]; name: string } }): WorkoutSession {
  return mutation(input.userId, input.requestKey, { action: "structure", ...input }, () => {
    const session = requireWorkout(input.userId, input.sessionId, true);
    if (session.program_id !== null) throw new WorkoutError(400, "Program workout prescriptions are frozen. Edit only the recorded values.");
    revisionMatches(session, input.expectedRevision);
    const known = new Set(session.sets.map((set) => set.id));
    if (input.removeSetIds && (!Array.isArray(input.removeSetIds) || input.removeSetIds.some((id) => !known.has(id)))) throw new WorkoutError(400, "Choose sets from this workout.");
    const removed = new Set(input.removeSetIds ?? []);
    const remaining = session.sets.filter((set) => !removed.has(set.id));
    if (input.order && (!Array.isArray(input.order) || input.order.length !== remaining.length || new Set(input.order).size !== remaining.length || input.order.some((id) => !known.has(id) || removed.has(id)))) throw new WorkoutError(400, "The order must contain every set exactly once.");
    if (input.exerciseNames) {
      for (const [id, value] of Object.entries(input.exerciseNames)) {
        if (!known.has(Number(id))) throw new WorkoutError(400, "Choose sets from this workout.");
        db.prepare("UPDATE session_sets SET exercise_name=? WHERE id=? AND session_id=?").run(nameText(value), Number(id), session.id);
      }
    }
    if (input.renameExercise) {
      const name = nameText(input.renameExercise.name);
      if (!Array.isArray(input.renameExercise.setIds) || !input.renameExercise.setIds.length || input.renameExercise.setIds.some((id) => !known.has(id))) throw new WorkoutError(400, "Choose an exercise from this workout.");
      input.renameExercise.setIds.forEach((id) => db.prepare("UPDATE session_sets SET exercise_name=? WHERE id=? AND session_id=?").run(name, id, session.id));
    }
    for (const id of removed) db.prepare("DELETE FROM session_sets WHERE id=? AND session_id=?").run(id, session.id);
    (input.order ?? remaining.map((set) => set.id)).forEach((id, index) => db.prepare("UPDATE session_sets SET sort_order=? WHERE id=? AND session_id=?").run(index + 1, id, session.id));
    db.prepare("UPDATE sessions SET day_name=?,date=?,revision=revision+1 WHERE id=?").run(input.name === undefined ? session.day_name : nameText(input.name), input.date === undefined ? session.date : validDate(input.date), session.id);
    return requireWorkout(input.userId, session.id);
  });
}

export function saveActualSet(input: { userId: number; sessionId: number; setId: number; actualReps: number | null; actualWeight: number | null; notes?: string; expectedActual?: { reps: number | null; weight: number | null } }): HistorySet & { sessionRevision: number; sessionMetadata: Pick<WorkoutSession, "name" | "date" | "unit" | "revision"> } {
  return db.transaction(() => {
    const session = requireWorkout(input.userId, input.sessionId, true);
    const set = session.sets.find((set) => set.id === input.setId);
    if (!set) throw new WorkoutError(404, "Set not found in this workout.");
    validateActual(input);
    const same = set.actual_reps === input.actualReps && set.actual_weight === input.actualWeight;
    if (input.expectedActual && !same && (input.expectedActual.reps !== set.actual_reps || input.expectedActual.weight !== set.actual_weight)) throw new WorkoutError(409, "This set changed in another tab or device. Reload saved values or explicitly keep your edits.");
    const notes = typeof input.notes === "string" ? input.notes.slice(0, 4000) : set.notes ?? "";
    if (!same || notes !== (set.notes ?? "")) {
      db.prepare("UPDATE session_sets SET actual_reps=?,actual_weight=?,notes=? WHERE id=?").run(input.actualReps, input.actualWeight, notes, set.id);
      db.prepare("UPDATE sessions SET revision=revision+1 WHERE id=?").run(session.id);
    }
    const updated = requireWorkout(input.userId, session.id);
    return { ...updated.sets.find((row) => row.id === set.id)!, sessionRevision: updated.revision, sessionMetadata: { name: updated.name, date: updated.date, unit: updated.unit, revision: updated.revision } };
  }).immediate();
}
function validateActual(input: { actualReps: number | null; actualWeight: number | null }): void {
  if (input.actualReps !== null && (!Number.isInteger(input.actualReps) || input.actualReps < 0 || input.actualReps > 10000)) throw new WorkoutError(400, "Actual reps must be a nonnegative integer up to 10,000.");
  if (input.actualWeight !== null && (!Number.isFinite(input.actualWeight) || input.actualWeight < 0 || input.actualWeight > 10000)) throw new WorkoutError(400, "Actual weight must be nonnegative and no greater than 10,000.");
}

export function finishQuickSession(userId: number, sessionId: number) {
  return db.transaction(() => {
    const session = requireWorkout(userId, sessionId);
    if (session.status === "completed") return getSessionRecap(userId, sessionId)!;
    if (session.status !== "in_progress") throw new WorkoutError(400, "Only an in-progress workout can be finished.");
    if (session.program_id !== null) throw new WorkoutError(400, "Finish planned workouts through their program to preserve progression.");
    db.prepare("UPDATE sessions SET completed=1,revision=revision+1 WHERE id=?").run(sessionId);
    return getSessionRecap(userId, sessionId)!;
  }).immediate();
}

export function recentExercises(userId: number, search = "", targetUnit: "lb" | "kg" = "lb"): ExerciseSuggestion[] {
  const rows = db.prepare(`SELECT ss.exercise_name,s.date,s.unit,ss.actual_reps AS reps,COALESCE(ss.actual_weight,0) AS weight,ss.sets,
    DENSE_RANK() OVER (PARTITION BY ss.exercise_name ORDER BY s.date DESC,s.id DESC) AS rank
    FROM session_sets ss JOIN sessions s ON s.id=ss.session_id WHERE s.user_id=? AND s.status='completed' AND ss.actual_reps IS NOT NULL
    AND instr(lower(ss.exercise_name),lower(?))>0 ORDER BY s.date DESC,s.id DESC,ss.sort_order,ss.id`).all(userId, search.trim().slice(0, 140)) as { exercise_name: string; date: string; unit: "lb" | "kg"; reps: number; weight: number; sets: number; rank: number }[];
  const grouped = new Map<string, ExerciseSuggestion>();
  for (const row of rows) {
    if (row.rank !== 1 || row.reps < 1) continue;
    if (!grouped.has(row.exercise_name) && grouped.size >= 30) continue;
    const item = grouped.get(row.exercise_name) ?? { name: row.exercise_name, date: row.date, sets: [] };
    for (let count = 0; count < Math.max(1, row.sets) && item.sets.length < 50; count++) item.sets.push({ reps: row.reps, weight: Number((row.weight * (row.unit === targetUnit ? 1 : row.unit === "kg" ? 2.2046226218487757 : 1 / 2.2046226218487757)).toFixed(4)) });
    grouped.set(row.exercise_name, item);
  }
  return [...grouped.values()];
}
export function listRoutines(userId: number): WorkoutRoutine[] {
  return (db.prepare("SELECT id,name,prescription_json FROM workout_routines WHERE user_id=? ORDER BY id DESC LIMIT 100").all(userId) as { id: number; name: string; prescription_json: string }[]).map((row) => {
    const exercises = JSON.parse(row.prescription_json) as SavedExercise[];
    return { id: row.id, name: row.name, exerciseCount: exercises.length, setCount: exercises.reduce((sum, item) => sum + item.sets.length, 0) };
  });
}
export function saveRoutine(input: { userId: number; sessionId: number; requestKey?: string; name: string }): WorkoutRoutine {
  return mutation(input.userId, input.requestKey, { action: "routine", ...input }, () => {
    const session = requireWorkout(input.userId, input.sessionId);
    const exercises = repeatPrescription(session);
    if (!exercises.length) throw new WorkoutError(400, "Add exercises before saving a routine.");
    const name = nameText(input.name);
    const id = Number(db.prepare("INSERT INTO workout_routines(user_id,name,unit,prescription_json) VALUES (?,?,?,?)").run(input.userId, name, session.unit, JSON.stringify(exercises)).lastInsertRowid);
    return { id, name, exerciseCount: exercises.length, setCount: exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0) };
  });
}

export function previewCorrection(userId: number, sessionId: number, changes: ActualChange[]): CorrectionPreview {
  const session = requireWorkout(userId, sessionId);
  if (session.status !== "completed") throw new WorkoutError(400, "Only completed workouts can be corrected.");
  if (!Array.isArray(changes) || changes.length > 300 || changes.some((change) => !change || typeof change !== "object") || new Set(changes.map((change) => change.setId)).size !== changes.length) throw new WorkoutError(400, "Choose distinct sets from this workout.");
  // Explain the complete currently corrected workout, retaining the original
  // recorded rule/state while applying this edit on top of previous corrections.
  const replacements = new Map<string, number | null>();
  for (const set of session.sets) if (set.editor_json) replacements.set(JSON.parse(set.editor_json).set.id, set.actual_reps);
  for (const change of changes) {
    validateActual(change);
    const set = session.sets.find((set) => set.id === change.setId);
    if (!set) throw new WorkoutError(400, "Choose sets from this workout.");
    if (set.editor_json) replacements.set(JSON.parse(set.editor_json).set.id, change.actualReps);
  }
  const recorded = db.prepare("SELECT decision_json FROM program_editor_progression_events WHERE session_id=?").get(sessionId) as { decision_json: string } | undefined;
  const decisions = recorded ? JSON.parse(recorded.decision_json) as EditorCompletionDecision[] : [];
  const comparisons = decisions.map((decision) => {
    const sets = decision.input.sets.map((set) => replacements.has(set.id) ? { ...set, actualReps: replacements.get(set.id)! } : set);
    const corrected = evaluateProgression({ ...decision.input, state: decision.beforeState, sets, status: sets.some((set) => set.role !== "warmup" && set.actualReps === null) ? "partial" : "completed" });
    return { exercise: decision.exerciseName, previous: decision.result.explanation, corrected: corrected.explanation, hypothetical: true as const };
  });
  return { progressionEffect: "Future progression and completed downstream workouts remain unchanged. This correction updates recorded history and statistics only.", comparisons };
}
export function correctWorkout(input: { userId: number; sessionId: number; expectedRevision: number; requestKey?: string; reason: string; sets: ActualChange[]; date?: string }) {
  return mutation(input.userId, input.requestKey, { action: "correct", ...input }, () => {
    const session = requireWorkout(input.userId, input.sessionId);
    if (!Number.isInteger(input.expectedRevision)) throw new WorkoutError(400, "Provide the saved workout revision.");
    revisionMatches(session, input.expectedRevision);
    const preview = previewCorrection(input.userId, input.sessionId, input.sets);
    const date = input.date === undefined ? session.date : validDate(input.date);
    const before = { date: session.date, sets: session.sets.map((set) => ({ setId: set.id, actualReps: set.actual_reps, actualWeight: set.actual_weight })) };
    for (const change of input.sets) db.prepare("UPDATE session_sets SET actual_reps=?,actual_weight=? WHERE id=? AND session_id=?").run(change.actualReps, change.actualWeight, change.setId, session.id);
    db.prepare("UPDATE sessions SET date=?,revision=revision+1 WHERE id=?").run(date, session.id);
    db.prepare("INSERT INTO workout_corrections(session_id,user_id,reason,before_json,after_json) VALUES (?,?,?,?,?)").run(session.id, input.userId, nameText(input.reason, "Updated training log"), JSON.stringify(before), JSON.stringify({ date, sets: input.sets, preview }));
    return { session: requireWorkout(input.userId, session.id), recap: getSessionRecap(input.userId, session.id)!, ...preview };
  });
}
