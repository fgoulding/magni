import type { EditorSetMetadata } from "@/features/program-editor/repository";

export type WorkoutSet = {
  id: number;
  exercise_name: string;
  reps: number;
  sets: number;
  set_number: number;
  rep_out_target: number;
  calculated_weight: number;
  actual_reps: number | null;
  actual_weight: number | null;
  superset_group: string | null;
  training_max?: number | null;
  intensity_pct?: number | null;
  progression_type?: string;
  editor_json?: string | null;
};

export function editorMetadata(set: WorkoutSet): EditorSetMetadata | null {
  if (!set.editor_json) return null;
  try { return JSON.parse(set.editor_json) as EditorSetMetadata; } catch { return null; }
}

export function setUnit(set: WorkoutSet, fallback: "lb" | "kg" = "lb"): "lb" | "kg" {
  return editorMetadata(set)?.unit ?? fallback;
}

/** Parse a fetch Response's JSON body, tolerating an empty or non-JSON body
 *  (e.g. a 500 HTML page or a 204). Returns null instead of throwing a
 *  SyntaxError so callers can surface a clean error message, not "Unexpected
 *  token …". */
export async function readResponseJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Bodyweight exercises carry no training max; weight is an optional added load. */
export function isBodyweight(set: WorkoutSet): boolean {
  const editor = editorMetadata(set);
  if (editor?.set) return editor.set.loadMode === "bodyweight" || editor.set.loadMode === "added";
  return set.progression_type === "bodyweight";
}

export type WorkoutGroup = {
  index: number;
  sets: WorkoutSet[];
  supersetGroup: string | null;
};

export type LastPerformance = {
  date: string;
  unit?: "lb" | "kg";
  reps: number[];
  topWeight: number;
  bodyweight: boolean;
};

export type SessionResponse = {
  id: number;
  unit?: "lb" | "kg";
  sets: WorkoutSet[];
  /** Most recent prior completed performance, keyed by exercise name. */
  lastPerformance?: Record<string, LastPerformance>;
};

export type WorkoutSummaryRow = {
  key: string;
  exerciseName: string;
  reps: number;
  weight: number | null;
  tonnage: number;
  unit: "lb" | "kg";
};

/** Group consecutive sets into supersets (shared group token) or same-exercise runs. */
export function buildGroups(sets: WorkoutSet[]): WorkoutGroup[] {
  const groups: WorkoutGroup[] = [];
  for (const set of sets) {
    if (
      set.superset_group &&
      groups.length > 0 &&
      groups[groups.length - 1].supersetGroup === set.superset_group
    ) {
      groups[groups.length - 1].sets.push(set);
    } else if (
      groups.length > 0 &&
      !groups[groups.length - 1].supersetGroup &&
      !set.superset_group &&
      groups[groups.length - 1].sets[0].exercise_name === set.exercise_name
    ) {
      groups[groups.length - 1].sets.push(set);
    } else {
      // index is the group's ORDINAL position — it drives currentGroupIdx, which
      // indexes the groups array. (Using the flat set index broke navigation once
      // a group held more than one set, e.g. a flat-single lift or a superset.)
      groups.push({ index: groups.length, sets: [set], supersetGroup: set.superset_group });
    }
  }
  return groups;
}

export function lastGroupIndex(groups: WorkoutGroup[]): number {
  return groups.length - 1;
}

export function groupExerciseNames(group: WorkoutGroup): string[] {
  return [...new Set(group.sets.map((s) => s.exercise_name))];
}

/** A flat single-lift group has one exercise and identical weight/reps across its sets.
 *  Bodyweight is excluded so each set logs its own (usually dropping) rep count. */
export function isFlatSingle(group: WorkoutGroup): boolean {
  if (group.supersetGroup || groupExerciseNames(group).length !== 1) return false;
  if (group.sets.some((set) => set.editor_json)) return false;
  if (isBodyweight(group.sets[0])) return false;
  const first = group.sets[0];
  return group.sets.every((s) => s.calculated_weight === first.calculated_weight && s.reps === first.reps);
}

export function buildSummaryRows(
  sets: WorkoutSet[],
  completedSetIds: ReadonlySet<number>,
  values: Record<number, number>,
  weights: Record<number, number> = {},
  added: Record<number, number> = {},
  unit: "lb" | "kg" = "lb",
): WorkoutSummaryRow[] {
  const rows = new Map<string, WorkoutSummaryRow>();

  for (const set of sets) {
    if (!completedSetIds.has(set.id)) continue;

    const rowUnit = setUnit(set, unit);
    const key = `${set.exercise_name}:${rowUnit}`;
    const reps = values[set.id] ?? set.actual_reps ?? set.rep_out_target;
    const bw = isBodyweight(set);
    // Use the in-workout edited load when present: added weight for bodyweight,
    // the edited working weight for supersets/custom, else the prescribed weight.
    const displayWeight = weights[set.id] ?? set.actual_weight ?? set.calculated_weight;
    const setWeight = bw ? (added[set.id] ?? set.actual_weight ?? 0) : displayWeight;
    // A flat exercise is one row standing in for `sets` identical sets; a ramp is
    // one row per set (sets = 1). Multiply so total reps & tonnage count every set.
    const setCount = set.sets > 0 ? set.sets : 1;
    const existing = rows.get(key);
    rows.set(key, {
      key,
      exerciseName: set.exercise_name,
      reps: (existing?.reps ?? 0) + reps * setCount,
      weight: bw ? null : existing && existing.weight !== displayWeight ? null : displayWeight,
      tonnage: (existing?.tonnage ?? 0) + reps * setWeight * setCount,
      unit: rowUnit,
    });
  }

  return [...rows.values()];
}

export function summaryDetail(row: WorkoutSummaryRow): string {
  if (row.weight === null) return `${row.reps} reps`;
  return `${row.reps} reps @ ${row.weight} ${row.unit}`;
}

export function formatTonnage(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}
