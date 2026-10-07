import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { userDateKey } from "@/lib/user-date";
import { listProgressRoutines } from "@/features/progress/queries";
import { WorkoutReuse } from "@/components/WorkoutReuse";
import { ProgressBack, ProgressPagination } from "@/components/progress/ProgressChrome";
import { searchUrl, single, type ProgressSearch } from "@/components/progress/navigation";

export default async function RoutinesPage({ searchParams }: { searchParams: Promise<ProgressSearch> }) {
  const user = await requireUser().catch(() => redirect("/login"));
  const params = await searchParams;
  const page = listProgressRoutines(user.id, { cursor: single(params.cursor) });
  const today = userDateKey(user.id);
  return <div className="safe-x flex flex-col gap-4 py-5"><ProgressBack href="/workouts">Back to History</ProgressBack><h1 className="display text-4xl">Saved routines</h1><p className="text-muted">Choose a saved routine to start a new workout.</p>
    {page.items.map(routine => <details key={routine.id} className="card p-4"><summary className="touch-target cursor-pointer break-words font-semibold">{routine.name} · {routine.exerciseCount} {routine.exerciseCount === 1 ? "exercise" : "exercises"}</summary><div className="mt-3"><WorkoutReuse routineId={routine.id} name={routine.name} today={today} /></div></details>)}
    {!page.items.length && <p className="card p-5 text-muted">No saved routines. Open a recorded workout to save one.</p>}
    <ProgressPagination currentHref={searchUrl("/history/routines", params)} nextCursor={page.nextCursor} previousCursor={page.previousCursor} count={page.items.length} noun="routines" />
  </div>;
}
