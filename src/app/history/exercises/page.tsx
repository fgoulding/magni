import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { listProgressExercises, listProgressPrograms } from "@/features/progress/queries";
import type { ProgressFilters } from "@/features/progress/types";
import { ReturnPosition } from "@/components/progress/ReturnPosition";
import { ExerciseRows } from "@/components/progress/ExerciseRows";
import { ProgressBack, ProgressDate, ProgressPagination, progressButton, progressInput } from "@/components/progress/ProgressChrome";
import { DateFields } from "@/components/progress/ProgressFilters";
import { progressReturnTo, progressUrl, searchUrl, single, type ProgressSearch } from "@/components/progress/navigation";

export default async function ExerciseFinderPage({ searchParams }: { searchParams: Promise<ProgressSearch> }) {
  const user = await requireUser().catch(() => redirect("/login"));
  const params = await searchParams;
  const returnTo = single(params.returnTo) ? progressReturnTo(single(params.returnTo)) : undefined;
  const finderHref = (values: Record<string, string | number> = {}) => progressUrl("/history/exercises", { ...values, returnTo });
  const q = single(params.q).trim(), browse = single(params.browse), programId = single(params.programId);
  const filters: ProgressFilters = { search: q, cursor: single(params.cursor), from: single(params.from), to: single(params.to), ...(programId !== "" ? { programId: Number(programId) } : {}), sort: "name", initial: single(params.initial) };
  const requested = !!q || browse === "az" || programId !== "";
  const programs = browse === "programs" && !requested ? listProgressPrograms(user.id, filters) : null;
  const exercises = requested ? listProgressExercises(user.id, filters) : null;
  const currentHref = searchUrl("/history/exercises", params);
  return <div className="safe-x flex flex-col gap-4 py-5">
    <ReturnPosition href={currentHref} /><ProgressBack href={returnTo ?? "/history"} />
    <header><p className="eyebrow text-xs text-brand-strong">Progress</p><h1 className="display mt-1 text-4xl">Your exercises</h1></header>
    <form role="search" aria-label="Your exercises" action="/history/exercises" className="flex flex-col gap-3">
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      <div className="flex items-end gap-2"><label className="min-w-0 flex-1 font-semibold">Search exercises<input name="q" type="search" defaultValue={q} className={`${progressInput} mt-2`} placeholder="Name or past label" /></label><button className={progressButton}>Search</button></div>
      {programId !== "" && <><input type="hidden" name="programId" value={programId} /><input type="hidden" name="programName" value={single(params.programName)} /></>}
      {!q && browse === "az" && <input type="hidden" name="browse" value="az" />}
      <details className="card px-4"><summary className="touch-target cursor-pointer py-3 font-semibold">Filters · {programId !== "" ? single(params.programName) || (programId === "0" ? "Unplanned workouts" : "Selected program") : "All programs"}{filters.from || filters.to ? " · Dates selected" : ""}</summary><div className="flex flex-col gap-3 pb-4"><DateFields from={filters.from} to={filters.to} /><label className="text-sm text-muted">Starts with<input name="initial" maxLength={20} defaultValue={filters.initial} className={`${progressInput} mt-1`} /></label><Link href={finderHref()} className={`${progressButton} self-start`}>Clear filters</Link></div></details>
    </form>
    <div className="flex flex-wrap gap-2"><Link href={finderHref({ browse: "az" })} className={progressButton}>Browse A–Z</Link><Link href={finderHref({ browse: "programs" })} className={progressButton}>Browse by program</Link></div>
    {!requested && !programs && <p className="text-base leading-6 text-muted">Search a recorded name or choose how to browse. Your full collection stays here, without filling your overview.</p>}
    {programs && <section className="card p-4" aria-labelledby="program-browse-title"><h2 id="program-browse-title" className="display text-2xl">Programs</h2><ul className="divide-y divide-line">{programs.items.map(program => <li key={program.id}><Link href={finderHref({ programId: program.id, programName: program.name })} className="touch-target block py-4"><h3 className="display break-words text-xl">{program.name}</h3><p className="mt-1 text-sm text-muted">{program.sessionCount} workouts · <ProgressDate date={program.lastDate} /></p></Link></li>)}</ul>{!programs.items.length && <p className="my-3 text-muted">No recorded programs yet.</p>}<ProgressPagination currentHref={currentHref} nextCursor={programs.nextCursor} previousCursor={programs.previousCursor} count={programs.items.length} noun="programs" /></section>}
    {exercises && <section className="card p-4" aria-labelledby="exercise-results-title"><h2 id="exercise-results-title" className="display text-2xl">{q ? `Matches for “${q}”` : programId !== "" ? single(params.programName) || "Program exercises" : "Exercises A–Z"}</h2>
      <ProgressPagination currentHref={currentHref} nextCursor={exercises.nextCursor} previousCursor={exercises.previousCursor} count={exercises.items.length} />
      {!exercises.items.length ? <div className="py-4"><p role="status" className="text-muted">{q ? `No matches for “${q}” in this scope.` : "No recorded exercises in this scope."}</p><Link href={finderHref()} className={`${progressButton} mt-3`}>Clear search and filters</Link></div> : <ExerciseRows items={exercises.items} currentHref={currentHref} />}
      <ProgressPagination currentHref={currentHref} nextCursor={exercises.nextCursor} previousCursor={exercises.previousCursor} count={exercises.items.length} />
    </section>}
  </div>;
}
