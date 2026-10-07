import Link from "next/link";
import type { CandidateObservation } from "@/features/progress/types";
import { actualResult } from "./ExerciseRows";
import { ProgressDate, progressButton } from "./ProgressChrome";
import { workoutEvidenceHref } from "./ExerciseEvidence";
import { progressUrl } from "./navigation";

export function CandidateRecords({ candidates, currentHref, groupKey, cursor }: { candidates: CandidateObservation[]; currentHref: string; groupKey: string; cursor?: string }) {
  return <ol className="divide-y divide-line" aria-label="Unlinked recorded exercises">{candidates.map(candidate => <li key={candidate.id} className="py-4"><h2 className="display break-words text-2xl">{candidate.recordedName}</h2><p className="mt-1 text-sm text-muted"><ProgressDate date={candidate.date} /> · {candidate.workoutName}</p><p className="mt-1 text-sm text-muted">{candidate.programName}</p><p className="mt-2 text-base">{actualResult(candidate.latest)}</p><div className="mt-3 flex flex-wrap gap-2"><Link href={workoutEvidenceHref(candidate.sessionId, currentHref)} className={progressButton}>View workout</Link><Link href={progressUrl("/history/follow", { key: groupKey, observation: candidate.id, cursor, returnTo: currentHref })} className={progressButton}>Follow this record</Link></div></li>)}</ol>;
}
