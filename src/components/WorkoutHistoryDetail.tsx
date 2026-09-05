"use client";
import { useState } from "react";
import type { ActualChange, CorrectionPreview, WorkoutSession } from "@/features/workouts/types";
import { useWorkoutDraft, workoutButton, workoutPrimaryButton, workoutInput, workoutRequest } from "./quick-workout-utils";
import { editorMetadata } from "./workout-card-utils";
import { WorkoutReuse } from "./WorkoutReuse";

type CorrectionDraft = { revision: number; date: string; reason: string; values: Record<number, { reps: string; weight: string }>; requestKey?: string };
export function WorkoutHistoryDetail({ initialSession, today }: { initialSession: WorkoutSession; today: string }) {
  const [session, setSession] = useState(initialSession);
  const [editing, setEditing] = useState(false);
  const [draft, store] = useWorkoutDraft<CorrectionDraft>(`magni.workout.${session.id}.correction`, { revision: session.revision, date: session.date, reason: "Corrected training log", values: {} });
  const [preview, setPreview] = useState<CorrectionPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = Object.keys(draft.values).length > 0 || draft.date !== session.date;
  function change(next: CorrectionDraft) { if (busy) return; if (!store(next)) setMessage("Device storage is unavailable. Keep this page open until saved."); setPreview(null); }
  function values(set: WorkoutSession["sets"][number]) { return draft.values[set.id] ?? { reps: set.actual_reps === null ? "" : String(set.actual_reps), weight: set.actual_weight === null ? "" : String(set.actual_weight) }; }
  function changes(): ActualChange[] {
    return Object.entries(draft.values).map(([id, value]) => {
      const reps = value.reps.trim() === "" ? null : Number(value.reps); const weight = value.weight.trim() === "" ? null : Number(value.weight);
      if (reps !== null && (!Number.isInteger(reps) || reps < 0) || weight !== null && (!Number.isFinite(weight) || weight < 0)) throw new Error("Enter whole reps and nonnegative weights, or leave reps blank for an unlogged set.");
      return { setId: Number(id), actualReps: reps, actualWeight: weight };
    });
  }
  async function correct(save: boolean) {
    setBusy(true); setMessage("");
    try {
      const requestKey = draft.requestKey ?? crypto.randomUUID();
      const body = { expectedRevision: draft.revision, date: draft.date, reason: draft.reason, sets: changes(), ...(save ? { requestKey } : { preview: true }) };
      if (save) store({ ...draft, requestKey });
      const result = await workoutRequest<CorrectionPreview & { session?: WorkoutSession }>(`/api/sessions/${session.id}/corrections`, "POST", body);
      if (save && result.session) { setSession(result.session); store(null); setEditing(false); setPreview(null); setMessage("Correction saved. Future progression remains unchanged."); }
      else setPreview(result);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save correction."); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-4">
    <section className="card p-4"><p className="eyebrow text-xs text-brand-strong">{session.status === "skipped" ? "Skipped" : "Completed workout"}</p><h1 className="display mt-1 text-3xl">{session.name}</h1><p className="mt-2 text-sm text-muted">{session.date} · {session.loggedSets} of {session.totalSets} sets logged · {Math.round(session.volume).toLocaleString()} {session.unit} volume</p></section>
    <section className="card p-4">
      <div className="flex items-center justify-between gap-3"><h2 className="display text-2xl">Training log</h2>{session.status === "completed" && !editing && !dirty && <button className={workoutButton} onClick={() => setEditing(!editing)} disabled={busy}>{editing ? "Hide corrections" : "Correct workout"}</button>}</div>
      {(editing || dirty) && <div className="my-4 flex flex-col gap-3"><p className="text-sm text-muted">Original prescriptions stay intact. Blank reps mean unlogged; zero reps record an attempted set.</p><label className="text-xs text-muted">Recorded date<input className={`${workoutInput} mt-1 w-full`} aria-label="Correct workout date" disabled={busy} type="date" value={draft.date} onChange={(e) => change({ ...draft, date: e.target.value })} /></label></div>}
      <ul className="mt-3 divide-y divide-line">{session.sets.map((set, index) => <li key={set.id} className="py-3"><p className="font-semibold">{set.exercise_name} · Set {index + 1}</p><p className="mt-1 text-xs text-muted">Prescribed: {set.sets > 1 ? `${set.sets} × ` : ""}{set.reps}{set.rep_out_target > set.reps ? `–${set.rep_out_target}` : ""} reps at {set.calculated_weight ?? 0} {session.unit}</p>{set.editor_json && <p className="mt-1 text-xs text-muted">{[editorMetadata(set)?.set.role, editorMetadata(set)?.set.effortKind !== "none" ? `${editorMetadata(set)?.set.effortKind.toUpperCase()} ${editorMetadata(set)?.set.effort}` : "", editorMetadata(set)?.set.restSeconds ? `${editorMetadata(set)?.set.restSeconds}s rest` : "", editorMetadata(set)?.set.tempo ? `Tempo ${editorMetadata(set)?.set.tempo}` : "", editorMetadata(set)?.set.notes].filter(Boolean).join(" · ")}</p>}{editing || dirty ? <div className="mt-2 grid grid-cols-2 gap-3"><label className="text-xs text-muted">Actual reps<input className={`${workoutInput} mt-1 w-full`} type="number" min={0} aria-label={`Correct reps for set ${index + 1}`} disabled={busy} value={values(set).reps} onChange={(e) => change({ ...draft, values: { ...draft.values, [set.id]: { ...values(set), reps: e.target.value } } })} /></label><label className="text-xs text-muted">Actual {session.unit}<input className={`${workoutInput} mt-1 w-full`} type="number" min={0} step="any" aria-label={`Correct weight for set ${index + 1}`} disabled={busy} value={values(set).weight} onChange={(e) => change({ ...draft, values: { ...draft.values, [set.id]: { ...values(set), weight: e.target.value } } })} /></label></div> : <p className="mt-2 text-sm">{set.actual_reps === null ? "Not logged" : `${set.actual_reps} reps at ${set.actual_weight ?? 0} ${session.unit}`}</p>}</li>)}</ul>
      {(editing || dirty) && <div className="mt-4 flex flex-col gap-3"><label className="text-xs text-muted">Correction note<input aria-label="Correction note" disabled={busy} className={`${workoutInput} mt-1 w-full`} value={draft.reason} onChange={(e) => change({ ...draft, reason: e.target.value })} /></label><p className="text-xs text-muted">{dirty ? "Unsaved correction · kept on this device" : "No changed values"}</p><button className={workoutButton} disabled={busy || !dirty} onClick={() => correct(false)}>Preview correction</button>{preview && <div className="rounded-xl bg-surface-muted p-3"><p className="text-sm">{preview.progressionEffect}</p>{preview.comparisons.map((comparison, index) => <div key={index} className="mt-3 text-xs"><p className="font-semibold">{comparison.exercise}</p><p>Original decision: {comparison.previous}</p><p>With corrected reps: {comparison.corrected}</p><p className="text-muted">Comparison only; saved progression stays unchanged.</p></div>)}<button className={`${workoutPrimaryButton} mt-3 w-full`} disabled={busy} onClick={() => correct(true)}>{busy ? "Saving…" : "Save correction"}</button></div>}<button className={workoutButton} disabled={busy} onClick={() => { store(null); setPreview(null); setEditing(false); }}>Discard unsaved correction</button></div>}
      {message && <p role="status" className="mt-3 text-sm text-muted">{message}</p>}
      {session.corrections.length > 0 && <div className="mt-4 border-t border-line pt-3"><p className="eyebrow text-xs text-muted">Correction history</p>{session.corrections.map((correction) => <p key={correction.id} className="mt-2 text-xs text-muted">{correction.created_at} · {correction.reason}</p>)}</div>}
    </section>
    <section className="card p-4"><h2 className="display mb-3 text-2xl">Use this workout again</h2><WorkoutReuse sessionId={session.id} name={session.name} today={today} /></section>
  </div>;
}
