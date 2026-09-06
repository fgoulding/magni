import { db } from "@/lib/db";
import { calculateWeight } from "@/lib/calculator";
import { getSettingNumber } from "@/lib/auth";
import type { ExerciseCategory } from "@/features/training-templates/types";
import { resolveEditorPrescription } from "@/features/program-editor/execution";
import type { EditorPrescriptionSet, EditorSetMetadata } from "@/features/program-editor/repository";

export type Occurrence = {
  id: number; user_id: number; program_id: number; program_run_id: number;
  definition_day_id: number; legacy_day_id: number | null; slot_index: number | null;
  week_number: number; day_number: number; program_name: string; day_name: string;
  scheduled_date: string; original_date: string; status: "scheduled" | "in_progress" | "completed" | "skipped";
  prescription_json: string; revision: number; moved: number; session_id: number | null; performed_date: string | null;
};

export type PrescriptionSet = {
  week_setting_id: number; legacy_week_setting_id: number | null; exercise_id: number;
  stable_key: string; exercise_name: string; category: ExerciseCategory; progression_type: string;
  superset_group: string | null; week_number: number; set_number: number;
  intensity_pct: number; reps: number; sets: number; rep_out_target: number;
  weight: number | null; training_max: number; calculated_weight: number;
  template_snapshot_json?: string | null;
};

type Run = { program_id: number; id: number; program_definition_id: number; name: string; num_weeks: number; start_date: string; schedule_weekdays: string };
type Day = { id: number; legacy_day_id: number | null; name: string; day_number: number };

/** Civil dates use UTC arithmetic only; these are dates, never instants. */
export function dateKeyPlus(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function validDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function snapshotPrescription(run: Run, day: Day, week: number): PrescriptionSet[] {
  return db.prepare(`SELECT pdws.id AS week_setting_id, ws.id AS legacy_week_setting_id,
    pde.id AS exercise_id, pde.stable_key, pde.name AS exercise_name, pde.category,
    pde.progression_type, pde.template_snapshot_json, pde.superset_group, pdws.week_number, pdws.set_number,
    pdws.intensity_pct, pdws.reps, pdws.sets, pdws.rep_out_target, pdws.weight,
    COALESCE(prx.expected_max, 100) AS training_max
    FROM program_definition_exercises pde
    JOIN program_definition_week_settings pdws ON pdws.program_definition_exercise_id = pde.id AND pdws.week_number = ?
    LEFT JOIN program_run_expected_maxes prx ON prx.program_run_id = ? AND prx.shared_exercise_key = pde.stable_key
    LEFT JOIN exercises e ON e.day_id = ? AND e.shared_exercise_key = pde.stable_key AND e.archived_at IS NULL
    LEFT JOIN week_settings ws ON ws.exercise_id = e.id AND ws.week_number = pdws.week_number AND ws.set_number = pdws.set_number
    WHERE pde.program_definition_day_id = ? AND pde.archived_at IS NULL
    ORDER BY pde.sort_order, pde.id, pdws.set_number`).all(week, run.id, day.legacy_day_id, day.id) as PrescriptionSet[];
}

/** Materialize each logical slot once. Reads never move or regenerate existing slots. */
export const ensureScheduledOccurrences = db.transaction((userId: number) => {
  const runs = db.prepare(`SELECT p.id AS program_id, pr.id, pr.program_definition_id, pr.name,
    pd.num_weeks, COALESCE(pr.start_date, substr(pr.created_at,1,10)) AS start_date, pr.schedule_weekdays
    FROM programs p JOIN program_runs pr ON pr.id = p.program_run_id
    JOIN program_definitions pd ON pd.id = pr.program_definition_id
    WHERE p.user_id = ? AND pr.status IN ('active','paused') AND pr.archived_at IS NULL
    AND pr.schedule_mode = 'scheduled' AND pr.editor_version_id IS NULL`).all(userId) as Run[];
  const insert = db.prepare(`INSERT OR IGNORE INTO workout_occurrences
    (user_id, program_id, program_run_id, definition_day_id, legacy_day_id, slot_index, week_number,
     day_number, program_name, day_name, scheduled_date, original_date, prescription_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const run of runs) {
    const days = db.prepare(`SELECT pdd.id, d.id AS legacy_day_id, pdd.name, pdd.day_number
      FROM program_definition_days pdd LEFT JOIN days d ON d.program_id = ? AND d.shared_day_key = pdd.stable_key AND d.archived_at IS NULL
      WHERE pdd.program_definition_id = ? AND pdd.archived_at IS NULL ORDER BY pdd.day_number`).all(run.program_id, run.program_definition_id) as Day[];
    const weekdays = JSON.parse(run.schedule_weekdays) as number[];
    if (!days.length || !weekdays.length || !validDateKey(run.start_date)) continue;
    const holds = db.prepare("SELECT start_date, end_date FROM program_run_holds WHERE program_run_id = ? AND canceled_at IS NULL").all(run.id) as { start_date: string; end_date: string }[];
    let date = run.start_date;
    for (let slot = 0; slot < days.length * run.num_weeks; slot++) {
      let attempts = 0;
      while (!weekdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay()) || holds.some(h => h.start_date <= date && date <= h.end_date)) {
        date = dateKeyPlus(date, 1);
        if (++attempts > 36600) throw new Error("Schedule has no available dates");
      }
      const day = days[slot % days.length];
      const week = Math.floor(slot / days.length) + 1;
      const existing = db.prepare("SELECT id FROM workout_occurrences WHERE program_run_id = ? AND slot_index = ?").get(run.id, slot);
      if (!existing) insert.run(userId, run.program_id, run.id, day.id, day.legacy_day_id, slot, week, day.day_number, run.name, day.name, date, date, JSON.stringify(snapshotPrescription(run, day, week)));
      date = dateKeyPlus(date, 1);
    }
    // Link existing history by logical position, not the weekday projection that
    // previously disagreed. Repeats remain separate history, never deleted.
    const unlinked = db.prepare(`SELECT id, week_number, program_definition_day_id, day_id, status, scheduled_date FROM sessions
      WHERE program_id = ? AND user_id = ? AND occurrence_id IS NULL ORDER BY id`).all(run.program_id, userId) as { id: number; week_number: number; program_definition_day_id: number | null; day_id: number | null; status: string; scheduled_date: string | null }[];
    for (const session of unlinked) {
      const occurrence = db.prepare(`SELECT o.id FROM workout_occurrences o WHERE o.program_run_id = ? AND o.week_number = ?
        AND (o.definition_day_id = ? OR o.legacy_day_id = ?) AND NOT EXISTS(SELECT 1 FROM sessions s WHERE s.occurrence_id = o.id)
        ORDER BY o.slot_index LIMIT 1`).get(run.id, session.week_number, session.program_definition_day_id, session.day_id) as { id: number } | undefined;
      if (occurrence) {
        db.prepare("UPDATE sessions SET occurrence_id = ? WHERE id = ?").run(occurrence.id, session.id);
        db.prepare("UPDATE workout_occurrences SET status = ?, scheduled_date = COALESCE(?, scheduled_date) WHERE id = ?").run(session.status, session.scheduled_date, occurrence.id);
      }
    }
  }
});

export function getOccurrences(userId: number, start = "0001-01-01", end = "9999-12-31"): Occurrence[] {
  ensureScheduledOccurrences.immediate(userId);
  return db.prepare(`SELECT o.*, s.id AS session_id, s.date AS performed_date FROM workout_occurrences o
    LEFT JOIN sessions s ON s.occurrence_id = o.id
    JOIN program_runs pr ON pr.id = o.program_run_id
    WHERE o.user_id = ? AND CASE WHEN o.status = 'completed' THEN COALESCE(s.date, o.scheduled_date) ELSE o.scheduled_date END BETWEEN ? AND ?
    AND (o.status IN ('in_progress','completed','skipped') OR (pr.status = 'active' AND pr.archived_at IS NULL AND pr.schedule_mode = 'scheduled'))
    ORDER BY o.scheduled_date, o.id`).all(userId, start, end) as Occurrence[];
}

export function getOccurrence(userId: number, id: number): Occurrence | undefined {
  return db.prepare("SELECT o.*, s.id AS session_id, s.date AS performed_date FROM workout_occurrences o LEFT JOIN sessions s ON s.occurrence_id = o.id WHERE o.id = ? AND o.user_id = ?").get(id, userId) as Occurrence | undefined;
}

/** Pending loads follow current progression; starting freezes them in session_sets. */
export function occurrencePrescription(occurrence: Occurrence): PrescriptionSet[] {
  if (occurrence.session_id && occurrence.status !== "skipped") {
    const sets = db.prepare(`SELECT ss.*, program_definition_week_setting_id AS week_setting_id,
      week_setting_id AS legacy_week_setting_id, program_definition_exercise_id AS exercise_id,
      shared_exercise_key AS stable_key, calculated_weight AS weight FROM session_sets ss
      WHERE session_id = ? ORDER BY program_definition_exercise_id, set_number, id`).all(occurrence.session_id) as Array<PrescriptionSet & { editor_json: string | null }>;
    return sets.map(set => set.editor_json ? { ...set, editor: JSON.parse(set.editor_json) as EditorSetMetadata } : set);
  }
  const rounding = getSettingNumber(occurrence.user_id, "rounding", 2.5);
  const sets = JSON.parse(occurrence.prescription_json) as Array<PrescriptionSet & { editor?: EditorSetMetadata }>;
  return sets.map(set => {
    if (set.editor) return resolveEditorPrescription(set as EditorPrescriptionSet, occurrence.program_run_id);
    const current = db.prepare("SELECT expected_max FROM program_run_expected_maxes WHERE program_run_id = ? AND shared_exercise_key = ?").get(occurrence.program_run_id, set.stable_key) as { expected_max: number } | undefined;
    const trainingMax = current?.expected_max ?? set.training_max;
    return { ...set, training_max: trainingMax, calculated_weight: set.weight ?? calculateWeight(trainingMax, set.intensity_pct, rounding) };
  });
}

export function occurrenceLiftPreview(occurrence: Occurrence) {
  const groups = new Map<number, { name: string; set_count: number; reps: number; weight: number; bodyweight: boolean; detail?: string }>();
  const schemes = new Map<number, Map<string, number>>();
  for (const set of occurrencePrescription(occurrence)) {
    const metadata = "editor" in set ? set.editor as EditorPrescriptionSet["editor"] : undefined;
    const group = groups.get(set.exercise_id);
    if (group) { group.set_count += set.sets; group.reps = Math.max(group.reps, set.reps); group.weight = Math.max(group.weight, set.calculated_weight); }
    else groups.set(set.exercise_id, { name: set.exercise_name, set_count: set.sets, reps: set.reps, weight: set.calculated_weight, bodyweight: metadata ? metadata.set.loadMode === "bodyweight" || metadata.set.loadMode === "added" : set.progression_type === "bodyweight" });
    if (metadata) {
      const reps = `${set.reps}${set.rep_out_target !== set.reps ? `–${set.rep_out_target}` : ""}`;
      const load = metadata.set.loadMode === "bodyweight" ? "BW" : metadata.set.loadMode === "added" ? `BW +${set.calculated_weight} ${metadata.unit}` : `${set.calculated_weight} ${metadata.unit}`;
      const role = metadata.set.role === "work" ? "" : `${({warmup:"warm-up",top:"top",backoff:"back-off",amrap:"AMRAP"})[metadata.set.role]} `;
      const scheme = `${role}${reps} @ ${load}`;
      const counts = schemes.get(set.exercise_id) ?? new Map<string,number>();
      counts.set(scheme,(counts.get(scheme) ?? 0) + set.sets); schemes.set(set.exercise_id, counts);
    }
  }
  for (const [id,counts] of schemes) groups.get(id)!.detail = [...counts].map(([scheme,count]) => `${count}×${scheme}`).join(" · ");
  return [...groups.values()];
}

/** Progress is the first unresolved logical slot, never a side effect of a date. */
export function syncOccurrencePosition(userId: number, programId: number) {
  const next = db.prepare("SELECT week_number, day_number FROM workout_occurrences WHERE user_id = ? AND program_id = ? AND status IN ('scheduled','in_progress') ORDER BY slot_index, id LIMIT 1").get(userId, programId) as { week_number: number; day_number: number } | undefined;
  if (next) {
    db.prepare("UPDATE programs SET current_week = ?, current_day = ? WHERE id = ? AND user_id = ?").run(next.week_number, next.day_number, programId, userId);
    db.prepare("UPDATE program_runs SET current_week = ?, current_day = ? WHERE id = (SELECT program_run_id FROM programs WHERE id = ? AND user_id = ?)").run(next.week_number, next.day_number, programId, userId);
  } else if (db.prepare("SELECT id FROM workout_occurrences WHERE user_id = ? AND program_id = ? AND slot_index IS NOT NULL LIMIT 1").get(userId, programId)) {
    db.prepare("UPDATE program_runs SET status = 'completed' WHERE id = (SELECT program_run_id FROM programs WHERE id = ? AND user_id = ?) AND status != 'archived'").run(programId, userId);
    db.prepare("UPDATE programs SET is_active = 0 WHERE id = ? AND user_id = ?").run(programId, userId);
  }
  return next;
}

/** Explicit recurring-schedule/hold changes reflow untouched pending dates only. */
export function reflowOccurrences(userId: number, programId: number) {
  const run = db.prepare("SELECT pr.*, COALESCE(pr.start_date, substr(pr.created_at,1,10)) AS start_date FROM program_runs pr JOIN programs p ON p.program_run_id = pr.id WHERE p.id = ? AND p.user_id = ?").get(programId, userId) as Run | undefined;
  if (!run || !validDateKey(run.start_date)) return;
  const weekdays = JSON.parse(run.schedule_weekdays) as number[];
  if (!weekdays.length) return;
  const holds = db.prepare("SELECT start_date, end_date FROM program_run_holds WHERE program_run_id = ? AND canceled_at IS NULL").all(run.id) as { start_date: string; end_date: string }[];
  const rows = db.prepare("SELECT * FROM workout_occurrences WHERE program_run_id = ? ORDER BY slot_index, id").all(run.id) as Occurrence[];
  let date = run.start_date;
  for (const row of rows) {
    if (row.moved || row.status !== "scheduled") { date = dateKeyPlus(row.scheduled_date > date ? row.scheduled_date : date, 1); continue; }
    let attempts = 0;
    while (!weekdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay()) || holds.some(h => h.start_date <= date && date <= h.end_date)) {
      date = dateKeyPlus(date, 1);
      if (++attempts > 36600) throw new Error("Schedule has no available dates");
    }
    db.prepare("UPDATE workout_occurrences SET scheduled_date = ?, revision = revision + 1 WHERE id = ? AND scheduled_date != ?").run(date, row.id, date);
    date = dateKeyPlus(date, 1);
  }
}
