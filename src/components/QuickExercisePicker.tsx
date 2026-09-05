"use client";
import { useState } from "react";
import type { ExerciseSuggestion } from "@/features/workouts/types";
import { type WorkoutSet } from "./workout-card-utils";
import { useWorkoutDraft, workoutButton, workoutPrimaryButton, workoutInput, workoutRequest, WorkoutRequestError } from "./quick-workout-utils";

type Draft = { name: string; sets: string; reps: string; weight: string; requestKey?: string; submitted?: { name: string; prescription: { reps: number; weight: number }[]; requestKey: string } };
export function QuickExercisePicker({ sessionId, unit, onAdded, onError, disabled }: { sessionId: number; unit: "lb" | "kg"; onAdded: (sets: WorkoutSet[], revision?: number) => void; onError: (message: string) => void; disabled: boolean }) {
  const [draft, store] = useWorkoutDraft<Draft>(`magni.quick.${sessionId}.new-exercise`, { name: "", sets: "3", reps: "10", weight: "" });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<ExerciseSuggestion[]>([]);
  const retry = draft.submitted;
  function change(field: keyof Draft, value: string) { if (!store({ ...draft, [field]: value })) onError("Device storage is unavailable. Save before leaving this page."); }
  async function loadRecent() {
    setOpen(true);
    try { setRecent(await workoutRequest<ExerciseSuggestion[]>(`/api/sessions/recent-exercises?unit=${unit}`, "GET")); }
    catch (error) { onError(error instanceof Error ? error.message : "Could not load recent exercises."); }
  }
  async function add(suggestion?: ExerciseSuggestion) {
    const prescription = suggestion?.sets ?? Array.from({ length: Math.min(50, Math.max(0, Number(draft.sets))) }, () => ({ reps: Number(draft.reps), weight: draft.weight === "" ? 0 : Number(draft.weight) }));
    if (!suggestion && (!Number.isInteger(Number(draft.sets)) || Number(draft.sets) < 1 || Number(draft.sets) > 50 || !draft.reps.trim())) { onError("Enter 1 to 50 sets and whole reps."); return; }
    const payload = retry ?? { name: suggestion?.name ?? draft.name, prescription, requestKey: draft.requestKey ?? crypto.randomUUID() };
    store({ ...draft, requestKey: payload.requestKey, submitted: payload }); setBusy(true); onError("");
    try {
      const result = await workoutRequest<{ sets: WorkoutSet[]; sessionRevision: number }>(`/api/sessions/${sessionId}/sets`, "POST", payload);
      onAdded(result.sets, result.sessionRevision); store(null); setOpen(false);
    } catch (error) {
      // A validation rejection cannot have committed this addition. Let the user
      // correct the original fields; uncertain writes keep their exact retry.
      if (error instanceof WorkoutRequestError && error.status === 400) store({ ...draft, requestKey: undefined, submitted: undefined });
      onError(error instanceof Error ? error.message : "Could not add exercise.");
    }
    finally { setBusy(false); }
  }
  return <div className="px-4 py-3">
    {open || draft.name || retry ? <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-muted p-3">
      <label className="text-xs font-semibold text-muted">Exercise name<input aria-label="New exercise name" value={draft.name} onChange={(e) => change("name", e.target.value)} disabled={busy || !!retry} className={`${workoutInput} mt-1 w-full`} /></label>
      <div className="grid grid-cols-3 gap-2">{([['sets', 'Sets'], ['reps', 'New exercise reps'], ['weight', 'Weight']] as const).map(([field, label]) => <label key={field} className="text-xs text-muted">{field === "weight" ? `Weight (${unit})` : field === "reps" ? "Reps" : "Sets"}<input aria-label={label} type="number" min={field === "weight" ? 0 : 1} step={field === "weight" ? "any" : 1} value={draft[field]} disabled={busy || !!retry} onChange={(e) => change(field, e.target.value)} className={`${workoutInput} mt-1 w-full px-2`} /></label>)}</div>
      <button className={workoutPrimaryButton} disabled={disabled || busy || (!draft.name.trim() && !retry)} onClick={() => add()}>{busy ? "Adding…" : retry ? "Retry adding exercise" : "Add to workout"}</button>
      {!retry && <button className={workoutButton} disabled={busy} onClick={() => { store(null); setOpen(false); }}>Cancel</button>}
      {recent.length > 0 && !retry && <div className="border-t border-line pt-3"><p className="eyebrow text-xs text-muted">Reuse recent values</p><div className="mt-2 flex flex-col gap-2">{recent.filter((item) => item.name.toLowerCase().includes(draft.name.trim().toLowerCase())).slice(0, 8).map((item) => <button key={item.name} disabled={busy || disabled} className={`${workoutButton} py-2 text-left`} onClick={() => add(item)}><span className="block">{item.name}</span><span className="text-xs font-normal text-muted">{item.sets.length} sets · {item.sets[0]?.reps} reps at {item.sets[0]?.weight} {unit}</span></button>)}</div></div>}
    </div> : <button type="button" onClick={loadRecent} disabled={disabled} className={`${workoutButton} w-full border-dashed text-muted`}>Add exercise</button>}
  </div>;
}
