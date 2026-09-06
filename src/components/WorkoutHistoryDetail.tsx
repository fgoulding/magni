"use client";
import { useEffect, useRef, useState } from "react";
import type { ActualChange, CorrectionPreview, WorkoutSession } from "@/features/workouts/types";
import { useWorkoutDraft, workoutButton, workoutPrimaryButton, workoutInput, workoutRequest, WorkoutRequestError } from "./quick-workout-utils";
import { editorMetadata } from "./workout-card-utils";
import { WorkoutReuse } from "./WorkoutReuse";

type CorrectionValues = { date: string; reason: string; values: Record<number, { reps: string; weight: string }> };
type CorrectionBody = { expectedRevision: number; date: string; reason: string; sets: ActualChange[]; requestKey: string };
type CorrectionDraft = CorrectionValues & { revision: number; requestKey?: string; baseDate?: string; pending?: { body: CorrectionBody; values: CorrectionValues } };
const correctionValues = ({ date, reason, values }: CorrectionValues): CorrectionValues => ({ date, reason, values });
export function WorkoutHistoryDetail({ initialSession, today }: { initialSession: WorkoutSession; today: string }) {
  const [session, setSession] = useState(initialSession);
  const [editing, setEditing] = useState(false);
  const [draft, store] = useWorkoutDraft<CorrectionDraft>(`magni.workout.${session.id}.correction`, { revision: session.revision, date: session.date, reason: "Corrected training log", values: {} });
  const [preview, setPreview] = useState<CorrectionPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const [conflict, setConflict] = useState<WorkoutSession | null>(null);
  const dirty = Object.keys(draft.values).length > 0 || draft.date !== session.date;
  const dateInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const reviewPanel = useRef<HTMLDivElement>(null);
  const wasEditing = useRef(false);
  const editorOpen = editing || dirty;
  useEffect(() => {
    if (conflict) reviewPanel.current?.focus();
    else if (editorOpen) dateInput.current?.focus();
    else if (wasEditing.current) heading.current?.focus();
    wasEditing.current = editorOpen;
  }, [editorOpen, conflict]);
  function change(next: CorrectionDraft) { if (busy) return; if (!store({ ...next, baseDate: next.baseDate ?? session.date })) setMessage("Device storage is unavailable. Keep this page open until saved."); setPreview(null); }
  function rebase(result: WorkoutSession, baseDate = draft.baseDate): CorrectionDraft {
    return { ...correctionValues(draft), date: draft.date === baseDate ? result.date : draft.date, baseDate: result.date, revision: result.revision,
      values: Object.fromEntries(Object.entries(draft.values).filter(([id, value]) => {
        const set = result.sets.find((set) => set.id === Number(id));
        return set && (value.reps !== (set.actual_reps === null ? "" : String(set.actual_reps)) || value.weight !== (set.actual_weight === null ? "" : String(set.actual_weight)));
      })) };
  }
  function values(set: WorkoutSession["sets"][number]) { return draft.values[set.id] ?? { reps: set.actual_reps === null ? "" : String(set.actual_reps), weight: set.actual_weight === null ? "" : String(set.actual_weight) }; }
  function changes(): ActualChange[] {
    return Object.entries(draft.values).map(([id, value]) => {
      const reps = value.reps.trim() === "" ? null : Number(value.reps); const weight = value.weight.trim() === "" ? null : Number(value.weight);
      if (reps !== null && (!Number.isInteger(reps) || reps < 0) || weight !== null && (!Number.isFinite(weight) || weight < 0)) throw new Error("Enter whole reps and nonnegative weights, or leave reps blank for an unlogged set.");
      return { setId: Number(id), actualReps: reps, actualWeight: weight };
    });
  }
  async function correct(save: boolean) {
    if (busy || needsReview || !save && draft.pending) return;
    setBusy(true); setMessage("");
    try {
      const pending = draft.pending ?? { body: { expectedRevision: draft.revision, date: draft.date, reason: draft.reason, sets: changes(), requestKey: draft.requestKey ?? crypto.randomUUID() }, values: correctionValues(draft) };
      const body = save ? pending.body : { expectedRevision: draft.revision, date: draft.date, reason: draft.reason, sets: changes(), preview: true };
      if (save) store({ ...draft, pending });
      const result = await workoutRequest<CorrectionPreview & { session?: WorkoutSession }>(`/api/sessions/${session.id}/corrections`, "POST", body);
      if (save && result.session?.id === session.id && Array.isArray(result.session.sets) && Number.isInteger(result.session.revision)) {
        setSession(result.session); setPreview(null);
        if (JSON.stringify(correctionValues(draft)) === JSON.stringify(pending.values)) { store(null); setEditing(false); setMessage("Correction saved. Future progression remains unchanged."); }
        else { store(rebase(result.session, pending.values.date)); setEditing(true); setMessage("Previous correction confirmed. Your newer actuals are still unsaved; preview them before saving."); }
      }
      else if (save) throw new Error("Could not confirm the saved correction. Resolve the previous correction before saving another change.");
      else setPreview(result);
    } catch (error) {
      if (error instanceof WorkoutRequestError && error.confirmedRejection) store({ ...draft, pending: undefined, requestKey: undefined });
      if (error instanceof WorkoutRequestError && error.status === 409 && error.confirmedClientError) setNeedsReview(true);
      setMessage(error instanceof Error ? error.message : "Could not save correction.");
    }
    finally { setBusy(false); }
  }
  async function reviewSaved() {
    setBusy(true);
    try {
      const result = await workoutRequest<WorkoutSession>(`/api/sessions/${session.id}`, "GET");
      if (result.id !== session.id || !Array.isArray(result.sets) || !Number.isInteger(result.revision)) throw new Error("Could not confirm the current actuals. Your draft is still available.");
      setConflict(result);
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not load saved workout."); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-4">
    <section className="card p-4"><p className="eyebrow text-xs text-brand-strong">{session.status === "skipped" ? "Skipped" : "Completed workout"}</p><h1 className="display mt-1 text-3xl">{session.name}</h1><p className="mt-2 text-sm text-muted">{session.date} · {session.loggedSets} of {session.totalSets} sets logged · {Math.round(session.volume).toLocaleString()} {session.unit} volume</p></section>
    <section className="card p-4">
      <div className="flex items-center justify-between gap-3"><h2 ref={heading} tabIndex={-1} className="display text-2xl">Training log</h2>{session.status === "completed" && !editing && !dirty && <button className={workoutButton} onClick={() => setEditing(!editing)} disabled={busy}>{editing ? "Hide corrections" : "Correct workout"}</button>}</div>
      {(editing || dirty) && <div className="my-4 flex flex-col gap-3"><p className="text-sm text-muted">Original prescriptions stay intact. Blank reps mean unlogged; zero reps record an attempted set.</p><label className="text-xs text-muted">Recorded date<input ref={dateInput} className={`${workoutInput} mt-1 w-full`} aria-label="Correct workout date" disabled={busy} type="date" value={draft.date} onChange={(e) => change({ ...draft, date: e.target.value })} /></label></div>}
      <ul className="mt-3 divide-y divide-line">{session.sets.map((set, index) => <li key={set.id} className="py-3"><p className="font-semibold">{set.exercise_name} · Set {index + 1}</p><p className="mt-1 text-xs text-muted">Prescribed: {set.sets > 1 ? `${set.sets} × ` : ""}{set.reps}{set.rep_out_target > set.reps ? `–${set.rep_out_target}` : ""} reps at {set.calculated_weight ?? 0} {session.unit}</p>{set.editor_json && <p className="mt-1 text-xs text-muted">{[editorMetadata(set)?.set.role, editorMetadata(set)?.set.effortKind !== "none" ? `${editorMetadata(set)?.set.effortKind.toUpperCase()} ${editorMetadata(set)?.set.effort}` : "", editorMetadata(set)?.set.restSeconds ? `${editorMetadata(set)?.set.restSeconds}s rest` : "", editorMetadata(set)?.set.tempo ? `Tempo ${editorMetadata(set)?.set.tempo}` : "", editorMetadata(set)?.set.notes].filter(Boolean).join(" · ")}</p>}{editing || dirty ? <div className="mt-2 grid grid-cols-2 gap-3"><label className="text-xs text-muted">Actual reps<input className={`${workoutInput} mt-1 w-full`} type="number" min={0} aria-label={`Correct reps for set ${index + 1}`} disabled={busy} value={values(set).reps} onChange={(e) => change({ ...draft, values: { ...draft.values, [set.id]: { ...values(set), reps: e.target.value } } })} /></label><label className="text-xs text-muted">Actual {session.unit}<input className={`${workoutInput} mt-1 w-full`} type="number" min={0} step="any" aria-label={`Correct weight for set ${index + 1}`} disabled={busy} value={values(set).weight} onChange={(e) => change({ ...draft, values: { ...draft.values, [set.id]: { ...values(set), weight: e.target.value } } })} /></label></div> : <p className="mt-2 text-sm">{set.actual_reps === null ? "Not logged" : `${set.actual_reps} reps at ${set.actual_weight ?? 0} ${session.unit}`}</p>}</li>)}</ul>
      {(editing || dirty) && <div className="mt-4 flex flex-col gap-3"><label className="text-xs text-muted">Correction note<input aria-label="Correction note" disabled={busy} className={`${workoutInput} mt-1 w-full`} value={draft.reason} onChange={(e) => change({ ...draft, reason: e.target.value })} /></label><p className="text-xs text-muted">{dirty ? "Unsaved correction · kept on this device" : "No changed values"}</p><button className={workoutButton} disabled={busy || !dirty || !!draft.pending || needsReview} onClick={() => correct(false)}>Preview correction</button>{preview && <div className="rounded-xl bg-surface-muted p-3"><p className="text-sm">{preview.progressionEffect}</p>{preview.comparisons.map((comparison, index) => <div key={index} className="mt-3 text-xs"><p className="font-semibold">{comparison.exercise}</p><p>Original decision: {comparison.previous}</p><p>With corrected reps: {comparison.corrected}</p><p className="text-muted">Comparison only; saved progression stays unchanged.</p></div>)}<button className={`${workoutPrimaryButton} mt-3 w-full`} disabled={busy || !!draft.pending || needsReview} onClick={() => correct(true)}>{busy ? "Saving…" : "Save correction"}</button></div>}<button className={workoutButton} disabled={busy || !!draft.pending && !needsReview} onClick={() => { store(null); setPreview(null); setEditing(false); setConflict(null); setNeedsReview(false); }}>Discard unsaved correction</button></div>}
      {draft.pending && <div className="mt-3"><p role="status" className="text-sm text-muted">Confirm the previous correction first. Your newer edits stay on this device.</p><button className={`${workoutButton} mt-2`} disabled={busy || needsReview} onClick={() => correct(true)}>Resolve previous correction</button></div>}
      {needsReview && <button className={`${workoutButton} mt-3`} disabled={busy} onClick={reviewSaved}>Review saved actuals</button>}
      {conflict && <div ref={reviewPanel} tabIndex={-1} aria-label="Saved actuals review" className="mt-3 rounded-xl bg-surface-muted p-3"><p className="text-sm">Saved workout: {conflict.date}. Review the current values before replacing any of them.</p><ul className="mt-2 text-sm">{conflict.sets.map((set, index) => <li key={set.id}>{set.exercise_name} set {index + 1}: {set.actual_reps === null ? "Not logged" : `${set.actual_reps} reps at ${set.actual_weight ?? 0} ${conflict.unit}`}</li>)}</ul><div className="mt-2 flex flex-wrap gap-2"><button className={workoutButton} disabled={busy} onClick={() => { setSession(conflict); store(null); setConflict(null); setNeedsReview(false); setEditing(false); setPreview(null); setMessage(""); }}>Use saved actuals</button><button className={workoutButton} disabled={busy} onClick={() => { store(rebase(conflict)); setSession(conflict); setConflict(null); setNeedsReview(false); setPreview(null); setMessage("Your actual edits are ready to preview against the reviewed version."); }}>Keep my actual edits</button></div></div>}
      {message && <p role="status" className="mt-3 text-sm text-muted">{message}</p>}
      {session.corrections.length > 0 && <div className="mt-4 border-t border-line pt-3"><p className="eyebrow text-xs text-muted">Correction history</p>{session.corrections.map((correction) => <p key={correction.id} className="mt-2 text-xs text-muted">{correction.created_at} · {correction.reason}</p>)}</div>}
    </section>
    <section className="card p-4"><h2 className="display mb-3 text-2xl">Use this workout again</h2><WorkoutReuse sessionId={session.id} name={session.name} today={today} /></section>
  </div>;
}
