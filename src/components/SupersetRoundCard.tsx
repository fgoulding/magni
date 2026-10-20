"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

/** View state only: closing a round never unmounts its inputs or changes logs. */
export function SupersetRoundCard({ number, superset, saved, total, names, status, children }: {
  number: number; superset: string; saved: number; total: number; names: string[]; status?: string; children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  const label = `Round ${number} of superset ${superset}`;
  return <div role="group" aria-label={label} data-superset-round={number} className="min-w-0 border-t border-line first:border-t-0">
    <h4>
      <button type="button" aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`} aria-expanded={expanded} aria-controls={contentId} aria-describedby={`${contentId}-summary`}
        onClick={() => setExpanded(value => !value)} className="touch-target my-1 flex w-full items-center gap-3 rounded-xl py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand active:bg-surface-muted">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm font-semibold">Round {number}</span>
            <span id={`${contentId}-summary`} aria-live="polite" aria-atomic="true" className="text-xs font-normal text-muted"><span className="sr-only">{label}: </span>{saved}/{total} saved{!expanded && status ? ` · ${status}` : ""}</span>
          </span>
          {!expanded && <span className="mt-1 block break-words text-xs font-normal text-muted">{names.join(" + ")}</span>}
        </span>
        <ChevronDown aria-hidden="true" size={18} className={`shrink-0 text-muted ${expanded ? "rotate-180" : ""}`} />
      </button>
    </h4>
    <div id={contentId} hidden={!expanded}>{children}</div>
  </div>;
}
