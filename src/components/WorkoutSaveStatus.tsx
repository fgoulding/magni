import { setUnit, type WorkoutSet } from "./workout-card-utils";
import styles from "./WorkoutSaveStatus.module.css";

/** Current row-save state and acknowledged volume are intentionally separate. */
export function WorkoutSaveStatus({ sets, isSaved, unit = "lb" }: { sets: WorkoutSet[]; isSaved: (set: WorkoutSet) => boolean; unit?: "lb" | "kg" }) {
  const total = sets.reduce((sum, set) => sum + Math.max(1, set.sets), 0);
  const saved = sets.filter(isSaved).reduce((sum, set) => sum + Math.max(1, set.sets), 0);
  const recorded = new Map<string, { volume: number; knownLoads: number; missingLoads: number }>();
  for (const set of sets) {
    if (set.actual_reps == null) continue;
    const originalUnit = setUnit(set, unit);
    const item = recorded.get(originalUnit) ?? { volume: 0, knownLoads: 0, missingLoads: 0 };
    const count = Math.max(1, set.sets);
    if (set.actual_weight == null) item.missingLoads += count;
    else { item.volume += set.actual_reps * set.actual_weight * count; item.knownLoads += count; }
    recorded.set(originalUnit, item);
  }
  return <section aria-label="Workout progress" className="px-4 pb-3 pt-2">
    <p className="text-sm font-semibold">{saved} of {total} sets saved</p>
    <progress aria-label="Saved sets" aria-valuenow={saved} aria-valuemin={0} aria-valuemax={total} value={saved} max={Math.max(1, total)} className={`${styles.progress} mt-2`} />
    {recorded.size > 0 && <p className="mt-1 text-xs leading-5 text-muted">Recorded volume: {[...recorded].map(([originalUnit, item], index) => <span key={originalUnit}>{index ? " · " : ""}{item.knownLoads ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(item.volume)} ${originalUnit}·reps` : `load not recorded (${originalUnit})`}{item.missingLoads && item.knownLoads ? " (some loads missing)" : ""}</span>)}</p>}
  </section>;
}
