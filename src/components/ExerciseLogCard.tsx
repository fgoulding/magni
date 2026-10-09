"use client";

import { ChevronDown, Check } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import styles from "./ExerciseLogCard.module.css";

/** Shared disclosure keeps its children mounted so closing a lift never resets input. */
export function ExerciseLogCard({ name, saved, total, status, disabled, children }: {
  name: string; saved: number; total: number; status?: string; disabled?: boolean; children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  return <section data-exercise-log-card className="min-w-0 border-b border-line last:border-b-0">
    <h3 aria-label={name}>
      <button type="button" aria-label={`${expanded ? "Collapse" : "Expand"} ${name}`} aria-expanded={expanded} aria-controls={contentId} aria-describedby={`${contentId}-summary`}
        disabled={disabled} onClick={() => setExpanded(!expanded)} className="touch-target flex w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand active:bg-surface-muted">
        <span className="min-w-0 flex-1">
          <span className="display block break-words text-xl leading-tight">{name}</span>
          <span id={`${contentId}-summary`} aria-live="polite" className="mt-1 block text-xs font-semibold text-muted">{saved} of {total} sets saved{!expanded && status ? ` · ${status}` : ""}</span>
        </span>
        <ChevronDown aria-hidden="true" size={20} className={`shrink-0 text-muted ${expanded ? "rotate-180" : ""}`} />
      </button>
    </h3>
    <div id={contentId} hidden={!expanded} className="px-4 pb-3">{children}</div>
  </section>;
}

export function SetLogRow({ number, count = 1, name, reps, weight, unit, addedWeight = false, repsLabel, weightLabel, prescription,
  saved, logged, pending, saving, failed, undoPending, missingWeight, disabled, saveDisabled, saveLabel, onChange, onSave, onUndo, children,
}: {
  number: number; count?: number; name?: string; reps: string; weight: string; unit: string; addedWeight?: boolean;
  repsLabel: string; weightLabel: string; prescription?: ReactNode;
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
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <p className="text-sm font-semibold">{name ? `${name} · ` : ""}{count > 1 ? `${count} sets · batch` : `Set ${number}`}</p>
      <span aria-live="polite" className={`text-xs font-semibold ${failed || undoPending ? "text-danger-ink" : saved ? "text-success-ink" : "text-muted"}`}>{status}</span>
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
            aria-pressed={primaryIsUndo ? undefined : saved} disabled={actionDisabled} onClick={primaryIsUndo ? onUndo : onSave}
            className={`touch-target inline-flex items-center justify-center rounded-xl font-semibold transition-colors disabled:opacity-70 ${primaryIsUndo ? `${styles.undo} border border-line bg-surface text-sm text-muted active:bg-surface-muted` : `${styles.save} bg-foreground text-base text-background active:opacity-90`}`}>
            <Check aria-hidden="true" size={18} className={primaryIsUndo ? styles.concealed : undefined} />
            <span className={primaryIsUndo ? undefined : styles.concealed}>{undoPending ? "Retry undo" : "Undo"}</span>
          </button>
          <button type="button" hidden={!secondaryUndo} aria-label={undoLabel} disabled={actionDisabled || !secondaryUndo} onClick={() => {
            // The primary slot becomes Retry undo during the request. Keep focus
            // there instead of on the secondary control that is about to hide.
            primaryRef.current?.focus();
            onUndo();
          }} className={`${styles.undo} touch-target inline-flex items-center justify-center rounded-xl border border-line bg-surface text-sm font-semibold text-muted active:bg-surface-muted disabled:opacity-50`}>Undo</button>
        </div>
      </div>
    </div>
    {children}
  </div>;
}
