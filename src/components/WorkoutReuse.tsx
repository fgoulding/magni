"use client";
import { rememberCalendarScroll, withCalendarReturn } from "@/features/calendar/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useWorkoutDraft, workoutButton, workoutPrimaryButton, workoutInput, workoutRequest, WorkoutRequestError } from "./quick-workout-utils";

const subscribe = () => () => {};

export function WorkoutReuse({ sessionId, routineId, name, today, returnTo }: { sessionId?: number; routineId?: number; name: string; today: string; returnTo?: string }) {
  const router = useRouter();
  const [draft, store] = useWorkoutDraft<{ date: string; name: string; repeatKey?: string; routineKey?: string; repeatDate?: string; routineName?: string }>(`magni.workout.reuse.${sessionId ?? `routine-${routineId}`}`, { date: today, name });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dateInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const focusAfter = useRef<"date" | "name" | null>(null);
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const locked = !hydrated || busy || !!draft.repeatKey || !!draft.routineKey;
  useEffect(() => {
    if (!busy && hydrated && focusAfter.current) {
      (focusAfter.current === "date" ? dateInput : nameInput).current?.focus();
      focusAfter.current = null;
    }
  }, [busy, hydrated]);
  async function repeat() {
    if (!hydrated || busy || draft.routineKey) return;
    setBusy(true); setMessage(""); const requestKey = draft.repeatKey ?? crypto.randomUUID(); store({ ...draft, repeatKey: requestKey, repeatDate: draft.repeatDate ?? draft.date });
    try {
      const result = await workoutRequest<{ id: number }>(sessionId ? `/api/sessions/${sessionId}/repeat` : "/api/sessions", "POST", { requestKey, date: draft.repeatDate ?? draft.date, ...(routineId ? { routineId } : {}) });
      if (!Number.isSafeInteger(result.id) || result.id < 1) throw new Error("Could not confirm the new workout. Retry starting it with the same details.");
      store(null); rememberCalendarScroll(returnTo); router.push(withCalendarReturn(`/workouts/${result.id}`,returnTo??null)); router.refresh();
    } catch (error) {
      if (error instanceof WorkoutRequestError && error.confirmedRejection) { store({ ...draft, repeatKey: undefined, repeatDate: undefined }); focusAfter.current = "date"; }
      setMessage(error instanceof Error ? error.message : "Could not repeat workout.");
    }
    finally { setBusy(false); }
  }
  async function saveRoutine() {
    if (!hydrated || busy || draft.repeatKey) return;
    setBusy(true); setMessage(""); const requestKey = draft.routineKey ?? crypto.randomUUID(); store({ ...draft, routineKey: requestKey, routineName: draft.routineName ?? draft.name });
    try {
      const result = await workoutRequest<{ id: number }>("/api/workout-routines", "POST", { sessionId, name: draft.routineName ?? draft.name, requestKey });
      if (!Number.isSafeInteger(result.id) || result.id < 1) throw new Error("Could not confirm the saved routine. Retry with the same details.");
      store(null); setMessage("Routine saved. Find it in Workout history."); router.refresh();
    }
    catch (error) {
      if (error instanceof WorkoutRequestError && error.confirmedRejection) { store({ ...draft, routineKey: undefined, routineName: undefined }); focusAfter.current = "name"; }
      setMessage(error instanceof Error ? error.message : "Could not save routine.");
    }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-3">
    <label className="text-xs text-muted">Workout date<input ref={dateInput} className={`${workoutInput} mt-1 w-full`} aria-label={routineId ? `Date for ${name}` : "Repeat workout date"} type="date" disabled={locked} value={draft.repeatDate ?? draft.date} onChange={(e) => { if (!locked) store({ ...draft, date: e.target.value }); }} /></label>
    <button className={workoutPrimaryButton} disabled={!hydrated || busy || !!draft.routineKey} onClick={repeat}>{!hydrated ? "Loading…" : busy ? "Saving…" : draft.repeatKey ? "Retry starting workout" : routineId ? `Start ${name}` : "Repeat workout"}</button>
    {sessionId && <><label className="text-xs text-muted">Routine name<input ref={nameInput} className={`${workoutInput} mt-1 w-full`} aria-label="Routine name" disabled={locked} value={draft.routineName ?? draft.name} onChange={(e) => { if (!locked) store({ ...draft, name: e.target.value }); }} /></label><button className={workoutButton} disabled={!hydrated || busy || !!draft.repeatKey || !draft.name.trim()} onClick={saveRoutine}>{draft.routineKey ? "Retry saving routine" : "Save as routine"}</button></>}
    {hydrated && (draft.repeatKey || draft.routineKey) && !busy && <p role="status" className="text-sm text-muted">This request is not yet confirmed. Retry it with the same details before making another change.</p>}
    {message && <p role="status" className="text-sm text-muted">{message}</p>}
  </div>;
}
