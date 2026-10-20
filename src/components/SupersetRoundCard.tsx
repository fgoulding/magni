"use client";

import { ChevronDown } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** View state only: closing a round never unmounts its inputs or changes logs. */
export function SupersetRoundCard({ number, superset, saved, total, saveVersion, names, status, children }: {
  number: number; superset: string; saved: number; total: number; saveVersion: number; names: string[]; status?: string; children: ReactNode;
}) {
  const [view, setView] = useState({ expanded: true, saveVersion });
  // Consume each acknowledged local save once. Later discards, conflict recovery
  // and manual reopening cannot replay it; loaded saved rounds start open.
  if (view.saveVersion !== saveVersion) {
    setView({ saveVersion, expanded: total > 0 && saved === total && !status ? false : view.expanded });
  }
  const { expanded } = view;
  const header = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const focusDisplaced = useRef(false);
  useLayoutEffect(() => {
    if (expanded) return;
    const active = document.activeElement;
    if (content.current?.contains(active) || focusDisplaced.current && active === document.body) header.current?.focus({ preventScroll: true });
    focusDisplaced.current = false;
  }, [expanded]);
  const contentId = useId();
  const label = `Round ${number} of superset ${superset}`;
  return <div role="group" aria-label={label} data-superset-round={number} className="min-w-0 border-t border-line first:border-t-0">
    <h4>
      <button ref={header} type="button" aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`} aria-expanded={expanded} aria-controls={contentId} aria-describedby={`${contentId}-summary`}
        onClick={() => setView(value => ({ ...value, expanded: !value.expanded }))} className="touch-target my-1 flex w-full items-center gap-3 rounded-xl py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand active:bg-surface-muted">
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
    <div ref={content} id={contentId} hidden={!expanded}
      onFocusCapture={() => { focusDisplaced.current = true; }}
      onBlurCapture={event => {
        // Browsers can drop focus to body when Save becomes disabled or its
        // round hides. Remember that loss, but respect deliberate focus moves.
        const lostToBody = !event.relatedTarget || event.relatedTarget === document.body;
        focusDisplaced.current = lostToBody && (event.target.matches(":disabled") || event.currentTarget.hidden);
      }}>{children}</div>
  </div>;
}
