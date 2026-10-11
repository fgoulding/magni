import type { WorkoutSet } from "./workout-card-utils";
import styles from "./WorkoutSaveStatus.module.css";

/** Count physical sets using the same acknowledged state as each row. */
export function WorkoutSaveStatus({ sets, isSaved }: { sets: WorkoutSet[]; isSaved: (set: WorkoutSet) => boolean }) {
  const total = sets.reduce((sum, set) => sum + Math.max(1, set.sets), 0);
  const saved = sets.filter(isSaved).reduce((sum, set) => sum + Math.max(1, set.sets), 0);
  return <section aria-label="Workout progress" className="px-4 pb-3 pt-2">
    <p className="text-sm font-semibold">{saved} of {total} sets saved</p>
    <progress aria-label="Saved sets" aria-valuenow={saved} aria-valuemin={0} aria-valuemax={total} value={saved} max={Math.max(1, total)} className={`${styles.progress} mt-2`} />
  </section>;
}
