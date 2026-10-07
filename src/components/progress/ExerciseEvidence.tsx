import Link from "next/link";
import type { ExerciseObservation } from "@/features/progress/types";
import { ProgressDate, progressButton } from "./ProgressChrome";

const number = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
import { workoutEvidenceHref } from "./navigation";
export { workoutEvidenceHref } from "./navigation";
export { RecordedRepsChart } from "./ExerciseProgressChart";

export function ExerciseEvidence({ observations, currentHref }: { observations: ExerciseObservation[]; currentHref: string }) {
  return <ol aria-label="Recorded workouts" className="divide-y divide-line">
    {observations.map(observation => <li key={observation.sessionId} className="py-4 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><h3 className="display break-words text-xl">{observation.workoutName}</h3><span className="text-sm text-muted"><ProgressDate date={observation.date} /></span></div>
      <p className="mt-1 break-words text-sm text-muted">{observation.programName}</p>
      <p className="mt-1 break-words text-sm text-muted">Recorded as {observation.recordedNames.join(" · ")}</p>
      <ul aria-label={`Actual sets in ${observation.workoutName} on ${observation.date}`} className="mt-3 flex flex-col gap-1 text-base">
        {observation.sets.map(set => <li key={set.setId}>{set.count > 1 && <span>{set.count} sets × </span>}<span>{number(set.reps)} reps · {set.weight === null ? "load not recorded" : `${number(set.weight)} ${set.unit}`}</span>{set.role && <span className="text-sm text-muted"> · {set.role}</span>}</li>)}
      </ul>
      <Link href={workoutEvidenceHref(observation.sessionId, currentHref)} className={`${progressButton} mt-3`}>View workout</Link>
    </li>)}
  </ol>;
}
