import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { userDateKey } from "@/lib/user-date";
import { listRoutines, listWorkouts } from "@/features/workouts/history-service";
import { WorkoutReuse } from "@/components/WorkoutReuse";
export default async function WorkoutsPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const user = await requireUser().catch(() => redirect("/login"));
  const { before } = await searchParams;
  const workouts = listWorkouts(user.id, before); const routines = listRoutines(user.id); const today = userDateKey(user.id);
  return <div className="safe-x flex flex-col gap-4 py-5"><header><p className="eyebrow text-xs text-brand-strong">Your training</p><h1 className="display text-4xl">Workout history</h1><Link href={`/workouts/new?date=${today}`} className="touch-target mt-4 inline-flex items-center rounded-xl bg-brand px-4 text-base font-semibold text-white">Add workout</Link></header>
    {!workouts.length && <div className="card p-6"><h2 className="display text-2xl">Your training starts here</h2><p className="mt-2 text-sm text-muted">Log today or add a workout from an earlier date. Finished workouts and drafts appear here.</p></div>}
    <ol className="flex flex-col gap-3">{workouts.map((workout) => <li key={workout.id}><Link href={`/workouts/${workout.id}`} className="card block p-4"><div className="flex items-center justify-between gap-3"><p className="eyebrow text-xs text-muted">{workout.date}</p><span className={`text-xs font-semibold ${workout.status === "in_progress" ? "text-brand-strong" : "text-muted"}`}>{workout.status === "in_progress" ? "Resume" : workout.status === "skipped" ? "Skipped" : "Completed"}</span></div><h2 className="display mt-2 text-2xl">{workout.name}</h2><p className="mt-1 text-sm text-muted">{workout.loggedSets}/{workout.totalSets} sets · {Math.round(workout.volume).toLocaleString()} {workout.unit} volume</p></Link></li>)}</ol>
    {workouts.length === 100 && <Link href={`/workouts?before=${workouts.at(-1)!.date}:${workouts.at(-1)!.id}`} className="touch-target inline-flex items-center justify-center rounded-xl border border-line px-4 text-sm font-semibold">Older workouts</Link>}
    {routines.length > 0 && <section><h2 className="display mb-3 text-2xl">Saved routines</h2><div className="flex flex-col gap-3">{routines.map((routine) => <details key={routine.id} className="card p-4"><summary className="touch-target cursor-pointer font-semibold">{routine.name} · {routine.exerciseCount} {routine.exerciseCount === 1 ? "exercise" : "exercises"}</summary><div className="mt-3"><WorkoutReuse routineId={routine.id} name={routine.name} today={today} /></div></details>)}</div></section>}
  </div>;
}
