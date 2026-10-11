"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import styles from "./HoldToDeleteWorkout.module.css";

const holdDuration = 600;

/** A hold only opens confirmation. Deletion always needs a separate action. */
export function HoldToDeleteWorkout({ disabled, onDelete }: { disabled: boolean; onDelete: () => Promise<void> }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const [holding, setHolding] = useState(false);
  const [open, setOpen] = useState(false);
  const hint = useId();

  function cancelHold() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    pointer.current = null;
    setHolding(false);
  }

  function openConfirmation() {
    cancelHold();
    if (disabled) return;
    // Safari does not focus a button on a pointer tap. Give the native dialog
    // a reliable focus-return target before entering the top layer.
    trigger.current?.focus({ preventScroll: true });
    setOpen(true);
  }

  useEffect(() => {
    const cancel = () => cancelHold();
    window.addEventListener("blur", cancel);
    window.addEventListener("pagehide", cancel);
    window.addEventListener("scroll", cancel, true);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pagehide", cancel);
      window.removeEventListener("scroll", cancel, true);
    };
  }, []);
  useEffect(() => {
    if (disabled) {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      pointer.current = null;
    }
  }, [disabled]);
  if (disabled && holding) setHolding(false);

  function beginHold(event: PointerEvent<HTMLButtonElement>) {
    cancelHold();
    if (disabled || event.button !== 0 || event.isPrimary === false) return;
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setHolding(true);
    timer.current = setTimeout(openConfirmation, holdDuration);
  }

  return <>
    <button ref={trigger} type="button" disabled={disabled} aria-label="Delete workout" aria-haspopup="dialog" aria-describedby={hint}
      title="Hold to delete workout"
      className={`${styles.trigger} ${holding && !disabled ? styles.holding : ""} touch-target shrink-0 rounded-xl border border-line bg-surface text-danger-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50`}
      onPointerDown={beginHold} onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold} onLostPointerCapture={cancelHold}
      onPointerMove={event => {
        const start = pointer.current;
        if (start && (event.pointerId !== start.id || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8)) cancelHold();
      }}
      onContextMenu={event => event.preventDefault()}
      onClick={event => { if (event.detail === 0) openConfirmation(); }}>
      <Trash2 aria-hidden="true" size={20} className="relative" />
    </button>
    <span id={hint} className="sr-only">Hold to delete. Keyboard or assistive activation opens confirmation.</span>
    {open && <DeleteConfirmation disabled={disabled} onDelete={onDelete} onClose={() => {
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    }} />}
  </>;
}

function DeleteConfirmation({ disabled, onDelete, onClose }: { disabled: boolean; onDelete: () => Promise<void>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const question = useId();
  useEffect(() => {
    mounted.current = true;
    const modal = dialog.current;
    modal?.showModal();
    cancel.current?.focus({ preventScroll: true });
    return () => { mounted.current = false; if (modal?.open) modal.close(); };
  }, []);
  function close() {
    if (pending.current) return;
    dialog.current?.close();
    onClose();
  }
  async function confirm() {
    if (disabled || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await onDelete();
      if (mounted.current) { pending.current = false; close(); }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Could not delete workout. Try again.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return <dialog ref={dialog} aria-label="Delete workout?" aria-describedby={question} onCancel={event => { event.preventDefault(); close(); }}
    className="m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-sm overflow-y-auto rounded-2xl border border-line bg-surface p-4 text-foreground backdrop:bg-foreground/40">
    <h2 className="display text-2xl">Delete workout?</h2>
    <p id={question} className="mt-2 text-sm">Are you sure you want to delete this workout?</p>
    {error && <p role="alert" className="mt-3 text-sm text-danger-ink">{error}</p>}
    <div className="mt-4 flex flex-wrap gap-2">
      <button ref={cancel} type="button" disabled={busy} onClick={close} className="touch-target flex-[1_1_6rem] rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold active:bg-surface-muted disabled:opacity-50">Cancel</button>
      <button type="button" disabled={disabled || busy} onClick={() => { void confirm(); }} className="touch-target flex-[1_1_6rem] rounded-xl bg-danger-ink px-4 py-2.5 text-sm font-semibold text-background active:opacity-90 disabled:opacity-50">{busy ? "Deleting…" : "Delete"}</button>
    </div>
  </dialog>;
}
