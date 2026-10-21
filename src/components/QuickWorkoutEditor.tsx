"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WorkoutSession } from "@/features/workouts/types";
import type { QuickSession } from "./QuickWorkout";
import { useWorkoutDraft, workoutButton, workoutPrimaryButton, workoutInput, workoutRequest, WorkoutRequestError } from "./quick-workout-utils";

type AppendBody = { name: string; prescription: { reps: number; weight: number }[]; appendToSetId: number; requestKey: string };
type AppendAttempt = { setId: number; requestKey: string; body?: AppendBody; needsReview?: boolean };
type EditValues = { name: string; date: string; names: Record<number, string>; order: number[]; removed: number[] };
type EditBody = { name: string; date?: string; expectedRevision?: number; order: number[]; removeSetIds: number[]; exerciseNames: Record<number, string>; requestKey: string };
type EditDraft = EditValues & { revision?: number; requestKey?: string; baseName?: string; baseDate?: string; pending?: { body: EditBody; values: EditValues } };
const editValues = ({ name, date, names, order, removed }: EditValues): EditValues => ({ name, date, names, order, removed });
export function QuickWorkoutEditor({ session, disabled, onChanged, onError, heading, onBusyChange }: { heading?: ReactNode; onBusyChange?: (busy: boolean) => void; session: QuickSession; disabled: boolean; onChanged: (session: WorkoutSession) => void; onError: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  function changeBusy(value: boolean) { setBusy(value); onBusyChange?.(value); }
  const [draft, store] = useWorkoutDraft<EditDraft>(`magni.quick.${session.id}.structure`, { name: session.name ?? "Quick Workout", date: session.date ?? "", names: {}, order: session.sets.map((set) => set.id), removed: [], revision: session.revision });
  const [confirmRemove, setConfirmRemove] = useState<{ ids: number[]; exercise: boolean } | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [conflict, setConflict] = useState<WorkoutSession | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const toggleButton = useRef<HTMLButtonElement>(null);
  const reviewPanel = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (conflict) reviewPanel.current?.focus();
    else if (open) nameInput.current?.focus();
    else if (wasOpen.current) toggleButton.current?.focus();
    wasOpen.current = open;
  }, [open, conflict]);
  const [appendPending, setAppendPending] = useWorkoutDraft<AppendAttempt | null>(`magni.quick.${session.id}.append`, null);
  const [appendReview, setAppendReview] = useState<WorkoutSession | null>(null);
  const changed = draft.name !== (session.name ?? "Quick Workout") || draft.date !== (session.date ?? "") || Object.keys(draft.names).length > 0 || draft.removed.length > 0 || draft.order.join() !== session.sets.map((set) => set.id).join();
  const visible = draft.order.map((id) => session.sets.find((set) => set.id === id)).filter((set): set is QuickSession["sets"][number] => !!set && !draft.removed.includes(set.id));
  const groups: QuickSession["sets"][] = [];
  for (const set of visible) {
    const last = groups.at(-1);
    const exerciseKey = "exercise_key" in set ? set.exercise_key : undefined;
    const lastKey = last && "exercise_key" in last[0] ? last[0].exercise_key : undefined;
    if (last && (exerciseKey || lastKey ? exerciseKey === lastKey : last[0].exercise_name === set.exercise_name)) last.push(set); else groups.push([set]);
  }
  function change(next: EditDraft) { if (busy) return; if (!store({ ...next, baseName: next.baseName ?? session.name ?? "Quick Workout", baseDate: next.baseDate ?? session.date ?? "" })) onError("Device storage is unavailable. Save before leaving this page."); }
  function rebase(result: WorkoutSession, base = { name: draft.baseName, date: draft.baseDate }): EditDraft {
    const ids = new Set(result.sets.map((set) => set.id));
    return { ...editValues(draft), name: draft.name === base.name ? result.name : draft.name, date: draft.date === base.date ? result.date : draft.date,
      revision: result.revision, baseName: result.name, baseDate: result.date,
      order: [...draft.order.filter((id) => ids.has(id)), ...result.sets.map((set) => set.id).filter((id) => !draft.order.includes(id))],
      removed: draft.removed.filter((id) => ids.has(id)), names: Object.fromEntries(Object.entries(draft.names).filter(([id]) => ids.has(Number(id)))) };
  }
  function move(ids: number[], delta: number) {
    const order = visible.map((set) => set.id); const first = order.indexOf(ids[0]); const last = order.indexOf(ids.at(-1)!);
    const neighbor = delta < 0 ? groups.find((group) => group.some((set) => set.id === order[first - 1])) : groups.find((group) => group.some((set) => set.id === order[last + 1]));
    if (!neighbor) return;
    const rest = order.filter((id) => !ids.includes(id)); const target = delta < 0 ? rest.indexOf(neighbor[0].id) : rest.indexOf(neighbor.at(-1)!.id) + 1;
    rest.splice(target, 0, ...ids); change({ ...draft, order: rest });
  }
  function moveSet(id: number, delta: number) {
    const order = visible.map((set) => set.id); const index = order.indexOf(id); const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]]; change({ ...draft, order });
  }
  async function save() {
    if (busy || disabled || needsReview) return;
    changeBusy(true); onError("");
    const pending = draft.pending ?? { body: { name: draft.name, date: draft.date || undefined, expectedRevision: draft.revision, order: visible.map((set) => set.id), removeSetIds: draft.removed, exerciseNames: draft.names, requestKey: draft.requestKey ?? crypto.randomUUID() }, values: editValues(draft) };
    change({ ...draft, pending });
    try {
      const result = await workoutRequest<WorkoutSession>(`/api/sessions/${session.id}`, "PUT", pending.body);
      if (result.id !== session.id || !Array.isArray(result.sets) || !Number.isInteger(result.revision)) throw new Error("Could not confirm the saved workout. Resolve the previous save before saving another change.");
      onChanged(result);
      if (JSON.stringify(editValues(draft)) === JSON.stringify(pending.values)) { store(null); setOpen(false); }
      else { store(rebase(result, pending.values)); onError("Previous save confirmed. Your newer workout edits are still unsaved."); }
    } catch (error) {
      if (error instanceof WorkoutRequestError && error.confirmedRejection) store({ ...draft, pending: undefined, requestKey: undefined });
      if (error instanceof WorkoutRequestError && error.status === 409 && error.confirmedClientError) setNeedsReview(true);
      onError(error instanceof Error ? error.message : "Could not save workout edits.");
    }
    finally { changeBusy(false); }
  }
  async function reviewSaved() {
    changeBusy(true);
    try {
      const result = await workoutRequest<WorkoutSession>(`/api/sessions/${session.id}`, "GET");
      if (result.id !== session.id || !Array.isArray(result.sets) || !Number.isInteger(result.revision)) throw new Error("Could not confirm the current workout. Your draft is still available.");
      setConflict(result);
    }
    catch (error) { onError(error instanceof Error ? error.message : "Could not load saved workout."); }
    finally { changeBusy(false); }
  }
  async function reviewAppend() {
    if (busy) return;
    changeBusy(true); onError(""); setAppendReview(null);
    try {
      const result = await workoutRequest<WorkoutSession>(`/api/sessions/${session.id}`, "GET");
      if (result.id !== session.id || !Array.isArray(result.sets) || !Number.isInteger(result.revision)) throw new Error("Could not confirm the saved sets. Retry reviewing them.");
      setAppendReview(result);
    } catch (error) { onError(error instanceof Error ? error.message : "Could not load saved sets."); }
    finally { changeBusy(false); }
  }
  async function append(setId: number) {
    if (busy || disabled) return;
    if (appendPending && (!appendPending.body || appendPending.needsReview)) { await reviewAppend(); return; }
    let pending = appendPending;
    if (!pending) {
      const set = session.sets.find(set => set.id === setId);
      if (!set) return;
      const requestKey = crypto.randomUUID();
      pending = { setId, requestKey, body: {
        name: set.exercise_name, prescription: [{ reps: Math.max(1, set.actual_reps ?? set.reps), weight: set.actual_weight ?? set.calculated_weight ?? 0 }], appendToSetId: setId, requestKey,
      } };
    }
    // Persist the complete immutable command before sending it. Source actuals
    // and the last row in this group may change before a retry or remount.
    if (!setAppendPending(pending)) { onError("Device storage is unavailable. Enable it before adding a set so a retry stays safe."); return; }
    changeBusy(true); onError("");
    try {
      await workoutRequest(`/api/sessions/${session.id}/sets`, "POST", pending.body);
      const saved = await workoutRequest<WorkoutSession>(`/api/sessions/${session.id}`, "GET");
      if (saved.id !== session.id || !Array.isArray(saved.sets) || !Number.isInteger(saved.revision)) throw new Error("Could not confirm the saved sets. Retry adding to recover them.");
      onChanged(saved); store(null); setAppendPending(null);
    } catch (error) {
      // A structured rejection from append or its subsequent read needs a
      // canonical review. Keep the intent until the user accepts the saved sets.
      if (error instanceof WorkoutRequestError && error.confirmedClientError && [400, 404, 409].includes(error.status)) setAppendPending({ ...pending, needsReview: true });
      onError(error instanceof Error ? error.message : "Could not add set.");
    }
    finally { changeBusy(false); }
  }
  return <div className="border-b border-line px-4 py-2">
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">{heading}<button ref={toggleButton} type="button" aria-label={open ? "Hide workout editor" : "Edit workout"} aria-expanded={open} className={`${workoutButton} shrink-0 border-transparent text-muted`} disabled={disabled || busy} onClick={() => setOpen(!open)}>{open ? "Close editor" : "Edit"}</button></div>
    {open && <div className="mt-3 flex flex-col gap-3">
      <p className="text-sm text-muted">Changes stay on this device until you save. Save workout edits before adding more sets.</p>
      <label className="text-xs text-muted">Workout name<input ref={nameInput} aria-label="Workout name" disabled={busy} className={`${workoutInput} mt-1 w-full`} value={draft.name} onChange={(e) => change({ ...draft, name: e.target.value })} /></label>
      <label className="text-xs text-muted">Workout date<input type="date" aria-label="Workout date" disabled={busy} className={`${workoutInput} mt-1 w-full`} value={draft.date} onChange={(e) => change({ ...draft, date: e.target.value })} /></label>
      {appendPending && (!appendPending.body || appendPending.needsReview) && <div className="rounded-xl border border-warn-line bg-warn-soft p-3 text-sm text-warn-ink">
        <p>An earlier add-set request needs review. Check the saved sets before adding another.</p>
        <button type="button" className={`${workoutButton} mt-2`} disabled={busy} onClick={() => void reviewAppend()}>Review saved sets</button>
        {appendReview && <div className="mt-2">
          <ul className="space-y-1">{appendReview.sets.map(set => <li key={set.id}>{set.exercise_name} · Set {set.set_number}: {set.actual_reps == null ? `Not logged (${set.reps} reps · ${set.calculated_weight ?? 0} ${appendReview.unit ?? "lb"} planned)` : `${set.actual_reps} reps · ${set.actual_weight == null ? "weight not recorded" : `${set.actual_weight} ${appendReview.unit ?? "lb"}`} saved`}</li>)}</ul>
          <p className="mt-2">Keep these saved sets to resolve the earlier request.</p>
          {appendReview.revision < (session.revision ?? 0) && <p className="mt-2">The workout changed after this review. Review saved sets again.</p>}
          <button type="button" className={`${workoutButton} mt-2`} disabled={busy || disabled || appendReview.revision < (session.revision ?? 0)} onClick={() => {
            onChanged(appendReview); setAppendPending(null); setAppendReview(null); onError("");
          }}>Keep saved sets</button>
        </div>}
      </div>}
      {appendPending?.body && !appendPending.needsReview && !session.sets.some(set => set.id === appendPending.setId) && <div className="rounded-xl border border-warn-line bg-warn-soft p-3 text-sm text-warn-ink"><p>Confirm the earlier add-set request before adding another.</p><button type="button" className={`${workoutButton} mt-2`} disabled={busy || disabled || changed} onClick={() => void append(appendPending.setId)}>Retry add set</button></div>}
      {groups.map((group, groupIndex) => <div key={group[0].id} className="rounded-xl border border-line p-3">
        <label className="text-xs text-muted">Exercise {groupIndex + 1}<input aria-label={`Exercise name ${groupIndex + 1}`} disabled={busy} value={draft.names[group[0].id] ?? group[0].exercise_name} className={`${workoutInput} mt-1 w-full`} onChange={(e) => change({ ...draft, names: { ...draft.names, ...Object.fromEntries(group.map((set) => [set.id, e.target.value])) } })} /></label>
        <div className="mt-2 flex flex-wrap gap-2"><button className={workoutButton} disabled={busy || groupIndex === 0} aria-label={`Move exercise ${groupIndex + 1} up`} onClick={() => move(group.map((set) => set.id), -1)}>↑ Exercise</button><button className={workoutButton} disabled={busy || groupIndex === groups.length - 1} aria-label={`Move exercise ${groupIndex + 1} down`} onClick={() => move(group.map((set) => set.id), 1)}>↓ Exercise</button><button className={`${workoutButton} text-danger-ink`} disabled={busy} onClick={() => setConfirmRemove({ ids: group.map((set) => set.id), exercise: true })}>Remove exercise</button></div>
        <ol className="mt-2 divide-y divide-line">{group.map((set, index) => <li key={set.id} className="py-2"><p className="text-xs text-muted">Set {index + 1}: {set.actual_reps ?? set.reps} reps at {set.actual_weight ?? set.calculated_weight ?? 0} {session.unit ?? "lb"}</p><div className="mt-1 flex flex-wrap gap-2"><button className={workoutButton} disabled={busy || index === 0} aria-label={`Move set ${index + 1} up`} onClick={() => moveSet(set.id, -1)}>↑ Set</button><button className={workoutButton} disabled={busy || index === group.length - 1} aria-label={`Move set ${index + 1} down`} onClick={() => moveSet(set.id, 1)}>↓ Set</button><button className={`${workoutButton} text-danger-ink`} disabled={busy} onClick={() => setConfirmRemove({ ids: [set.id], exercise: false })}>Remove set {index + 1}</button></div></li>)}</ol>
        <button className={`${workoutButton} mt-2 w-full`} disabled={busy || disabled || changed || !!appendPending && (!appendPending.body || appendPending.needsReview) || !!appendPending && !group.some((set) => set.id === appendPending.setId)} onClick={() => append(group.at(-1)!.id)}>{appendPending && group.some((set) => set.id === appendPending.setId) ? "Retry add set" : "Add similar set"}</button>
      </div>)}
      {confirmRemove && <div className="rounded-xl bg-danger-soft p-3"><p className="text-sm">Remove {confirmRemove.exercise ? "this exercise and all its sets" : "this set"}, including recorded values, when you save?</p><button className={`${workoutButton} mt-2 text-danger-ink`} disabled={busy} onClick={() => { change({ ...draft, removed: [...draft.removed, ...confirmRemove.ids] }); setConfirmRemove(null); }}>Confirm remove {confirmRemove.exercise ? "exercise" : "set"}</button></div>}
      {draft.pending && <p role="status" className="text-sm text-muted">Confirm the previous save first. Newer edits stay on this device for a separate save.</p>}
      <button className={workoutPrimaryButton} disabled={busy || disabled || needsReview} onClick={save}>{busy ? "Saving…" : draft.pending ? "Resolve previous save" : "Save workout changes"}</button>
      {needsReview && <button className={workoutButton} disabled={busy} onClick={reviewSaved}>Review saved workout</button>}
      {conflict && <div ref={reviewPanel} tabIndex={-1} aria-label="Saved workout review" className="rounded-xl bg-surface-muted p-3"><p className="text-sm">Saved workout: {conflict.name} · {conflict.date} · {conflict.sets.length} sets. Keeping your edits uses this latest revision; sets removed on another device stay removed.</p><div className="mt-2 flex flex-wrap gap-2"><button className={workoutButton} disabled={busy} onClick={() => { onChanged(conflict); store(null); setConflict(null); setNeedsReview(false); setOpen(false); onError(""); }}>Use saved workout</button><button className={workoutButton} disabled={busy} onClick={() => { store(rebase(conflict)); onChanged(conflict); setConflict(null); setNeedsReview(false); onError("Your workout edits are ready to save against the reviewed version."); }}>Keep my workout edits</button></div></div>}
      <button className={workoutButton} disabled={busy || !!draft.pending && !needsReview} onClick={() => { store(null); setOpen(false); setConflict(null); setNeedsReview(false); }}>Discard unsaved workout edits</button>
    </div>}
  </div>;
}
