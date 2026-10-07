import type { ProgressSet } from "@/features/progress/types";

/** Pick an actual completed set, preserving the logged load, reps, and unit. */
export function representativeSet(sets: ProgressSet[]): ProgressSet | null {
  const completed = sets.filter(set => set.reps > 0);
  if (!completed.length) return sets[0] ?? null;
  if (!completed.some(set => set.weight !== null && set.weight > 0)) return completed.reduce((best, set) => set.reps > best.reps ? set : best);
  return completed.reduce((best, set) => {
    if (set.weight !== null && (best.weight === null || set.weight > best.weight)) return set;
    if (set.weight === best.weight && set.reps > best.reps) return set;
    return best;
  });
}
