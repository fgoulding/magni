import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getExerciseDetail, getProgressHome, listUnlinkedExercises } from "@/features/progress/queries";
import { CandidateRecords } from "@/components/progress/CandidateRecords";
import { ExerciseEvidence, RecordedRepsChart } from "@/components/progress/ExerciseEvidence";
import { DetailDateFilter } from "@/components/progress/ProgressFilters";
import { PinControl } from "@/components/progress/PinControl";
import { ProgressBack, ProgressPagination, progressButton } from "@/components/progress/ProgressChrome";
import { decodeProgressKey, progressReturnTo, progressUrl, searchUrl, single, type ProgressSearch } from "@/components/progress/navigation";

export default async function ExercisePage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<ProgressSearch> }) {
  const user = await requireUser().catch(() => redirect("/login"));
  const { key: rawKey } = await params;
  const key = decodeProgressKey(rawKey);
  if (!key) notFound();
  const search = await searchParams;
  const path = `/history/exercises/${encodeURIComponent(key)}`;
  const currentHref = searchUrl(path, search);
  const returnTo = progressReturnTo(single(search.returnTo), "/history/exercises");
  const backLabel = /^\/workouts\/\d+(?:\/|\?|$)/.test(returnTo) ? "Back to workout" : returnTo.startsWith("/history/exercises") ? "Back to results" : "Back to Progress";
  const filters = { cursor: single(search.cursor), from: single(search.from), to: single(search.to) };
  if (key.startsWith("u:")) {
    const candidates = listUnlinkedExercises(user.id, key, filters);
    const name = candidates.items[0]?.recordedName ?? "Recorded exercises";
    return <div className="safe-x flex flex-col gap-4 py-5"><ProgressBack href={returnTo}>{backLabel}</ProgressBack><header><p className="eyebrow text-xs text-brand-strong">Recorded names</p><h1 className="display mt-1 break-words text-4xl">{name}</h1><p className="mt-3 text-sm leading-6 text-muted">These records share a name. They remain separate until you choose which workouts describe one exercise.</p></header><Link href={progressUrl("/history/follow", { key, name, returnTo: currentHref })} className={`${progressButton} self-start`}>Follow as one exercise</Link><DetailDateFilter path={path} from={filters.from} to={filters.to} returnTo={returnTo} /><section className="card px-4"><CandidateRecords candidates={candidates.items} currentHref={currentHref} groupKey={key} cursor={filters.cursor} />{!candidates.items.length && <p className="py-5 text-muted">No unlinked records in this period. They may already be included in an exercise.</p>}</section><ProgressPagination currentHref={currentHref} nextCursor={candidates.nextCursor} previousCursor={candidates.previousCursor} count={candidates.items.length} noun="records" /></div>;
  }
  if (!key.startsWith("e:")) notFound();
  const detail = getExerciseDetail(user.id, key.slice(2), filters);
  if (!detail) notFound();
  const home = getProgressHome(user.id, {});
  return <div className="safe-x flex flex-col gap-4 py-5"><ProgressBack href={returnTo}>{backLabel}</ProgressBack>
    <header><p className="eyebrow text-xs text-brand-strong">Exercise progress</p><h1 className="display mt-1 break-words text-4xl">{detail.exercise.name}</h1><p className="mt-2 text-sm text-muted">{detail.exercise.origin === "lineage" ? "Repeated workouts from this exercise stay together. Other exercises with matching names stay separate." : "Your chosen exercise records. Original workout names and units are preserved."}</p></header>
    <PinControl key={`${detail.exercise.id}:${detail.exercise.pinned}:${home.pinned.map(pin => pin.id).join()}`} exerciseId={detail.exercise.id} name={detail.exercise.name} pinned={detail.exercise.pinned} pins={home.pinned} />
    <DetailDateFilter path={path} from={filters.from} to={filters.to} returnTo={returnTo} />
    <RecordedRepsChart points={detail.chart.points} truncated={detail.chart.truncated} currentHref={currentHref} />
    <section className="card p-4" aria-labelledby="recorded-workouts-heading"><h2 id="recorded-workouts-heading" className="display mb-4 text-2xl">Recorded workouts</h2><p className="mb-4 text-sm text-muted">Actual values in their original units. Unlogged sets are available in the source workout.</p><ExerciseEvidence observations={detail.observations.items} currentHref={currentHref} /><ProgressPagination currentHref={currentHref} nextCursor={detail.observations.nextCursor} previousCursor={detail.observations.previousCursor} count={detail.observations.items.length} noun="workouts" /></section>
    <section className="card p-4"><h2 className="display text-2xl">Included records</h2><p className="mt-2 text-sm leading-6 text-muted">Add selected past workouts or separate records that describe another variation. These changes affect Progress only.</p><div className="mt-3 flex flex-wrap gap-2"><Link href={progressUrl("/history/follow", { target: detail.exercise.id, name: detail.exercise.name, returnTo: currentHref })} className={progressButton}>Add matching records</Link><Link href={progressUrl("/history/follow", { key, mode: "detach", name: detail.exercise.name, returnTo: currentHref })} className={progressButton}>Edit included workouts</Link></div></section>
  </div>;
}
