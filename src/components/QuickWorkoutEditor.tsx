"use client";
import { useState } from "react";
import type { WorkoutSession } from "@/features/workouts/types";
import type { QuickSession } from "./QuickWorkout";
import { useWorkoutDraft, workoutButton, workoutPrimaryButton, workoutInput, workoutRequest } from "./quick-workout-utils";

type EditDraft = { name: string; date: string; names: Record<number, string>; order: number[]; removed: number[]; revision?: number; requestKey?: string };
export function QuickWorkoutEditor({ session, disabled, onChanged, onError }: { session: QuickSession; disabled: boolean; onChanged: (session: WorkoutSession) => void; onError: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, store] = useWorkoutDraft<EditDraft>(`magni.quick.${session.id}.structure`, { name: session.name ?? "Quick Workout", date: session.date ?? "", names: {}, order: session.sets.map((set) => set.id), removed: [], revision: session.revision });
  const [confirmRemove, setConfirmRemove] = useState<{ ids: number[]; exercise: boolean } | null>(null);
  const [appendPending, setAppendPending] = useWorkoutDraft<{ setId: number; requestKey: string } | null>(`magni.quick.${session.id}.append`, null);
  const changed = draft.name !== (session.name ?? "Quick Workout") || draft.date !== (session.date ?? "") || Object.keys(draft.names).length > 0 || draft.removed.length > 0 || draft.order.join() !== session.sets.map((set) => set.id).join();
  const visible = draft.order.map((id) => session.sets.find((set) => set.id === id)).filter((set): set is QuickSession["sets"][number] => !!set && !draft.removed.includes(set.id));
  const groups: QuickSession["sets"][] = [];
  for (const set of visible) {
    const last = groups.at(-1);
    const exerciseKey = "exercise_key" in set ? set.exercise_key : undefined;
    const lastKey = last && "exercise_key" in last[0] ? last[0].exercise_key : undefined;
    if (last && (exerciseKey || lastKey ? exerciseKey === lastKey : last[0].exercise_name === set.exercise_name)) last.push(set); else groups.push([set]);
  }
  function change(next: EditDraft) { if (busy) return; if (!store(next)) onError("Device storage is unavailable. Save before leaving this page."); }
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
    setBusy(true); onError(""); const requestKey = draft.requestKey ?? crypto.randomUUID(); change({ ...draft, requestKey });
    try {
      const result = await workoutRequest<WorkoutSession>(`/api/sessions/${session.id}`, "PUT", { name: draft.name, date: draft.date || undefined, expectedRevision: draft.revision, order: visible.map((set) => set.id), removeSetIds: draft.removed, exerciseNames: draft.names, requestKey });
      onChanged(result); store(null); setOpen(false);
    } catch (error) { onError(error instanceof Error ? error.message : "Could not save workout edits."); }
    finally { setBusy(false); }
  }
  async function append(setId: number) {
    const set = session.sets.find((set) => set.id === setId)!;
    const payload = appendPending ?? { setId, requestKey: crypto.randomUUID() }; setAppendPending(payload); setBusy(true);
    try {
      await workoutRequest(`/api/sessions/${session.id}/sets`, "POST", { name: set.exercise_name, prescription: [{ reps: Math.max(1, set.actual_reps ?? set.reps), weight: set.actual_weight ?? set.calculated_weight ?? 0 }], appendToSetId: payload.setId, requestKey: payload.requestKey });
      onChanged(await workoutRequest<WorkoutSession>(`/api/sessions/${session.id}`, "GET")); store(null); setAppendPending(null);
    } catch (error) { onError(error instanceof Error ? error.message : "Could not add set."); }
    finally { setBusy(false); }
  }
  return <div className="border-b border-line px-4 pb-3">
    <button className={`${workoutButton} w-full`} disabled={disabled || busy} onClick={() => setOpen(!open)}>{open ? "Hide workout editor" : "Edit workout"}</button>
    {open && <div className="mt-3 flex flex-col gap-3">
      <p className="text-sm text-muted">Changes stay on this device until you save. Save workout edits before adding more sets.</p>
      <label className="text-xs text-muted">Workout name<input aria-label="Workout name" disabled={busy} className={`${workoutInput} mt-1 w-full`} value={draft.name} onChange={(e) => change({ ...draft, name: e.target.value })} /></label>
      <label className="text-xs text-muted">Workout date<input type="date" aria-label="Workout date" disabled={busy} className={`${workoutInput} mt-1 w-full`} value={draft.date} onChange={(e) => change({ ...draft, date: e.target.value })} /></label>
      {groups.map((group, groupIndex) => <div key={group[0].id} className="rounded-xl border border-line p-3">
        <label className="text-xs text-muted">Exercise {groupIndex + 1}<input aria-label={`Exercise name ${groupIndex + 1}`} disabled={busy} value={draft.names[group[0].id] ?? group[0].exercise_name} className={`${workoutInput} mt-1 w-full`} onChange={(e) => change({ ...draft, names: { ...draft.names, ...Object.fromEntries(group.map((set) => [set.id, e.target.value])) } })} /></label>
        <div className="mt-2 flex flex-wrap gap-2"><button className={workoutButton} disabled={busy || groupIndex === 0} aria-label={`Move exercise ${groupIndex + 1} up`} onClick={() => move(group.map((set) => set.id), -1)}>↑ Exercise</button><button className={workoutButton} disabled={busy || groupIndex === groups.length - 1} aria-label={`Move exercise ${groupIndex + 1} down`} onClick={() => move(group.map((set) => set.id), 1)}>↓ Exercise</button><button className={`${workoutButton} text-danger-ink`} disabled={busy} onClick={() => setConfirmRemove({ ids: group.map((set) => set.id), exercise: true })}>Remove exercise</button></div>
        <ol className="mt-2 divide-y divide-line">{group.map((set, index) => <li key={set.id} className="py-2"><p className="text-xs text-muted">Set {index + 1}: {set.actual_reps ?? set.reps} reps at {set.actual_weight ?? set.calculated_weight ?? 0} {session.unit ?? "lb"}</p><div className="mt-1 flex flex-wrap gap-2"><button className={workoutButton} disabled={busy || index === 0} aria-label={`Move set ${index + 1} up`} onClick={() => moveSet(set.id, -1)}>↑ Set</button><button className={workoutButton} disabled={busy || index === group.length - 1} aria-label={`Move set ${index + 1} down`} onClick={() => moveSet(set.id, 1)}>↓ Set</button><button className={`${workoutButton} text-danger-ink`} disabled={busy} onClick={() => setConfirmRemove({ ids: [set.id], exercise: false })}>Remove set {index + 1}</button></div></li>)}</ol>
        <button className={`${workoutButton} mt-2 w-full`} disabled={busy || disabled || changed || !!appendPending && !group.some((set) => set.id === appendPending.setId)} onClick={() => append(group.at(-1)!.id)}>{appendPending && group.some((set) => set.id === appendPending.setId) ? "Retry add set" : "Add similar set"}</button>
      </div>)}
      {confirmRemove && <div className="rounded-xl bg-danger-soft p-3"><p className="text-sm">Remove {confirmRemove.exercise ? "this exercise and all its sets" : "this set"}, including recorded values, when you save?</p><button className={`${workoutButton} mt-2 text-danger-ink`} disabled={busy} onClick={() => { change({ ...draft, removed: [...draft.removed, ...confirmRemove.ids] }); setConfirmRemove(null); }}>Confirm remove {confirmRemove.exercise ? "exercise" : "set"}</button></div>}
      <button className={workoutPrimaryButton} disabled={busy || disabled} onClick={save}>{busy ? "Saving…" : "Save workout changes"}</button>
      <button className={workoutButton} disabled={busy} onClick={() => { store(null); setOpen(false); }}>Discard unsaved workout edits</button>
    </div>}
  </div>;
}
