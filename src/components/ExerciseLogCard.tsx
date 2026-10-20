"use client";

import { ChevronDown, Check, Undo2 } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "./ExerciseLogCard.module.css";

/** Shared disclosure keeps its children mounted so closing a lift never resets input. */
export function ExerciseLogCard({ name, expandedName, saved, total, saveVersion, status, disabled, children }: {
  name: string; expandedName?: string; saved: number; total: number; saveVersion?: number; status?: string; disabled?: boolean; children: ReactNode;
}) {
  const [view, setView] = useState({ expanded: true, saveVersion });
  // Only supersets receive a save version. Consume it once, so reopening or
  // read-only recovery cannot replay a completed save's automatic collapse.
  if (view.saveVersion !== saveVersion) {
    setView({ saveVersion, expanded: saveVersion !== undefined && total > 0 && saved === total && !status ? false : view.expanded });
  }
  const { expanded } = view;
  const header = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const focusDisplaced = useRef(false);
  useLayoutEffect(() => {
    if (expanded) return;
    const active = document.activeElement;
    // Child round effects run first. The parent must leave focus on its visible
    // header when both levels close, including a disabled Save dropping to body.
    if (content.current?.contains(active) || focusDisplaced.current && active === document.body) header.current?.focus({ preventScroll: true });
    focusDisplaced.current = false;
  }, [expanded]);
  const contentId = useId();
  return <section data-exercise-log-card className="min-w-0 border-b border-line last:border-b-0">
    <h3 aria-label={name}>
      <button ref={header} type="button" aria-label={`${expanded ? "Collapse" : "Expand"} ${name}${expandedName ? ` · ${expandedName}` : ""}`} aria-expanded={expanded} aria-controls={contentId} aria-describedby={`${contentId}-summary`}
        disabled={disabled} onClick={() => setView(value => ({ ...value, expanded: !value.expanded }))} className="touch-target flex w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand active:bg-surface-muted">
        <span className={`min-w-0 flex-1 ${expanded && expandedName ? "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1" : ""}`}>
          <span className="display block break-words text-xl leading-tight">{expanded ? expandedName ?? name : name}</span>
          <span id={`${contentId}-summary`} aria-live="polite" className={`${expanded && expandedName ? "" : "mt-1 "}block text-xs font-semibold text-muted`}>{saved} of {total} sets saved{!expanded && status ? ` · ${status}` : ""}</span>
        </span>
        <ChevronDown aria-hidden="true" size={20} className={`shrink-0 text-muted ${expanded ? "rotate-180" : ""}`} />
      </button>
    </h3>
    <div ref={content} id={contentId} hidden={!expanded} className="px-4 pb-3"
      onFocusCapture={() => { focusDisplaced.current = true; }}
      onBlurCapture={event => {
        const lostToBody = !event.relatedTarget || event.relatedTarget === document.body;
        focusDisplaced.current = lostToBody && (event.target.matches(":disabled") || event.currentTarget.hidden);
      }}>{children}</div>
  </section>;
}

export function SetLogRow({ number, count = 1, name, reps, weight, unit, addedWeight = false, repsLabel, weightLabel, target, prescription,
  saved, logged, pending, saving, failed, undoPending, missingWeight, disabled, saveDisabled, saveLabel, onChange, onSave, onUndo, children,
}: {
  number: number | string; count?: number; name?: string; reps: string; weight: string; unit: string; addedWeight?: boolean;
  repsLabel: string; weightLabel: string; target?: string; prescription?: ReactNode;
  saved: boolean; logged: boolean; pending: boolean; saving: boolean; failed: boolean; undoPending?: boolean; missingWeight?: boolean;
  disabled?: boolean; saveDisabled?: boolean; saveLabel: string;
  onChange: (field: "reps" | "weight", value: string) => void; onSave: () => void; onUndo: () => void; children?: ReactNode;
}) {
  const status = saving ? (undoPending ? "Undoing…" : "Saving…") : undoPending ? "Undo unconfirmed" : failed ? "Save failed" : pending ? "Unsaved" : saved ? (missingWeight ? "Saved · load not recorded" : "Saved") : "Not logged";
  const id = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const primaryIsUndo = saved || Boolean(undoPending);
  const secondaryUndo = logged && !primaryIsUndo;
  const undoLabel = `${undoPending ? "Retry undo" : "Undo"} ${count > 1 ? `${count}-set log` : `set ${number}`}`;
  const actionDisabled = disabled || saving || saveDisabled;
  return <div data-set-log-row className="min-w-0 border-t border-line py-3 first:border-t-0 first:pt-0">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm font-semibold">
        <span className="min-w-0 break-words">{typeof number === "string" && name ? `${number} · ${name}` : <>{name ? `${name} · ` : ""}{count > 1 ? `${count} sets · batch` : `Set ${number}`}</>}</span>
        {target ? <span className="min-w-0 text-xs font-normal text-muted">{target}</span> : null}
      </p>
      <span aria-live="polite" className={`${status === "Not logged" ? "sr-only " : ""}text-xs font-semibold ${failed || undoPending ? "text-danger-ink" : saved ? "text-success-ink" : "text-muted"}`}>{status}</span>
    </div>
    {prescription}
    <div className={styles.entryContainer}>
      <div className={`${styles.entries} mt-2`} data-action-count={secondaryUndo ? 2 : 1}>
        <label htmlFor={`${id}-reps`} className="min-w-0 text-xs font-semibold text-muted">Reps{count > 1 ? " per set" : ""}
          <input id={`${id}-reps`} aria-label={repsLabel} type="number" min={0} step={1} inputMode="numeric" value={reps} disabled={disabled}
            onChange={event => onChange("reps", event.target.value)} className="touch-target mt-1 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2 text-center font-display text-xl text-foreground outline-none focus:border-brand" />
        </label>
        <label htmlFor={`${id}-weight`} className="min-w-0 text-xs font-semibold text-muted">{addedWeight ? "Added weight" : "Weight"} ({unit})
          <input id={`${id}-weight`} aria-label={weightLabel} type="number" min={0} step="any" inputMode="decimal" value={weight} disabled={disabled}
            onChange={event => onChange("weight", event.target.value)} className="touch-target mt-1 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2 text-center font-display text-xl text-foreground outline-none focus:border-brand" />
        </label>
        <div className={styles.actions}>
          <button ref={primaryRef} type="button" aria-label={primaryIsUndo ? undoLabel : count > 1 ? `Save ${count}-set log` : saveLabel}
            aria-pressed={saved} disabled={actionDisabled} onClick={primaryIsUndo ? onUndo : onSave}
            className={`${styles.iconAction} touch-target inline-flex items-center justify-center rounded-xl border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-70 ${saved ? "border-success-line bg-success-soft text-success-ink active:opacity-90" : undoPending ? "border-danger-line bg-danger-soft text-danger-ink active:opacity-90" : "border-line bg-surface text-muted active:bg-surface-muted"}`}>
            <Check aria-hidden="true" size={18} />
          </button>
          <button type="button" hidden={!secondaryUndo} aria-label={undoLabel} disabled={actionDisabled || !secondaryUndo} onClick={() => {
            // The primary slot becomes Retry undo during the request. Keep focus
            // there instead of on the secondary control that is about to hide.
            primaryRef.current?.focus();
            onUndo();
          }} className={`${styles.iconAction} touch-target inline-flex items-center justify-center rounded-xl border border-line bg-surface text-muted outline-none focus-visible:ring-2 focus-visible:ring-brand active:bg-surface-muted disabled:opacity-50`}><Undo2 aria-hidden="true" size={18} /></button>
        </div>
      </div>
    </div>
    {children}
  </div>;
}
