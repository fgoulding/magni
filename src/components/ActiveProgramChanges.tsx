"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ActiveEditorChangeInput, listActiveEditorChanges, previewActiveEditorChanges } from "@/features/program-editor/active-changes";
import type { EditorPrescriptionSet } from "@/features/program-editor/repository";
import { describeProgressionRule } from "@/features/program-editor/progression";
import { useWorkoutDraft, workoutButton, workoutInput, workoutPrimaryButton, WorkoutRequestError, workoutRequest } from "./quick-workout-utils";

type Selection = Omit<ActiveEditorChangeInput, "userId" | "programId">;
type Context = ReturnType<typeof listActiveEditorChanges>;
type Preview = ReturnType<typeof previewActiveEditorChanges>;
type ApplyRequest = Selection & { preview: false; expectedPreviewToken: string; requestKey: string };
type CopyRequest = { action: "copy_published"; publishedRevisionId: number; requestKey: string };
type Pending = { request: ApplyRequest | CopyRequest; draftId: string };
const subscribeReady = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const message = (error: unknown) => error instanceof Error ? error.message : "Could not confirm the change. Retry the pending request.";
const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function Prescriptions({ sets }: { sets: EditorPrescriptionSet[] }) {
  const groups = new Map<string, EditorPrescriptionSet[]>();
  for (const set of sets) groups.set(set.editor.exerciseId, [...(groups.get(set.editor.exerciseId) ?? []), set]);
  if (!sets.length) return <p className="text-sm text-muted">No exercises.</p>;
  return <div className="space-y-3">{Array.from(groups, ([id, rows]) => <div key={id} className="space-y-1">
    <p className="font-semibold">{rows[0].exercise_name}{rows[0].superset_group ? ` · Superset ${rows[0].superset_group}` : ""}</p>
    <ul className="space-y-1 text-sm">{rows.map((row, index) => {
      const set = row.editor.set;
      const target = row.reps === row.rep_out_target ? `${row.reps}` : `${row.reps}–${row.rep_out_target}`;
      const load = set.loadMode === "bodyweight" ? "bodyweight" : `${row.calculated_weight} ${row.editor.unit}${set.loadMode === "added" ? " added" : ""}`;
      return <li key={`${set.id}:${index}`}>{index + 1}. {set.role === "warmup" ? "Warm-up" : set.role === "backoff" ? "Back-off" : set.role} · {target} reps · {load}
        {set.loadMode === "percent" ? ` (${set.load}% of ${row.training_max} ${row.editor.unit} max)` : set.loadMode === "fixed" ? " (fixed)" : ""}
        {set.effortKind !== "none" ? ` · ${set.effortKind.toUpperCase()} ${set.effort}` : ""}
        {set.restSeconds ? ` · ${set.restSeconds}s rest` : ""}{set.tempo ? ` · Tempo ${set.tempo}` : ""}{set.notes ? ` · ${set.notes}` : ""}
      </li>;
    })}</ul>
    <p className="text-sm text-muted">{describeProgressionRule(rows[0].editor.rule)}</p>
  </div>)}</div>;
}

export function ActiveProgramChanges({ programId, draftId, saveDraft }: { programId: number; draftId: string; saveDraft: () => Promise<number | null> }) {
  const ready = useSyncExternalStore(subscribeReady, clientReady, serverReady);
  const [pending, persistPending] = useWorkoutDraft<Pending | null>(`magni:active-program-change:${programId}`, null);
  const [context, setContext] = useState<Context | null>(null);
  const [scope, setScope] = useState<Selection["scope"]>("occurrence");
  const [occurrenceId, setOccurrenceId] = useState<number | null>(null);
  const [policy, setPolicy] = useState<Selection["progressionState"]>("preserve");
  const [review, setReview] = useState<{ selection: Selection; preview: Preview } | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [copyId, setCopyId] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const url = `/api/programs/${programId}/editor-changes`;
  const disabled = !ready || busy || Boolean(pending);
  const pendingSelection = pending && "scope" in pending.request ? pending.request : null;
  const displayedScope = pendingSelection?.scope ?? scope;
  const displayedPolicy = pendingSelection?.progressionState ?? policy;
  const selected = pendingSelection?.occurrenceId ?? occurrenceId ?? context?.occurrences.find(row => row.editable)?.occurrenceId ?? null;

  useEffect(() => {
    let cancelled = false;
    workoutRequest<Context>(url, "GET").then(result => {
      if (result.draftId !== draftId || !Array.isArray(result.occurrences)) throw new Error("Could not load this active program's edit scopes.");
      if (!cancelled) { setContext(result); setLoadError(""); }
    }).catch(error => { if (!cancelled) setLoadError(message(error)); });
    return () => { cancelled = true; };
  }, [url, draftId, loadVersion]);

  function begin() {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    return true;
  }
  function end() { lock.current = false; setBusy(false); }
  async function makePreview() {
    if (disabled || !context || !begin()) return;
    setReview(null);
    try {
      const revision = await saveDraft();
      if (!positiveInteger(revision)) throw new Error("Save the draft successfully before reviewing active changes.");
      const selection: Selection = { draftId, expectedDraftRevision: revision, scope, progressionState: policy, ...(scope === "definition" ? {} : { occurrenceId: selected! }) };
      const result = await workoutRequest<Preview & { success?: boolean }>(url, "POST", { ...selection, preview: true });
      if (result.success !== true || !/^[a-f0-9]{64}$/.test(result.previewToken) || result.scope !== scope || !Array.isArray(result.affected) || !Array.isArray(result.excluded) || !Array.isArray(result.progressionChanges)) throw new Error("Could not confirm this preview. Review the changes again.");
      setReview({ selection, preview: result });
    } catch (error) { setError(message(error)); }
    finally { end(); }
  }

  // A pending request is the durable record of an operation that may already have
  // committed. Retrying it must not substitute a new draft, scope, version, or key.
  async function dispatch(attempt: Pending) {
    try {
      const result = await workoutRequest<{ success?: boolean; revisionId?: number; changed?: number; draftId?: string }>(url, "POST", attempt.request);
      if (result.success !== true) throw new Error("Could not confirm this change. Retry the pending request.");
      if ("action" in attempt.request) {
        if (!uuid(result.draftId)) throw new Error("Could not confirm the copied draft. Retry the pending request.");
        setCopyId(result.draftId); setNotice("Copied the published definition into a new draft.");
      } else {
        if (!positiveInteger(result.revisionId) || !Number.isSafeInteger(result.changed) || result.changed! < 0) throw new Error("Could not confirm the applied version. Retry the pending request.");
        setNotice(`Applied version ${result.revisionId}. ${result.changed === 0 ? "Published for future copies." : `${result.changed} workout${result.changed === 1 ? "" : "s"} updated.`}`);
      }
      persistPending(null); setReview(null); setLoadVersion(value => value + 1);
    } catch (error) {
      if (error instanceof WorkoutRequestError && error.confirmedClientError) { persistPending(null); setReview(null); setLoadVersion(value => value + 1); }
      setError(message(error));
    }
  }
  async function apply() {
    if (disabled || !review || !begin()) return;
    try {
      const revision = await saveDraft();
      if (!positiveInteger(revision)) throw new Error("Save the draft successfully before applying reviewed changes.");
      if (revision !== review.selection.expectedDraftRevision) { setReview(null); throw new Error("The draft changed since this preview. Review again before applying."); }
      const attempt: Pending = { draftId, request: { ...review.selection, preview: false, expectedPreviewToken: review.preview.previewToken, requestKey: crypto.randomUUID() } };
      if (!persistPending(attempt)) { persistPending(null); throw new Error("Device storage is unavailable. Free space or enable storage before applying changes safely."); }
      await dispatch(attempt);
    } catch (error) { setError(message(error)); }
    finally { end(); }
  }
  async function copyPublished() {
    if (disabled || !context?.publishedRevisionId || !begin()) return;
    try {
      const attempt: Pending = { draftId, request: { action: "copy_published", publishedRevisionId: context.publishedRevisionId, requestKey: crypto.randomUUID() } };
      if (!persistPending(attempt)) { persistPending(null); throw new Error("Device storage is unavailable. Free space or enable storage before copying safely."); }
      await dispatch(attempt);
    } catch (error) { setError(message(error)); }
    finally { end(); }
  }
  async function retry() {
    if (!ready || busy || !pending || !begin()) return;
    try { await dispatch(pending); } finally { end(); }
  }

  return <section aria-label="Changes to active program" className="card space-y-4 p-4 sm:p-5">
    <div><p className="eyebrow text-brand-strong">Active program</p><h2 className="display text-2xl">Review where edits apply</h2>
      <p className="mt-1 text-sm text-muted">Saving edits updates this draft. Choose where to apply a saved version. Started, completed, and skipped workouts keep their prescriptions.</p></div>
    {loadError && <div role="alert" className="space-y-2 text-danger-ink"><p>{loadError}</p><button type="button" disabled={busy} className={workoutButton} onClick={() => setLoadVersion(value => value + 1)}>Reload edit scopes</button></div>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-semibold">Change scope<select aria-label="Change scope" className={workoutInput} disabled={disabled || !context} value={displayedScope} onChange={event => { setScope(event.target.value as Selection["scope"]); setReview(null); }}>
        <option value="occurrence">This workout only</option><option value="remaining_block">Remaining block in this cycle</option><option value="definition">Reusable definition for future copies</option>
      </select></label>
      {displayedScope !== "definition" && <label className="grid gap-1 text-sm font-semibold">Starting workout<select className={workoutInput} disabled={disabled || !context} value={selected ?? ""} onChange={event => { setOccurrenceId(Number(event.target.value)); setReview(null); }}>
        {context?.occurrences.filter(row => row.editable || row.occurrenceId === pendingSelection?.occurrenceId).map(row => <option key={row.occurrenceId} value={row.occurrenceId}>{dateLabel(row.date)} · {row.name} · {row.block}, {row.weekName}, cycle {row.cycle}{row.extra ? " · Extra copy" : ""}</option>)}
        {context && !context.occurrences.some(row => row.editable) && <option value="">No unstarted workouts</option>}
      </select></label>}
    </div>
    {displayedScope === "remaining_block" && <p className="text-sm text-muted">From the selected workout through the rest of its named block in this cycle, using program order. Moving a date does not change which block it belongs to.</p>}
    {displayedScope !== "definition" ? <label className="grid gap-1 text-sm font-semibold">Progression values<select aria-label="Progression values" className={workoutInput} disabled={disabled} value={displayedPolicy} onChange={event => { setPolicy(event.target.value as Selection["progressionState"]); setReview(null); }}>
      <option value="preserve">Keep current values</option><option value="use_draft">Use draft starting values</option>
    </select><span className="font-normal text-muted">Keep current preserves existing shared or separate values. Changed rules create separate progression for selected workouts. Use draft resets loads, maxes, reps, failure counts, and weekly evaluation, and adopts the draft’s sharing within this scope. New exercises use their draft starting values.</span></label>
      : <p className="text-sm text-muted">Publishing saves an immutable reusable definition. It does not change scheduled workouts or their progression. Use “Copy published definition” below to start a new draft from that version; later edits to this draft will not change it.</p>}
    <button type="button" className={workoutButton} disabled={disabled || !context || (scope !== "definition" && selected === null)} onClick={() => void makePreview()}>{busy && !pending ? "Preparing…" : "Review changes"}</button>
    {review && <div className="space-y-4 rounded-xl border border-line bg-surface-muted p-3">
      <p className="font-semibold">Saved draft revision {review.selection.expectedDraftRevision}</p><p className="text-sm">{review.preview.explanation}</p>
      {review.preview.affected.map(row => <details key={row.occurrenceId} className="rounded-xl border border-line bg-surface p-3">
        <summary className="touch-target cursor-pointer font-semibold"><span>{row.newName}</span><span className="block text-sm font-normal text-muted">{dateLabel(row.date)} · Review before and after</span></summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2"><div><h3 className="mb-2 font-semibold">Before · {row.name}</h3><Prescriptions sets={row.before} /></div><div><h3 className="mb-2 font-semibold">After · {row.newName}</h3><Prescriptions sets={row.after} /></div></div>
      </details>)}
      {review.preview.excluded.length > 0 && <div><h3 className="font-semibold">Protected workouts · unchanged</h3><ul className="mt-1 space-y-1 text-sm text-muted">{review.preview.excluded.map(row => <li key={row.occurrenceId}>{dateLabel(row.date)} · {row.name} · {row.status.replaceAll("_", " ")}</li>)}</ul></div>}
      {review.preview.progressionChanges.map(row => {
        const after = review.preview.affected.flatMap(workout => workout.after).find(set => set.editor.progressionKey === row.progressionKey);
        const before = review.preview.affected.flatMap(workout => workout.before).find(set => set.editor.exerciseId === after?.editor.exerciseId);
        const afterUnit = after?.editor.unit ?? "";
        const beforeUnit = before?.editor.unit ?? afterUnit;
        return <div key={row.progressionKey} className="space-y-1 text-sm"><h3 className="font-semibold">{row.exerciseName} · {row.separated ? "Separate progression for these workouts" : "Keep existing shared progression"}</h3>
        <p>Working load: {row.beforeState.load} {beforeUnit} → {row.afterState.load} {afterUnit}; training max: {row.beforeState.trainingMax} {beforeUnit} → {row.afterState.trainingMax} {afterUnit}; reps: {row.beforeState.reps} → {row.afterState.reps}.</p>
        <p>Consecutive failures: {row.beforeState.consecutiveFailures} → {row.afterState.consecutiveFailures}. Last evaluated week: {row.beforeState.lastEvaluatedWeek ?? "none"} → {row.afterState.lastEvaluatedWeek ?? "none"}.</p>
      </div>; })}
      <button type="button" className={workoutPrimaryButton} disabled={disabled} onClick={() => void apply()}>Apply reviewed changes</button>
    </div>}
    {pending && <div className="space-y-2 rounded-xl border border-warn-line bg-warn-soft p-3"><p className="font-semibold">{busy ? "Confirming change…" : "A change still needs confirmation"}</p><p className="text-sm">{"action" in pending.request ? `Copy of published definition version ${pending.request.publishedRevisionId}.` : `Apply saved draft revision ${pending.request.expectedDraftRevision} with the scope and progression values shown above.`} The server may already have saved this request. Retry it before making another change. Its reviewed values and request key are kept on this device.</p><button type="button" disabled={!ready || busy} className={workoutButton} onClick={() => void retry()}>Retry pending change</button></div>}
    {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
    {notice && <p role="status" className="text-sm text-success-ink">{notice}</p>}
    <div className="space-y-2 border-t border-line pt-3"><p className="text-sm text-muted">{context?.publishedRevisionId ? `Published definition version ${context.publishedRevisionId} is available for future copies.` : "Publish a reusable definition to make a fixed version available for future copies."}</p>
      <button type="button" className={workoutButton} disabled={disabled || !context?.publishedRevisionId} onClick={() => void copyPublished()}>Copy published definition</button>
      {copyId && <Link className="touch-target flex items-center font-semibold text-brand-strong underline" href={`/programs/editor/${copyId}`}>Open copied draft</Link>}
    </div>
  </section>;
}
