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
  progression_type?: string;
};

/** Bodyweight exercises carry no training max; weight is an optional added load. */
export function isBodyweight(set: WorkoutSet): boolean {
  return set.progression_type === "bodyweight";
}

export type WorkoutGroup = {
  index: number;
  sets: WorkoutSet[];
  supersetGroup: string | null;
};

export type SessionResponse = {
  id: number;
  sets: WorkoutSet[];
};

export type WorkoutSummaryRow = {
  key: string;
  exerciseName: string;
  reps: number;
  weight: number | null;
  tonnage: number;
};

/** Group consecutive sets into supersets (shared group token) or same-exercise runs. */
export function buildGroups(sets: WorkoutSet[]): WorkoutGroup[] {
  const groups: WorkoutGroup[] = [];
  let i = 0;
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
      groups.push({ index: i, sets: [set], supersetGroup: set.superset_group });
    }
    i++;
  }
  return groups;
}

export function lastGroupIndex(groups: WorkoutGroup[]): number {
  return groups.length - 1;
}

export function groupExerciseNames(group: WorkoutGroup): string[] {
  return [...new Set(group.sets.map((s) => s.exercise_name))];
}

/** A flat single-lift group has one exercise and identical weight/reps across its sets. */
export function isFlatSingle(group: WorkoutGroup): boolean {
  if (group.supersetGroup || groupExerciseNames(group).length !== 1) return false;
  const first = group.sets[0];
  return group.sets.every((s) => s.calculated_weight === first.calculated_weight && s.reps === first.reps);
}

export function buildSummaryRows(
  sets: WorkoutSet[],
  completedSetIds: ReadonlySet<number>,
  values: Record<number, number>,
): WorkoutSummaryRow[] {
  const rows = new Map<string, WorkoutSummaryRow>();

  for (const set of sets) {
    if (!completedSetIds.has(set.id)) continue;

    const key = set.exercise_name;
    const reps = values[set.id] ?? set.actual_reps ?? set.rep_out_target;
    const bw = isBodyweight(set);
    // Bodyweight: no displayed load (shows "N reps"); tonnage counts only added weight.
    const setWeight = bw ? (set.actual_weight ?? 0) : set.calculated_weight;
    const existing = rows.get(key);
    rows.set(key, {
      key,
      exerciseName: set.exercise_name,
      reps: (existing?.reps ?? 0) + reps,
      weight: bw ? null : existing && existing.weight !== set.calculated_weight ? null : set.calculated_weight,
      tonnage: (existing?.tonnage ?? 0) + reps * setWeight,
    });
  }

  return [...rows.values()];
}

export function summaryDetail(row: WorkoutSummaryRow): string {
  if (row.weight === null) return `${row.reps} reps`;
  return `${row.reps} reps @ ${row.weight} lb`;
}

export function formatTonnage(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}
