import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getExerciseDetail, getProgressHome, listUnlinkedExercises, resolveUnlinkedExerciseId } from "@/features/progress/queries";
import { ProgressOverview } from "@/components/progress/ProgressOverview";
import { decodeProgressKey, progressMetric, progressUrl, single, type ProgressSearch } from "@/components/progress/navigation";

export default async function ProgressPage({ searchParams }: { searchParams: Promise<ProgressSearch> }) {
  const user = await requireUser().catch(() => redirect("/login"));
  const params = await searchParams;
  if (single(params.lift)) redirect(`/history/exercises?q=${encodeURIComponent(single(params.lift))}`);
  const period = single(params.period) === "4w" ? "4w" : single(params.period) === "all" ? "all" : "12w";
  const home = getProgressHome(user.id, { period });
  const requested = single(params.exercise);
  const defaultKey = home.pinned[0] ? `e:${home.pinned[0].id}` : home.recent.find(item => item.kind === "exercise" && item.exercise?.origin !== "unlinked")?.key ?? home.recent[0]?.key ?? "";
  const initialKey = requested ? decodeProgressKey(requested) ?? "" : defaultKey;
  const singleExerciseId = initialKey.startsWith("u:") ? resolveUnlinkedExerciseId(user.id, initialKey) : null;
  const selectedKey = singleExerciseId ? `e:${singleExerciseId}` : initialKey;
  const detail = selectedKey.startsWith("e:") ? getExerciseDetail(user.id, selectedKey.slice(2), { period, limit: 2 }) : null;
  const candidates = selectedKey.startsWith("u:") ? listUnlinkedExercises(user.id, selectedKey, { period, limit: 2 }).items : [];
  const selectionError = requested && (!selectedKey || (selectedKey.startsWith("e:") && !detail)) ? "This exercise is unavailable. Choose another exercise from your history." : undefined;
  const selectedName = detail?.exercise.name ?? home.recent.find(item => item.key === selectedKey)?.name ?? candidates[0]?.recordedName ?? (selectedKey.startsWith("u:") ? listUnlinkedExercises(user.id, selectedKey, { limit: 1 }).items[0]?.recordedName : undefined);
  const metric = progressMetric(single(params.metric));
  const currentHref = progressUrl("/history", { exercise: selectedKey, period, metric });
  return <ProgressOverview home={home} period={period} currentHref={currentHref} initialMetric={metric} selectedKey={selectedKey} selectedName={selectedName} detail={detail} unlinked={candidates} selectionError={selectionError} />;
}
