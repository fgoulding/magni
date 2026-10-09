import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ExerciseFinderItem, ExerciseSummary, ProgressPerformance } from "@/features/progress/types";
import { ProgressDate } from "./ProgressChrome";
import { progressUrl } from "./navigation";

export function exerciseHref(key: string, returnTo: string): string { return progressUrl(`/history/exercises/${encodeURIComponent(key)}`, { returnTo }); }
export function actualResult(latest: ProgressPerformance | null): string {
  if (!latest) return "No actual result recorded";
  return `${latest.reps} reps · ${latest.weight === null ? "load not recorded" : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(latest.weight)} ${latest.unit}`}`;
}
export function asFinderItem(exercise: ExerciseSummary): ExerciseFinderItem {
  return { key: `e:${exercise.id}`, kind: "exercise", name: exercise.name, exercise, historyCount: exercise.sessionCount, lastDate: exercise.lastDate, latest: exercise.latest, context: "" };
}
export function ExerciseRows({ items, currentHref, compact = false }: { items: ExerciseFinderItem[]; currentHref: string; compact?: boolean }) {
  return <ul className="divide-y divide-line" aria-label="Exercises">{items.map(item => <li key={item.key} data-testid="progress-exercise-row"><Link href={exerciseHref(item.key, currentHref)} className="touch-target flex min-w-0 items-center gap-3 py-3">
    <div className="min-w-0 flex-1"><h3 className="display break-words text-xl leading-6">{item.name}</h3>
      <p className="mt-1 text-sm leading-5 text-muted">{actualResult(item.latest)}{item.lastDate && <> · <ProgressDate date={item.lastDate} short={compact} /></>}</p>
      {!compact && item.kind === "unlinked" && <p className="mt-1 break-words text-sm text-muted">Choose a variation · {item.historyCount} workouts{item.context && ` · ${item.context}`}</p>}
    </div><ChevronRight aria-hidden="true" size={18} className="shrink-0 text-faint" />
  </Link></li>)}</ul>;
}
