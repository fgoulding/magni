import { withWorkoutReturn, workoutReturnHref } from "@/features/workouts/navigation";
import { resolveSetExerciseIdentities } from "@/features/progress/identity";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { userDateKey } from "@/lib/user-date";
import { numberParam } from "@/lib/api";
import { getWorkout } from "@/features/workouts/history-service";
import { getOccurrence } from "@/features/programs/occurrences";
import { QuickWorkout } from "@/components/QuickWorkout";
import { WorkoutHistoryDetail } from "@/components/WorkoutHistoryDetail";
export default async function WorkoutPage({ params, searchParams }: { params: Promise<{ sessionId: string }>; searchParams?: Promise<{ returnTo?: string }> }) {
  const user = await requireUser().catch(() => redirect("/login")); const session = getWorkout(user.id, numberParam((await params).sessionId));
  if (!session) notFound();
  const returnTo = workoutReturnHref((await searchParams)?.returnTo);
  const detailHref = withWorkoutReturn(`/workouts/${session.id}`, returnTo);
  const progressLinks = Object.fromEntries([...resolveSetExerciseIdentities(user.id, session.id)].map(([setId, identity]) => [setId, withWorkoutReturn(`/history/exercises/${encodeURIComponent(`e:${identity.exerciseId}`)}`, detailHref)]));
  const returnLabel = returnTo?.startsWith("/calendar?") ? "← Back to Calendar" : returnTo?.startsWith("/history") ? "← Back to Progress" : returnTo?.startsWith("/today") ? "← Back to Today" : returnTo?.startsWith("/workouts/") ? "← Back to workout" : "← Workout history";
  const occurrenceId = (session as typeof session & { occurrence_id?: number | null }).occurrence_id;
  const occurrence = occurrenceId ? getOccurrence(user.id, occurrenceId) : undefined;
  const resumeHref = withWorkoutReturn((!returnTo || returnTo.startsWith("/calendar?")) && occurrence?.session_id === session.id && occurrence.program_id === session.program_id
    ? `/calendar?month=${occurrence.scheduled_date.slice(0, 7)}&date=${occurrence.scheduled_date}&workout=occurrence-${occurrence.id}`
    : `/workouts/${session.id}/resume`, returnTo);
  return <div className="safe-x flex flex-col gap-4 py-5"><Link href={returnTo ?? "/workouts"} className="touch-target inline-flex items-center text-sm font-semibold text-muted">{returnLabel}</Link>{session.status === "in_progress" ? session.program_id === null ? <QuickWorkout initialSession={session} /> : <section className="card p-4"><h1 className="display text-3xl">{session.name}</h1><p className="mt-2 text-sm text-muted">This planned workout is in progress.</p><Link href={resumeHref} className="touch-target mt-3 inline-flex items-center text-brand-strong">Resume planned workout</Link></section> : <WorkoutHistoryDetail initialSession={session} today={userDateKey(user.id)} progressLinks={progressLinks} />}</div>;
}
