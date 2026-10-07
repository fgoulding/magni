import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getExerciseCandidates, getExerciseDetail, listProgressExercises, listUnlinkedExercises } from "@/features/progress/queries";
import { IdentitySelection } from "@/components/progress/IdentitySelection";
import { ProgressBack, ProgressPagination, progressButton, progressInput } from "@/components/progress/ProgressChrome";
import { progressReturnTo, progressUrl, searchUrl, single, type ProgressSearch } from "@/components/progress/navigation";

export default async function FollowPage({ searchParams }: { searchParams: Promise<ProgressSearch> }) {
  const user = await requireUser().catch(() => redirect("/login"));
  const params = await searchParams;
  const key = single(params.key), target = single(params.target), mode = single(params.mode) === "detach" ? "detach" : "link";
  const returnTo = progressReturnTo(single(params.returnTo), "/history/exercises");
  const targetDetail = target ? getExerciseDetail(user.id, target, { limit: 1 }) : null;
  if (target && !targetDetail) notFound();
  const name = targetDetail?.exercise.name ?? single(params.name);
  const cursor = single(params.cursor);
  const filters = { cursor, from: single(params.from), to: single(params.to) };
  const candidates = key.startsWith("u:") ? listUnlinkedExercises(user.id, key, filters) : key.startsWith("e:") ? getExerciseCandidates(user.id, key.slice(2), filters) : null;
  const candidatesUrl = progressUrl("/api/progress/exercises", { ...(key.startsWith("u:") ? { group: key } : { exerciseId: key.slice(2), candidates: 1 }), from: filters.from, to: filters.to });
  const q = single(params.q) || name;
  const choices = !candidates && q ? listProgressExercises(user.id, { search: q, cursor, sort: "name" }) : null;
  return <div className="safe-x flex flex-col gap-4 py-5"><ProgressBack href={returnTo}>Back to records</ProgressBack><header><p className="eyebrow text-xs text-brand-strong">Progress</p><h1 className="display mt-1 text-4xl">{mode === "detach" ? "Edit included workouts" : "Connect selected workouts"}</h1><p className="mt-3 text-sm leading-6 text-muted">Choose only the recorded exercises that belong together. Recorded sets, future workouts and your training plan stay unchanged.</p></header>
    {candidates ? <IdentitySelection key={`${user.id}:${key}:${target}:${mode}`} draftKey={`magni.progress.grouping.${user.id}.${key}.${target}.${mode}.${single(params.observation)}`} initialPage={candidates} candidatesUrl={candidatesUrl} initialCursor={cursor} initialName={name || candidates.items[0]?.recordedName || ""} initialSelectedId={Number(single(params.observation)) || undefined} targetExerciseId={target || undefined} mode={mode} returnTo={returnTo} /> : <>
      <form action="/history/follow" role="search" aria-label="Matching recorded exercises" className="flex flex-col gap-3"><input type="hidden" name="target" value={target} /><input type="hidden" name="returnTo" value={returnTo} /><label className="font-semibold">Search recorded names<input type="search" name="q" defaultValue={q} className={`${progressInput} mt-1`} /></label><button className={`${progressButton} self-start`}>Search</button></form>
      {choices && <section className="card p-4"><h2 className="display text-2xl">Choose records to inspect</h2><ul className="divide-y divide-line">{choices.items.filter(item => item.key !== `e:${target}`).map(item => <li key={item.key}><Link href={progressUrl("/history/follow", { key: item.key, target, name: name || item.name, returnTo })} className="touch-target block py-4"><h3 className="display break-words text-xl">{item.kind === "unlinked" ? `Records named ${item.name}` : item.name}</h3><p className="mt-1 text-sm text-muted">{item.historyCount} recorded workouts · {item.context}</p></Link></li>)}</ul>{!choices.items.some(item => item.key !== `e:${target}`) && <p className="my-3 text-muted">No other matching records. Try another recorded name.</p>}<ProgressPagination currentHref={searchUrl("/history/follow", params)} nextCursor={choices.nextCursor} previousCursor={choices.previousCursor} count={choices.items.filter(item => item.key !== `e:${target}`).length} /></section>}
    </>}
  </div>;
}
