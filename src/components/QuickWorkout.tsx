"use client";

import Link from "next/link";
import { LineChart, Zap } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { ExerciseLogCard, SetLogRow } from "./ExerciseLogCard";
import { QuickExercisePicker } from "./QuickExercisePicker";
import { QuickWorkoutEditor } from "./QuickWorkoutEditor";
import { buildQuickGroups, useWorkoutDraft, workoutInput, workoutRequest } from "./quick-workout-utils";
import { readResponseJson, type WorkoutSet } from "@/components/workout-card-utils";

export type QuickSession = { id: number; sets: WorkoutSet[]; name?: string; date?: string; unit?: "lb" | "kg"; revision?: number };

const subscribeHydration = () => () => {};

type Recap = {
  volume: number;
  loggedCount: number;
  skippedCount: number;
};

/** Inline "Quick Workout" card for the Today tab: start a program-less session,
 *  add exercises on the fly, log each set, and finish. Reuses the program-agnostic
 *  session routes (POST /api/sessions, POST/PUT .../sets, PATCH/DELETE the session). */
export function QuickWorkout({ initialSession, initialDate, todayOnly = false }: { initialSession: QuickSession | null; initialDate?: string; todayOnly?: boolean }) {
  // The HTML preview must not accept edits before draft change handlers are attached.
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const [startDraft, storeStart] = useWorkoutDraft<{ name: string; date: string; unit: "lb" | "kg"; requestKey?: string }>(`magni.quick.start.${initialDate ?? "today"}`, { name: "Quick Workout", date: initialDate ?? "", unit: "lb" });
  const [session, setSession] = useState<QuickSession | null>(initialSession);
  const draftSnapshot = useSyncExternalStore(subscribeDrafts, () => readDraftSnapshot(session?.id), () => null);
  const drafts = useMemo(() => parseDrafts(draftSnapshot), [draftSnapshot]);
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [conflicts, setConflicts] = useState<Record<number, WorkoutSet>>({});
  const [newExerciseDraft] = useWorkoutDraft<unknown>(`magni.quick.${session?.id}.new-exercise`, null);
  const [appendDraft] = useWorkoutDraft<unknown>(`magni.quick.${session?.id}.append`, null);
  const [structureDraft] = useWorkoutDraft<unknown>(`magni.quick.${session?.id}.structure`, null);
  const [failedIds, setFailedIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const startLocked = !hydrated || starting || !!startDraft.requestKey;

  function editStart(change: Partial<Pick<typeof startDraft, "name" | "date" | "unit">>) {
    if (!startLocked) storeStart({ ...startDraft, ...change });
  }

  async function start() {
    if (!hydrated || starting) return;
    setStarting(true);
    setError("");
    try {
      const requestKey = startDraft.requestKey ?? crypto.randomUUID();
      storeStart({ ...startDraft, requestKey });
      const response = await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestKey, ...(initialDate ? { date: startDraft.date, name: startDraft.name, unit: startDraft.unit, newWorkout: true } : {}) }) });
      const body = await readResponseJson<QuickSession & { error?: string; currentDate?: string }>(response);
      if (!response.ok || !body?.id) {
        // This API's structured 400 errors precede writes or roll back the whole
        // create transaction. Unconfirmed outcomes must retain the original intent.
        if (response.status === 400 && typeof body?.error === "string") storeStart({ ...startDraft, requestKey: undefined });
        throw new Error(body?.error ?? "Could not start workout");
      }
      // Confirm the old idempotent intent before clearing it. Its session remains
      // available on its saved date; retrying it must not take over Today.
      if (todayOnly && (!body.date || !body.currentDate)) throw new Error("Could not confirm the workout date. Retry starting.");
      if (todayOnly && body.date !== body.currentDate) {
        storeStart(null);
        setError("Your earlier workout is saved in Calendar. Tap Quick workout to start today.");
        return;
      }
      setSession({ ...body, sets: body.sets ?? [] });
      if (initialDate) window.history.replaceState(null, "", `/workouts/${body.id}`);
      storeStart(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start workout");
    } finally {
      setStarting(false);
    }
  }

  function onAdded(newSets: WorkoutSet[], revision?: number) {
    setError("");
    setSession((prev) => (prev ? { ...prev, revision: revision ?? prev.revision, sets: [...prev.sets, ...newSets.filter((set) => !prev.sets.some((existing) => existing.id === set.id))] } : prev));
  }

  function inputValues(set: WorkoutSet): SetDraft {
    const draft = drafts[set.id];
    // Retained inputs belong only to the acknowledged unlogged state. A newer
    // server log must display its own actuals and supply the next write baseline.
    return draft && !(draft.intent === "retained" && set.actual_reps != null) ? draft : valuesForSet(set);
  }

  function editSet(set: WorkoutSet, field: keyof SetDraft, value: string) {
    if (!hydrated || !session) return;
    const current = parseDrafts(readDraftSnapshot(session.id));
    const prior = current[set.id]?.intent === "retained" && set.actual_reps != null ? undefined : current[set.id];
    const next = { ...(prior ?? valuesForSet(set)), [field]: value, intent: prior?.intent === "undo" ? "undo" as const : undefined };
    if (!writeDrafts(session.id, { ...current, [set.id]: next })) {
      setError("Device storage is unavailable. Keep this page open and save your changes before leaving.");
    }
    setFailedIds((previous) => withoutId(previous, set.id));
  }

  async function logSet(set: WorkoutSet, undo = false) {
    if (!hydrated || !session || structureDraft || savingIds.has(set.id)) return;
    const entered = inputValues(set);
    const submitted: SetDraft = { ...entered, base: entered.base ?? { reps: set.actual_reps, weight: set.actual_weight }, intent: undo ? "undo" : undefined };
    const actualReps = undo ? null : Number(submitted.reps);
    const actualWeight = undo ? null : Number(submitted.weight);
    if (!undo && (submitted.reps.trim() === "" || !Number.isSafeInteger(actualReps) || actualReps! < 0)) {
      setError("Enter whole reps of zero or more before saving this set.");
      return;
    }
    if (!undo && (submitted.weight.trim() === "" || !Number.isFinite(actualWeight) || actualWeight! < 0)) {
      setError("Enter a weight of zero or more before saving this set.");
      return;
    }
    // Persist even a default-value log before sending it, so a failed request is recoverable.
    writeDrafts(session.id, { ...parseDrafts(readDraftSnapshot(session.id)), [set.id]: submitted });
    setSavingIds((previous) => new Set(previous).add(set.id));
    setFailedIds((previous) => withoutId(previous, set.id));
    setError("");
    try {
      const response = await fetch(`/api/sessions/${session.id}/sets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setId: set.id,
          actualReps,
          actualWeight,
          expectedActual: submitted.base,
        }),
      });
      const acknowledged = await readResponseJson<{ error?: string; actual_reps?: number | null; actual_weight?: number | null; sessionRevision?: number; sessionMetadata?: Pick<QuickSession, "name" | "date" | "unit" | "revision"> }>(response);
      if (!response.ok || !acknowledged || acknowledged.actual_reps !== actualReps || acknowledged.actual_weight !== actualWeight) {
        if (response.status === 409) {
          const latest = await workoutRequest<QuickSession>(`/api/sessions/${session.id}`, "GET");
          const current = latest.sets.find((row) => row.id === set.id);
          if (current) setConflicts((previous) => ({ ...previous, [set.id]: current }));
        }
        throw new Error(acknowledged?.error ?? (undo ? "Could not confirm Undo. Retry undo before finishing." : "Could not confirm the saved set. Retry saving."));
      }
      setSession((previous) => previous?.id === session.id ? {
        ...previous,
        ...acknowledged.sessionMetadata,
        revision: acknowledged.sessionRevision ?? previous.revision,
        sets: previous.sets.map((row) => row.id === set.id ? { ...row, actual_reps: actualReps, actual_weight: actualWeight } : row),
      } : previous);
      const pending = parseDrafts(readDraftSnapshot(session.id));
      // A response acknowledges only the submitted values, never edits made while it was in flight.
      if (pending[set.id]?.reps === submitted.reps && pending[set.id]?.weight === submitted.weight) {
        if (undo) pending[set.id] = { ...pending[set.id], base: { reps: null, weight: null }, intent: "retained" };
        else delete pending[set.id];
      } else if (pending[set.id]) {
        pending[set.id] = { ...pending[set.id], base: { reps: actualReps, weight: actualWeight }, intent: undefined };
      }
      writeDrafts(session.id, pending);
    } catch (err) {
      setFailedIds((previous) => new Set(previous).add(set.id));
      setError(err instanceof Error ? err.message : "Could not log set");
    } finally {
      setSavingIds((previous) => withoutId(previous, set.id));
    }
  }

  async function finish() {
    if (!hydrated || !session || structureDraft || newExerciseDraft || appendDraft || savingIds.size > 0 || session.sets.some((set) => isPending(drafts[set.id]))) return;
    setFinishing(true);
    setError("");
    try {
      const response = await fetch(`/api/sessions/${session.id}`, { method: "PATCH" });
      const body = await readResponseJson<Recap & { error?: string }>(response);
      if (!response.ok) throw new Error(body?.error ?? "Could not finish workout");
      if (!body || !Number.isFinite(body.volume) || !Number.isInteger(body.loggedCount) || !Number.isInteger(body.skippedCount)) {
        throw new Error("Could not confirm workout completion. Retry finishing.");
      }
      writeDrafts(session.id, {});
      setRecap({ volume: body.volume, loggedCount: body.loggedCount, skippedCount: body.skippedCount });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish workout");
    } finally {
      setFinishing(false);
    }
  }

  async function discard() {
    if (!hydrated || !session) return;
    setDiscarding(true);
    setError("");
    try {
      const response = await fetch(`/api/sessions/${session.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await readResponseJson<{ error?: string }>(response);
        throw new Error(body?.error ?? "Could not discard workout");
      }
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not discard workout");
    } finally {
      setDiscarding(false);
    }
  }

  function reset() {
    if (session) writeDrafts(session.id, {});
    setSession(null);
    setSavingIds(new Set());
    setFailedIds(new Set());
    setConfirmingDiscard(false);
    setRecap(null);
  }

  // --- Finished state -------------------------------------------------------
  if (recap) {
    return (
      <section className="card px-4 py-6 text-center">
        <p className="display text-xl text-success-ink">Quick workout complete</p>
        <p className="mt-1 text-sm text-muted">
          {recap.loggedCount} {recap.loggedCount === 1 ? "lift" : "lifts"} logged
          {recap.volume > 0 ? ` · ${new Intl.NumberFormat("en-US").format(Math.round(recap.volume))} ${session?.unit ?? "lb"} total` : ""}.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link href={`/workouts/${session?.id}`} className="touch-target inline-flex items-center rounded-xl border border-line px-4 text-sm font-semibold">View workout</Link>
          <Link
            href="/history"
            className="touch-target inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-foreground transition-colors active:bg-surface-muted"
          >
            <LineChart aria-hidden="true" size={16} />
            Stats
          </Link>
          <button
            type="button"
            onClick={reset}
            className="touch-target inline-flex items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-muted transition-colors active:bg-surface-muted"
          >
            <Zap aria-hidden="true" size={16} />
            New
          </button>
        </div>
      </section>
    );
  }

  // --- Collapsed (not started) ---------------------------------------------
  if (!session) {
    return (
      <div>
        {initialDate && <div className="mb-3 grid gap-3">
          <label className="text-xs text-muted">Workout name<input aria-label="Workout name" disabled={startLocked} value={startDraft.name} className={`${workoutInput} mt-1 w-full`} onChange={(e) => editStart({ name: e.target.value })} /></label>
          <label className="text-xs text-muted">Workout date<input aria-label="Workout date" disabled={startLocked} type="date" value={startDraft.date} className={`${workoutInput} mt-1 w-full`} onChange={(e) => editStart({ date: e.target.value })} /></label>
          <label className="text-xs text-muted">Units<select aria-label="Workout units" disabled={startLocked} value={startDraft.unit} className={`${workoutInput} mt-1 w-full`} onChange={(e) => editStart({ unit: e.target.value as "lb" | "kg" })}><option value="lb">Pounds (lb)</option><option value="kg">Kilograms (kg)</option></select></label>
        </div>}
        <button
          type="button"
          onClick={start}
          disabled={!hydrated || starting}
          className="touch-target flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-3 text-sm font-semibold text-muted transition-colors active:bg-surface-muted disabled:opacity-50"
        >
          <Zap aria-hidden="true" size={16} />
          {starting ? "Starting…" : startDraft.requestKey ? "Retry starting workout" : "Quick workout"}
        </button>
        {startDraft.requestKey && !starting ? <p role="status" className="mt-2 text-sm text-muted">Workout creation is unconfirmed. Retry to recover it before changing these details.</p> : null}
        {error ? <p className="mt-2 text-center text-sm text-danger-ink">{error}</p> : null}
      </div>
    );
  }

  // --- Active logging surface ----------------------------------------------
  const groups = buildQuickGroups(session.sets);
  const hasPendingChanges = session.sets.some((set) => isPending(drafts[set.id]));

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <p className="eyebrow text-[11px] text-brand-strong">Quick workout</p>
        <h2 className="display text-2xl">{session.name ?? "Today"}</h2>
        {session.date && <p className="mt-1 text-sm text-muted">{session.date} · {session.unit ?? "lb"}</p>}
      </div>

      <QuickWorkoutEditor session={session} disabled={!hydrated || hasPendingChanges || savingIds.size > 0 || finishing || discarding} onChanged={setSession} onError={setError} />

      {groups.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">Add your first exercise to start logging.</p>
      ) : (
        <div>
          {groups.map(group => {
            const rows = group.sets;
            const saved = rows.filter(set => set.actual_reps != null && !isPending(drafts[set.id]) && !savingIds.has(set.id)).reduce((sum, set) => sum + Math.max(1, set.sets), 0);
            const status = rows.some(set => conflicts[set.id]) ? "Resolve conflicting changes" : rows.some(set => savingIds.has(set.id)) ? "Saving…" : rows.some(set => drafts[set.id]?.intent === "undo") ? "Undo unconfirmed" : rows.some(set => failedIds.has(set.id)) ? "Save failed" : rows.some(set => isPending(drafts[set.id])) ? "Unsaved changes" : undefined;
            return <ExerciseLogCard disabled={!hydrated} key={rows[0].id} name={rows[0].exercise_name} saved={saved} total={rows.reduce((sum, set) => sum + Math.max(1, set.sets), 0)} status={status}>
              {rows.map((set, i) => {
                const draft = drafts[set.id];
                const pending = isPending(draft);
                const values = inputValues(set);
                const saving = savingIds.has(set.id);
                const logged = set.actual_reps != null;
                const saved = logged && !pending && !saving;
                return <SetLogRow key={set.id} number={i + 1} count={set.sets} reps={values.reps} weight={values.weight} unit={session.unit ?? "lb"}
                  repsLabel={`Reps for set ${i + 1}`} weightLabel={`Weight for set ${i + 1}`} saved={saved} logged={logged} pending={pending} saving={saving}
                  failed={failedIds.has(set.id)} missingWeight={set.actual_reps != null && set.actual_weight == null} undoPending={draft?.intent === "undo"} disabled={!hydrated || finishing || discarding || !!structureDraft}
                  saveDisabled={!!conflicts[set.id]} saveLabel={saving ? `Saving set ${i + 1}` : saved ? `Set ${i + 1} saved` : pending ? `Save set ${i + 1}` : `Log set ${i + 1}`}
                  onChange={(field, value) => editSet(set, field, value)} onSave={() => { void logSet(set); }} onUndo={() => { void logSet(set, true); }}>
                  {conflicts[set.id] && <div className="mt-2 rounded-xl border border-warn-line bg-warn-soft p-3"><p className="text-sm text-warn-ink">Saved elsewhere: {conflicts[set.id].actual_reps ?? "unlogged"} reps at {conflicts[set.id].actual_weight ?? 0} {session.unit ?? "lb"}. Your values are still above.</p><div className="mt-2 flex flex-wrap gap-2">{[false, true].map(keep => <button type="button" key={String(keep)} className="touch-target rounded-xl border border-line bg-surface px-3 text-sm font-semibold" onClick={() => {
                    const current = conflicts[set.id];
                    setSession(previous => previous ? { ...previous, sets: previous.sets.map(row => row.id === set.id ? current : row) } : previous);
                    const pending = parseDrafts(readDraftSnapshot(session.id));
                    if (keep && pending[set.id]) pending[set.id].base = { reps: current.actual_reps, weight: current.actual_weight }; else delete pending[set.id];
                    writeDrafts(session.id, pending); setConflicts(previous => { const next = { ...previous }; delete next[set.id]; return next; }); setFailedIds(previous => withoutId(previous, set.id)); setError("");
                  }}>{keep ? "Keep my edits" : "Use saved values"}</button>)}</div></div>}
                </SetLogRow>;
              })}
            </ExerciseLogCard>;
          })}
        </div>
      )}

      <QuickExercisePicker sessionId={session.id} unit={session.unit ?? "lb"} onAdded={onAdded} onError={setError} disabled={!hydrated || finishing || discarding || !!structureDraft} />

      {error ? <p role="alert" className="px-4 pb-1 text-sm text-danger-ink">{error}</p> : null}
      {newExerciseDraft || appendDraft ? <p className="px-4 pb-1 text-sm text-muted">Finish adding the pending exercise or set before completing this workout.</p> : null}
      {structureDraft ? <p className="px-4 pb-1 text-sm text-muted">Save workout details before finishing or adding exercises.</p> : null}
      {hasPendingChanges ? <p className="px-4 pb-1 text-sm text-muted">Save your changed sets before finishing.</p> : null}

      <div className="flex flex-wrap gap-2 px-4 pb-4 pt-2">
        <button
          type="button"
          onClick={finish}
          disabled={!hydrated || finishing || discarding || groups.length === 0 || hasPendingChanges || !!structureDraft || !!newExerciseDraft || !!appendDraft || savingIds.size > 0}
          className="touch-target flex-[1_1_12rem] whitespace-normal break-words rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-opacity active:opacity-90 disabled:opacity-50"
        >
          {finishing ? "Finishing…" : "Finish workout"}
        </button>
        {confirmingDiscard ? (
          <button
            type="button"
            onClick={discard}
            disabled={!hydrated || discarding || finishing || savingIds.size > 0}
            className="touch-target rounded-xl bg-danger-ink px-4 py-2.5 text-sm font-semibold text-background transition-opacity active:opacity-90 disabled:opacity-50"
          >
            {discarding ? "Discarding…" : "Confirm discard"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDiscard(true)}
            disabled={!hydrated || finishing || savingIds.size > 0}
            className="touch-target rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-danger-ink transition-colors active:bg-danger-soft"
          >
            Discard
          </button>
        )}
      </div>
    </section>
  );
}

type SetDraft = { reps: string; weight: string; base?: { reps: number | null; weight: number | null }; intent?: "undo" | "retained" };
function isPending(draft?: SetDraft): boolean { return !!draft && draft.intent !== "retained"; }
type SetDrafts = Record<number, SetDraft>;
const draftEvent = "magni-quick-draft-changed";
const volatileDrafts = new Map<number, string>();

function withoutId(ids: Set<number>, id: number): Set<number> {
  const next = new Set(ids);
  next.delete(id);
  return next;
}

function valuesForSet(set: WorkoutSet): SetDraft {
  return {
    base: { reps: set.actual_reps, weight: set.actual_weight },
    reps: String(set.actual_reps ?? set.reps),
    weight: set.actual_reps != null ? (set.actual_weight == null ? "" : String(set.actual_weight)) : String(set.calculated_weight ?? 0),
  };
}

function readDraftSnapshot(sessionId?: number): string | null {
  if (!sessionId || typeof window === "undefined") return null;
  if (volatileDrafts.has(sessionId)) return volatileDrafts.get(sessionId)!;
  try { return localStorage.getItem(`magni.quick-workout.${sessionId}.draft.v1`); } catch { return null; }
}

function parseDrafts(snapshot: string | null): SetDrafts {
  if (!snapshot) return {};
  try {
    const parsed = JSON.parse(snapshot);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([id, value]) =>
      /^\d+$/.test(id) && value && typeof value === "object" && "reps" in value && "weight" in value &&
      typeof value.reps === "string" && typeof value.weight === "string",
    )) as SetDrafts;
  } catch { return {}; }
}

function writeDrafts(sessionId: number, drafts: SetDrafts): boolean {
  const snapshot = JSON.stringify(drafts);
  let persisted = true;
  try {
    const key = `magni.quick-workout.${sessionId}.draft.v1`;
    if (Object.keys(drafts).length > 0) localStorage.setItem(key, snapshot);
    else localStorage.removeItem(key);
    volatileDrafts.delete(sessionId);
  } catch {
    volatileDrafts.set(sessionId, snapshot);
    persisted = false;
  }
  window.dispatchEvent(new Event(draftEvent));
  return persisted;
}

function subscribeDrafts(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  window.addEventListener(draftEvent, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(draftEvent, listener);
  };
}
