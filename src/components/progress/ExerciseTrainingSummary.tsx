import type { ExerciseDetail } from "@/features/progress/types";
import { ProgressDate } from "./ProgressChrome";

/** Original-unit activity for this exercise and range, distinct from whole-account totals. */
export function ExerciseTrainingSummary({ detail }: { detail: ExerciseDetail }) {
  const { training, totals } = detail;
  if (!training) return null;
  const format = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
  return <section aria-label="Training in this range" className="min-w-0 rounded-xl border border-line px-4 py-3">
    <h2 className="display text-2xl">Training in this range</h2>
    <dl className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(min(100%,5.5rem),1fr))] gap-3">
      <div role="group" aria-label={`${totals.sessions} workouts`}><dt className="text-xs text-muted">Workouts</dt><dd className="display text-3xl">{format(totals.sessions)}</dd></div>
      <div role="group" aria-label={`${totals.recordedSets} recorded sets`}><dt className="text-xs text-muted">Recorded sets</dt><dd className="display text-3xl">{format(totals.recordedSets)}</dd></div>
      <div className="min-w-0"><dt className="text-xs text-muted">Load volume</dt><dd className="mt-1 space-y-1">{training.volumeByUnit.length ? training.volumeByUnit.map(item => <span key={item.unit} className="block"><span className="display break-words text-2xl">{item.recordedSets > 0 && item.missingWeightSets === item.recordedSets ? "—" : format(item.volume)}</span> <span className="text-xs text-muted">{item.unit}·reps</span></span>) : <span className="display text-2xl">—</span>}</dd></div>
    </dl>
    <p className="mt-2 text-xs leading-5 text-muted">{training.activeWeeks} active {training.activeWeeks === 1 ? "week" : "weeks"}{training.firstDate && training.lastDate ? <> · <ProgressDate date={training.firstDate} />{training.lastDate !== training.firstDate && <>–<ProgressDate date={training.lastDate} /></>}</> : null}</p>
    {totals.missingWeightSets > 0 && <p className="mt-1 text-xs leading-5 text-muted">Load not recorded for {totals.missingWeightSets} {totals.missingWeightSets === 1 ? "set" : "sets"}; excluded from volume.</p>}
  </section>;
}
