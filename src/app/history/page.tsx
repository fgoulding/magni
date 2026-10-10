import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getExerciseDetail, getProgressHome, listUnlinkedExercises, resolveUnlinkedExerciseId } from "@/features/progress/queries";
import { PrimaryLiftComparison } from "@/components/progress/PrimaryLiftComparison";
import { ProgressOverview } from "@/components/progress/ProgressOverview";
import { decodeProgressKey, progressMetric, progressUrl, single, type ProgressSearch } from "@/components/progress/navigation";

export default async function ProgressPage({ searchParams }: { searchParams: Promise<ProgressSearch> }) {
  const user = await requireUser().catch(() => redirect("/login"));
  const params = await searchParams;
  if (single(params.lift)) redirect(`/history/exercises?q=${encodeURIComponent(single(params.lift))}`);
  const period = single(params.period) === "4w" ? "4w" : single(params.period) === "12w" ? "12w" : "all";
  const home = getProgressHome(user.id, { period });
  const requested = single(params.exercise);
  const defaultPrimary = home.primary.find(item => item.hasHistory);
  const defaultKey = defaultPrimary?.exercise ? `e:${defaultPrimary.exercise.id}` : defaultPrimary?.key ?? "";
  const initialKey = requested ? decodeProgressKey(requested) ?? "" : defaultKey;
  const metric = progressMetric(single(params.metric));
  const compare = single(params.view) === "big-three" || (!requested && single(params.view) !== "exercise");
  if (compare) {
    const lifts = home.primary.map(primary => ({ primary, detail: primary.hasHistory && primary.exercise ? getExerciseDetail(user.id, primary.exercise.id, { period, limit: 2 }) : null }));
    const currentHref = progressUrl("/history", { exercise: initialKey, period, metric, view: "big-three" });
    return <PrimaryLiftComparison lifts={lifts} activity={home.activity} period={period} currentHref={currentHref} initialMetric={metric} selectedKey={initialKey} />;
  }
  const singleExerciseId = initialKey.startsWith("u:") ? resolveUnlinkedExerciseId(user.id, initialKey) : null;
  const primary = home.primary.find(item => item.key === initialKey);
  const selectedKey = singleExerciseId ? `e:${singleExerciseId}` : primary?.exercise ? `e:${primary.exercise.id}` : initialKey;
  const detail = selectedKey.startsWith("e:") ? getExerciseDetail(user.id, selectedKey.slice(2), { period, limit: 2 }) : null;
  const candidates = selectedKey.startsWith("u:") ? listUnlinkedExercises(user.id, selectedKey, { period, limit: 2 }).items : [];
  const selectionError = requested && (!selectedKey || (selectedKey.startsWith("e:") && !detail)) ? "This exercise is unavailable. Choose another exercise from your history." : undefined;
  const selectedName = detail?.exercise.name ?? primary?.name ?? home.recent.find(item => item.key === selectedKey)?.name ?? candidates[0]?.recordedName ?? (selectedKey.startsWith("u:") ? listUnlinkedExercises(user.id, selectedKey, { limit: 1 }).items[0]?.recordedName : undefined);
  const currentHref = progressUrl("/history", { exercise: selectedKey, period, metric, view: single(params.view) === "exercise" || !selectedKey ? "exercise" : undefined });
  return <ProgressOverview home={home} period={period} currentHref={currentHref} initialMetric={metric} selectedKey={selectedKey} selectedName={selectedName} detail={detail} unlinked={candidates} selectionError={selectionError} />;
}
