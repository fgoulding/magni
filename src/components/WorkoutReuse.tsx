"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkoutDraft, workoutButton, workoutPrimaryButton, workoutInput, workoutRequest } from "./quick-workout-utils";

export function WorkoutReuse({ sessionId, routineId, name, today }: { sessionId?: number; routineId?: number; name: string; today: string }) {
  const router = useRouter();
  const [draft, store] = useWorkoutDraft<{ date: string; name: string; repeatKey?: string; routineKey?: string; repeatDate?: string; routineName?: string }>(`magni.workout.reuse.${sessionId ?? `routine-${routineId}`}`, { date: today, name });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function repeat() {
    setBusy(true); setMessage(""); const requestKey = draft.repeatKey ?? crypto.randomUUID(); store({ ...draft, repeatKey: requestKey, repeatDate: draft.repeatDate ?? draft.date });
    try {
      const result = await workoutRequest<{ id: number }>(sessionId ? `/api/sessions/${sessionId}/repeat` : "/api/sessions", "POST", { requestKey, date: draft.repeatDate ?? draft.date, ...(routineId ? { routineId } : {}) });
      store(null); router.push(`/workouts/${result.id}`); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not repeat workout."); }
    finally { setBusy(false); }
  }
  async function saveRoutine() {
    setBusy(true); setMessage(""); const requestKey = draft.routineKey ?? crypto.randomUUID(); store({ ...draft, routineKey: requestKey, routineName: draft.routineName ?? draft.name });
    try { await workoutRequest("/api/workout-routines", "POST", { sessionId, name: draft.routineName ?? draft.name, requestKey }); store(null); setMessage("Routine saved. Find it in Workout history."); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save routine."); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-3">
    <label className="text-xs text-muted">Workout date<input className={`${workoutInput} mt-1 w-full`} aria-label={routineId ? `Date for ${name}` : "Repeat workout date"} type="date" disabled={busy || !!draft.repeatKey} value={draft.repeatDate ?? draft.date} onChange={(e) => store({ ...draft, date: e.target.value })} /></label>
    <button className={workoutPrimaryButton} disabled={busy} onClick={repeat}>{busy ? "Saving…" : routineId ? `Start ${name}` : "Repeat workout"}</button>
    {sessionId && <><label className="text-xs text-muted">Routine name<input className={`${workoutInput} mt-1 w-full`} aria-label="Routine name" disabled={busy || !!draft.routineKey} value={draft.routineName ?? draft.name} onChange={(e) => store({ ...draft, name: e.target.value })} /></label><button className={workoutButton} disabled={busy || !draft.name.trim()} onClick={saveRoutine}>Save as routine</button></>}
    {message && <p role="status" className="text-sm text-muted">{message}</p>}
  </div>;
}
