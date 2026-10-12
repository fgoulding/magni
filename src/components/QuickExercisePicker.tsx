"use client";
import { useEffect, useState } from "react";
import type { ExerciseSuggestion } from "@/features/workouts/types";
import { type WorkoutSet } from "./workout-card-utils";
import { useWorkoutDraft, workoutButton, workoutInput, workoutRequest, WorkoutRequestError } from "./quick-workout-utils";

type Draft = { name: string; sets: string; reps: string; weight: string; requestKey?: string; submitted?: { name: string; catalogExerciseId?: string; prescription: { reps: number; weight: number }[]; requestKey: string } };
type SearchResult = { key: string; items: ExerciseSuggestion[]; error?: string };
export function QuickExercisePicker({ sessionId, unit, onAdded, onError, disabled }: { sessionId: number; unit: "lb" | "kg"; onAdded: (sets: WorkoutSet[], revision?: number) => void; onError: (message: string) => void; disabled: boolean }) {
  const [draft, store] = useWorkoutDraft<Draft>(`magni.quick.${sessionId}.new-exercise`, { name: "", sets: "3", reps: "10", weight: "" });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const retry = draft.submitted;
  const isOpen = Boolean(open || draft.name || retry);
  const canSearch = isOpen && !retry;
  const query = draft.name.trim().slice(0, 140);
  const searchKey = JSON.stringify([unit, query, searchAttempt]);
  const currentResult = searchResult?.key === searchKey ? searchResult : null;

  useEffect(() => {
    if (!canSearch) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ unit, q: query });
        const items = await workoutRequest<ExerciseSuggestion[]>(`/api/sessions/recent-exercises?${params}`, "GET");
        if (active) setSearchResult({ key: searchKey, items });
      } catch (error) {
        if (active) setSearchResult({ key: searchKey, items: [], error: error instanceof Error ? error.message : "Could not load recent exercises." });
      }
    }, 250);
    // Ignore responses for a previous name, unit, or closed form. Read requests
    // never replace the user's draft or an uncertain write's exact retry payload.
    return () => { active = false; clearTimeout(timer); };
  }, [canSearch, query, searchKey, unit]);

  function change(field: keyof Draft, value: string) { if (!store({ ...draft, [field]: value })) onError("Device storage is unavailable. Save before leaving this page."); }
  async function add(suggestion?: ExerciseSuggestion) {
    const prescription = suggestion?.sets ?? Array.from({ length: Math.min(50, Math.max(0, Number(draft.sets))) }, () => ({ reps: Number(draft.reps), weight: draft.weight === "" ? 0 : Number(draft.weight) }));
    if (!suggestion && (!Number.isInteger(Number(draft.sets)) || Number(draft.sets) < 1 || Number(draft.sets) > 50 || !draft.reps.trim())) { onError("Enter 1 to 50 sets and whole reps."); return; }
    const payload = retry ?? { name: suggestion?.name ?? draft.name, ...(suggestion?.catalogExerciseId ? { catalogExerciseId: suggestion.catalogExerciseId } : {}), prescription, requestKey: draft.requestKey ?? crypto.randomUUID() };
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
    {isOpen ? <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface-muted p-3">
      <label className="min-w-0 text-xs font-semibold text-muted">Exercise name<input aria-label="New exercise name" value={draft.name} onChange={(e) => change("name", e.target.value)} disabled={busy || !!retry} className={`${workoutInput} mt-1 w-full`} /></label>
      <div className="flex flex-wrap gap-2">
        {([['sets', 'Sets'], ['reps', 'New exercise reps'], ['weight', 'Weight']] as const).map(([field, label]) => <label key={field} className={`text-xs font-semibold text-muted ${field === "weight" ? "min-w-[min(100%,7rem)] flex-[2_1_7rem]" : "min-w-[min(100%,4rem)] flex-[1_1_4rem]"}`}>
          {field === "weight" ? `Weight (${unit})` : field === "reps" ? "Reps" : "Sets"}
          <input aria-label={label} type="number" inputMode={field === "weight" ? "decimal" : "numeric"} min={field === "weight" ? 0 : 1} step={field === "weight" ? "any" : 1} value={draft[field]} disabled={busy || !!retry} onChange={(e) => change(field, e.target.value)} className={`${workoutInput} mt-1 w-full px-2 font-normal`} />
        </label>)}
      </div>
      <button type="button" className="touch-target rounded-xl bg-foreground px-3 py-2 text-base font-semibold text-background active:opacity-90 disabled:opacity-50" disabled={disabled || busy || (!draft.name.trim() && !retry)} onClick={() => add()}>{busy ? "Adding…" : retry ? "Retry adding exercise" : "Add to workout"}</button>
      {!retry && <button type="button" className={`${workoutButton} text-muted`} disabled={busy} onClick={() => { store(null); setOpen(false); setSearchResult(null); }}>Cancel</button>}
      {!retry && <div className="border-t border-line pt-3">
        <p className="eyebrow text-xs text-muted">Reuse previous values</p>
        {!currentResult ? <p role="status" className="mt-2 text-sm text-muted">Loading recent exercises…</p> : currentResult.error ? <div className="mt-2 flex flex-col gap-2">
          <p role="alert" className="break-words text-sm text-danger-ink">{currentResult.error}</p>
          <button type="button" className={`${workoutButton} text-muted`} onClick={() => setSearchAttempt(attempt => attempt + 1)}>Retry search</button>
        </div> : currentResult.items.length === 0 ? <p role="status" className="mt-2 text-sm text-muted">{query ? "No matching exercises. You can still add this exercise." : "No recent exercises yet. Enter an exercise above."}</p> : <div className="mt-2 flex flex-col gap-2">
          {currentResult.items.slice(0, 8).map((item) => <button type="button" key={item.catalogExerciseId ?? item.name} disabled={busy || disabled} className={`${workoutButton} break-words py-2 text-left`} onClick={() => add(item)}><span className="block">{item.name}</span><span className="text-xs font-normal text-muted">{item.sets.length} sets · {item.sets[0]?.reps} reps at {item.sets[0]?.weight} {unit} · {item.date}</span></button>)}
        </div>}
      </div>}
    </div> : <button type="button" onClick={() => setOpen(true)} disabled={disabled} className={`${workoutButton} w-full border-dashed text-muted`}>Add exercise</button>}
  </div>;
}
