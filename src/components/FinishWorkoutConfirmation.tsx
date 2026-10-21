"use client";

import { useEffect, useId, useRef, useState } from "react";

/** Finishing uses saved actuals; this dialog never saves or clears set inputs. */
export function FinishWorkoutConfirmation({ disabled, error, onConfirm, onClose, onHoldProgression }: {
  disabled: boolean;
  error: string;
  onConfirm: () => Promise<boolean>;
  onClose: () => void;
  onHoldProgression?: () => Promise<boolean>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const pending = useRef(false);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const description = useId();
  useEffect(() => {
    mounted.current = true;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = dialog.current;
    modal?.showModal();
    cancel.current?.focus({ preventScroll: true });
    return () => { mounted.current = false; if (modal?.open) modal.close(); };
  }, []);
  function close() {
    if (pending.current) return;
    dialog.current?.close();
    onClose();
    trigger.current?.focus({ preventScroll: true });
  }
  async function confirm(action: () => Promise<boolean>) {
    if (disabled || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const completed = await action();
      if (completed && mounted.current) { pending.current = false; close(); }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return <dialog ref={dialog} aria-label="Finish with saved sets?" aria-describedby={description}
    onCancel={event => { event.preventDefault(); close(); }}
    className="m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-sm overflow-y-auto rounded-2xl border border-line bg-surface p-4 text-foreground backdrop:bg-foreground/40">
    <h2 className="display text-2xl">Finish with saved sets?</h2>
    <p id={description} className="mt-2 text-sm text-muted">Your saved sets will be kept. Unsaved edits will be discarded, and sets left unlogged will stay unperformed.</p>
    {error && <p role="alert" className="mt-3 text-sm text-danger-ink">{error}</p>}
    <div className="mt-4 flex flex-wrap gap-2">
      <button ref={cancel} type="button" disabled={busy} onClick={close} className="touch-target flex-[1_1_8rem] rounded-xl border border-line px-4 py-2.5 text-sm font-semibold active:bg-surface-muted disabled:opacity-50">Keep training</button>
      <button type="button" disabled={disabled || busy} onClick={() => { void confirm(onConfirm); }} className="touch-target flex-[1_1_8rem] rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background active:opacity-90 disabled:opacity-50">{busy ? "Finishing…" : "Finish with saved sets"}</button>
      {onHoldProgression && <button type="button" disabled={disabled || busy} onClick={() => { void confirm(onHoldProgression); }} className="touch-target w-full rounded-xl border border-warn-line bg-warn-soft px-4 py-2.5 text-sm font-semibold text-warn-ink disabled:opacity-50">Finish without changing affected training maxes</button>}
    </div>
  </dialog>;
}
