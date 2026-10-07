"use client";
import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { CandidateObservation, IdentityChangeInput, IdentityChangePreview, IdentityChangeResult, ProgressPage } from "@/features/progress/types";
import { useWorkoutDraft } from "@/components/quick-workout-utils";
import { CandidateFilters } from "./CandidateFilters";
import { actualResult, exerciseHref } from "./ExerciseRows";
import { ProgressDate, progressButton, progressInput } from "./ProgressChrome";
import { ProgressRequestError, progressRequest } from "./request";

type GroupingDraft = { name: string; selected: CandidateObservation[]; preview?: IdentityChangePreview; input?: IdentityChangeInput; requestKey?: string; result?: IdentityChangeResult; undoKey?: string };
const subscribe = () => () => {};
export function IdentitySelection({ initialPage, candidatesUrl, initialName, initialSelectedId, initialCursor = "", targetExerciseId, mode = "link", returnTo, draftKey = "magni.progress.grouping" }: { initialPage: ProgressPage<CandidateObservation>; candidatesUrl: string; initialName: string; initialSelectedId?: number; initialCursor?: string; targetExerciseId?: string; mode?: "link" | "detach"; returnTo: string; draftKey?: string }) {
  const router = useRouter();
  const [draft, store] = useWorkoutDraft<GroupingDraft>(draftKey, { name: initialName, selected: initialPage.items.filter(item => item.id === initialSelectedId) });
  const [page, setPage] = useState(initialPage);
  const [activeUrl, setActiveUrl] = useState(candidatesUrl);
  const [cursors, setCursors] = useState([initialCursor]);
  const [pageIndex, setPageIndex] = useState(0);
  const [reviewPage, setReviewPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const locked = !hydrated || busy || !!draft.requestKey;
  const preview = draft.preview;
  async function loadPage(cursor: string, previous = false, filteredUrl?: string) {
    setBusy(true); setError("");
    const url = new URL(filteredUrl ?? activeUrl, window.location.origin); if (cursor) url.searchParams.set("cursor", cursor); else url.searchParams.delete("cursor");
    try { setPage(await progressRequest<ProgressPage<CandidateObservation>>(url.pathname + url.search)); if (filteredUrl) { setActiveUrl(filteredUrl); setCursors([""]); setPageIndex(0); } else if (previous) setPageIndex(pageIndex - 1); else { setCursors([...cursors.slice(0, pageIndex + 1), cursor]); setPageIndex(pageIndex + 1); } }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load records. Try this page again."); }
    finally { setBusy(false); }
  }
  function select(candidate: CandidateObservation, checked: boolean) { store({ ...draft, selected: checked ? [...draft.selected.filter(item => item.id !== candidate.id), candidate] : draft.selected.filter(item => item.id !== candidate.id), preview: undefined, input: undefined }); }
  async function review() {
    setBusy(true); setError("");
    const input: IdentityChangeInput = { observationIds: draft.selected.map(item => item.id), mode, ...(targetExerciseId ? { targetExerciseId } : mode === "link" ? { name: draft.name.trim() } : {}) };
    try { const next = await progressRequest<IdentityChangePreview>("/api/progress/identity", { action: "preview", ...input }); store({ ...draft, input, preview: next }); setReviewPage(0); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not review these workouts. Try again."); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!preview || !draft.input) return;
    setBusy(true); setError("");
    const requestKey = draft.requestKey ?? crypto.randomUUID(); store({ ...draft, requestKey });
    try { const result = await progressRequest<IdentityChangeResult>("/api/progress/identity", { action: "apply", ...draft.input, previewToken: preview.token, requestKey }); store({ ...draft, requestKey: undefined, result }); router.refresh(); }
    catch (failure) { if (failure instanceof ProgressRequestError && failure.confirmedRejection) store({ ...draft, requestKey: undefined, preview: undefined, input: undefined }); setError(failure instanceof Error ? failure.message : "Could not confirm this grouping. Retry with the same reviewed workouts."); }
    finally { setBusy(false); }
  }
  async function undo() {
    if (!draft.result) return;
    setBusy(true); setError(""); const requestKey = draft.undoKey ?? crypto.randomUUID(); store({ ...draft, undoKey: requestKey });
    try { const result = await progressRequest<IdentityChangeResult>("/api/progress/identity", { action: "undo", changeId: draft.result.changeId, requestKey }); store({ ...draft, undoKey: undefined, result }); router.refresh(); }
    catch (failure) { if (failure instanceof ProgressRequestError && failure.confirmedRejection) store({ ...draft, undoKey: undefined }); setError(failure instanceof Error ? failure.message : "Could not reverse this change. Please retry."); }
    finally { setBusy(false); }
  }
  if (!hydrated) return <p role="status" className="text-muted">Loading your selection…</p>;
  return <div className="flex flex-col gap-4">
    {draft.result ? <section className="card p-4"><h2 className="display text-2xl">{draft.result.undone ? "Grouping change undone" : mode === "detach" ? "Selected records kept separate" : "Selected workouts connected"}</h2><p className="mt-2 text-sm text-muted">Your recorded sets and training plan are unchanged.</p><div className="mt-4 flex flex-wrap gap-2">{!draft.result.undone && <button type="button" className={progressButton} disabled={busy} onClick={undo}>Undo grouping change</button>}{draft.result.targetExerciseId && !draft.result.undone && <Link href={exerciseHref(`e:${draft.result.targetExerciseId}`, returnTo)} className={progressButton}>View exercise</Link>}<Link href={returnTo} className={progressButton}>Back to records</Link><button type="button" className={progressButton} disabled={busy || !!draft.undoKey} onClick={() => { store(null); setPage(initialPage); setCursors([initialCursor]); setPageIndex(0); }}>Choose more records</button></div></section>
      : preview ? <section className="card p-4"><h2 className="display text-2xl">Review selected workouts</h2><p className="mt-3 text-base">{mode === "detach" ? "Keep separate" : "Connect"} {preview.observationCount} recorded {preview.observationCount === 1 ? "exercise" : "exercises"} from {preview.sessionCount} {preview.sessionCount === 1 ? "workout" : "workouts"}{mode === "link" ? ` as ${preview.targetName}` : ""}.</p><p className="mt-2 text-sm leading-6 text-muted">{preview.explanation}</p><p className="mt-2 text-sm text-muted">Only the records listed below change grouping. Records currently included elsewhere move out of that grouping.</p><ol className="mt-4 divide-y divide-line">{preview.observations.slice(reviewPage * 20, (reviewPage + 1) * 20).map(item => <li key={item.id} className="py-3"><p className="break-words font-semibold">{item.recordedName}</p><p className="mt-1 text-sm text-muted"><ProgressDate date={item.date} /> · {item.workoutName}</p><p className="mt-1 text-sm text-muted">Currently included as {item.exerciseName}</p></li>)}</ol>{preview.observations.length > 20 && <div className="flex flex-wrap gap-2"><button type="button" className={progressButton} disabled={!reviewPage} onClick={() => setReviewPage(reviewPage - 1)}>Previous selected records</button><button type="button" className={progressButton} disabled={(reviewPage + 1) * 20 >= preview.observations.length} onClick={() => setReviewPage(reviewPage + 1)}>Next selected records</button></div>}<div className="mt-4 flex flex-wrap gap-2"><button type="button" className={progressButton} disabled={busy} onClick={apply}>{draft.requestKey ? "Retry saving grouping" : mode === "detach" ? "Keep selected records separate" : "Connect selected workouts"}</button><button type="button" className={progressButton} disabled={locked} onClick={() => store({ ...draft, preview: undefined, input: undefined })}>Edit selection</button></div>{draft.requestKey && <p role="status" className="mt-3 text-sm text-muted">The save has not been confirmed. Retry the same selection before making another change.</p>}</section>
      : <><CandidateFilters disabled={locked} initialUrl={candidatesUrl} onApply={url => void loadPage("", false, url)} /><label className="font-semibold">Exercise label<input className={`${progressInput} mt-2`} value={draft.name} disabled={locked || !!targetExerciseId || mode === "detach"} onChange={event => store({ ...draft, name: event.target.value })} /></label><section className="card p-4"><h2 className="display text-2xl">Choose past workouts</h2><p role="status" className="mt-2 text-sm text-muted">{draft.selected.length} {draft.selected.length === 1 ? "record" : "records"} selected</p><button type="button" className={`${progressButton} mt-3`} disabled={locked || !page.items.length} onClick={() => store({ ...draft, selected: [...draft.selected, ...page.items.filter(item => !draft.selected.some(selected => selected.id === item.id))] })}>Select these {page.items.length} records</button><ul className="mt-3 divide-y divide-line">{page.items.map(candidate => <li key={candidate.id}><label className="touch-target flex cursor-pointer items-start gap-3 py-4"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-brand" checked={draft.selected.some(item => item.id === candidate.id)} disabled={locked} onChange={event => select(candidate, event.target.checked)} /><span className="min-w-0"><span className="block break-words font-semibold">{candidate.recordedName}</span><span className="mt-1 block text-sm text-muted"><ProgressDate date={candidate.date} /> · {candidate.workoutName} · {candidate.programName}</span><span className="mt-1 block text-sm">{actualResult(candidate.latest)}</span><span className="mt-1 block text-sm text-muted">Currently included as {candidate.exerciseName}</span></span></label></li>)}</ul>{!page.items.length && <p className="my-3 text-muted">No records on this page.</p>}<div className="mt-3 flex flex-wrap justify-between gap-2">{pageIndex > 0 && <button type="button" className={progressButton} disabled={locked} onClick={() => loadPage(cursors[pageIndex - 1], true)}>Previous records</button>}{page.nextCursor && <button type="button" className={progressButton} disabled={locked} onClick={() => loadPage(page.nextCursor!)}>Next records</button>}</div></section><button type="button" className={`${progressButton} self-start`} disabled={locked || !draft.selected.length || (mode === "link" && !draft.name.trim())} onClick={review}>Review selected workouts</button></>}
    {error && <p ref={errorRef} role="alert" className="rounded-xl border border-danger-line bg-danger-soft p-3 text-sm text-danger-ink">{error}</p>}
  </div>;
}
