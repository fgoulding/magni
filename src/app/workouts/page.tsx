import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { userDateKey } from "@/lib/user-date";
import { getProgressHistory } from "@/features/progress/queries";
import { ProgressDate, ProgressPagination, ProgressTabs, progressButton, progressInput } from "@/components/progress/ProgressChrome";
import { ReturnPosition } from "@/components/progress/ReturnPosition";
import { DateFields } from "@/components/progress/ProgressFilters";
import { searchUrl, single, type ProgressSearch } from "@/components/progress/navigation";
import { workoutEvidenceHref } from "@/components/progress/ExerciseEvidence";

export default async function WorkoutsPage({ searchParams }: { searchParams: Promise<ProgressSearch> }) {
  const user = await requireUser().catch(() => redirect("/login"));
  const params = await searchParams;
  const status = single(params.status);
  const page = getProgressHistory(user.id, { search: single(params.q), cursor: single(params.cursor), from: single(params.from), to: single(params.to), ...(status === "completed" || status === "in_progress" || status === "skipped" ? { status } : {}) });
  const currentHref = searchUrl("/workouts", params);
  const today = userDateKey(user.id);
  return <div className="safe-x flex flex-col gap-4 py-5">
    <ReturnPosition href={currentHref} /><header><p className="eyebrow text-xs text-brand-strong">Progress</p><h1 className="display mt-1 text-4xl">Workout history</h1></header>
    <ProgressTabs active="history" />
    <div className="flex flex-wrap gap-2"><Link href={`/workouts/new?date=${today}`} className={progressButton}>Add workout</Link><Link href="/history/routines" className={progressButton}>Saved routines</Link></div>
    <form role="search" aria-label="Workout history" action="/workouts" className="flex flex-col gap-3"><label className="font-semibold">Search workouts<input name="q" type="search" defaultValue={single(params.q)} className={`${progressInput} mt-1`} /></label><details className="card px-4"><summary className="touch-target cursor-pointer py-3 font-semibold">Filters · {status || "All statuses"}{params.from || params.to ? " · Dates selected" : ""}</summary><div className="flex flex-col gap-3 pb-4"><DateFields from={single(params.from)} to={single(params.to)} /><label className="text-sm text-muted">Workout status<select name="status" defaultValue={status} className={`${progressInput} mt-1`}><option value="">All statuses</option><option value="completed">Completed</option><option value="in_progress">In progress</option><option value="skipped">Skipped</option></select></label></div></details><button className={`${progressButton} self-start`}>Search</button></form>
    {!page.items.length && <div className="card p-5"><h2 className="display text-2xl">{params.q || params.from || params.to || params.status ? "No workouts match these filters" : "Your training starts here"}</h2><p className="mt-2 text-sm leading-6 text-muted">{params.q || params.from || params.to || params.status ? "Try another search or clear the filters to see your recorded workouts." : "Log today or add a workout from an earlier date. Finished workouts and drafts appear here."}</p><Link href="/workouts" className={`${progressButton} mt-3`}>Clear filters</Link></div>}
    <ol className="flex flex-col gap-3" aria-label="Workout history">{page.items.map(workout => <li key={workout.sessionId}><Link href={workoutEvidenceHref(workout.sessionId, currentHref)} className="card touch-target block p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted"><ProgressDate date={workout.date} /></p><span className={`text-sm font-semibold ${workout.status === "in_progress" ? "text-brand-strong" : "text-muted"}`}>{workout.status === "in_progress" ? "Resume" : workout.status === "skipped" ? "Skipped" : "Completed"}</span></div><h2 className="display mt-2 break-words text-2xl">{workout.name}</h2><p className="mt-1 break-words text-sm text-muted">{workout.programName}</p><p className="mt-2 text-base">{workout.loggedSets}/{workout.totalSets} sets · {Math.round(workout.volume).toLocaleString()} {workout.unit} volume</p>{workout.missingWeightSets > 0 && <p className="mt-1 text-sm text-muted">Load not recorded for {workout.missingWeightSets} sets; excluded from volume.</p>}</Link></li>)}</ol>
    <ProgressPagination currentHref={currentHref} nextCursor={page.nextCursor} previousCursor={page.previousCursor} count={page.items.length} noun="workouts" />
  </div>;
}
