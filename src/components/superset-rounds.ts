import { editorMetadata, type WorkoutGroup, type WorkoutSet } from "./workout-card-utils";

export type SupersetRound = { number: number; entries: { set: WorkoutSet; label: string }[] };

function appearanceKey(set: WorkoutSet): string | null {
  const editorId = editorMetadata(set)?.exerciseId;
  if (editorId) return `editor:${editorId}`;
  if (set.program_definition_exercise_id != null) return `definition:${set.program_definition_exercise_id}`;
  if (set.exercise_key) return `exercise:${set.exercise_key}`;
  return null;
}

function appearanceLetter(index: number): string {
  let letter = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letter = String.fromCharCode(97 + (n - 1) % 26) + letter;
  return letter;
}

/** View-only projection. Each entry remains the original physical session row. */
export function buildSupersetRounds(group: WorkoutGroup): SupersetRound[] | null {
  if (!group.supersetGroup || group.sets.some(set => set.sets > 1)) return null;
  const appearances = new Map<string, WorkoutSet[]>();
  let previousLegacy: WorkoutSet | undefined;
  let legacyRun = 0;
  for (const set of group.sets) {
    let key = appearanceKey(set);
    if (key === null) {
      if (!previousLegacy || previousLegacy.exercise_name !== set.exercise_name || set.set_number <= previousLegacy.set_number) legacyRun++;
      key = `legacy:${legacyRun}`;
      previousLegacy = set;
    } else previousLegacy = undefined;
    const rows = appearances.get(key) ?? [];
    rows.push(set);
    appearances.set(key, rows);
  }
  if (appearances.size < 2) return null;
  const buckets = [...appearances.values()];
  return Array.from({ length: Math.max(...buckets.map(rows => rows.length)) }, (_, index) => ({
    number: index + 1,
    entries: buckets.flatMap((rows, appearance) => rows[index] ? [{ set: rows[index], label: `${index + 1}${appearanceLetter(appearance)}` }] : []),
  }));
}
