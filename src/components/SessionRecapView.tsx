import { Check, X } from "lucide-react";
import type { SessionRecap } from "@/features/programs/training-stats";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

/** What a completed/skipped workout actually did — logged sets per exercise + skips. */
export function SessionRecapView({ recap }: { recap: SessionRecap }) {
  if (recap.exercises.length === 0) {
    return (
      <div className="rounded-xl bg-surface-muted px-4 py-6 text-center text-sm text-muted">
        {recap.status === "skipped" ? "This workout was skipped — nothing logged." : "No sets were logged."}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-surface-muted p-3.5">
      <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted">
        <span>
          {recap.loggedCount} done
          {recap.skippedCount > 0 ? ` · ${recap.skippedCount} skipped` : ""}
        </span>
        <span className="font-display tracking-tight">{formatNumber(recap.volume)} lb volume</span>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {recap.exercises.map((exercise) => (
          <li key={exercise.name} className="flex items-center gap-3 py-2.5">
            {exercise.skipped ? (
              <X aria-hidden="true" size={15} className="shrink-0 text-faint" />
            ) : (
              <Check aria-hidden="true" size={15} strokeWidth={3} className="shrink-0 text-success" />
            )}
            <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${exercise.skipped ? "text-faint" : ""}`}>
              {exercise.name}
            </span>
            {exercise.skipped ? (
              <span className="shrink-0 text-xs font-medium text-faint">Skipped</span>
            ) : (
              <span className="shrink-0 font-display text-sm tracking-tight text-muted">
                {exercise.repScheme} {exercise.bodyweight ? "BW" : `@ ${formatNumber(exercise.topWeight)} lb`}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
