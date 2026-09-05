"use client";

import Link from "next/link";
import { Check, LineChart, Zap } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
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
export function QuickWorkout({ initialSession, initialDate }: { initialSession: QuickSession | null; initialDate?: string }) {
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

  async function start() {
    if (!hydrated || starting) return;
    setStarting(true);
    setError("");
    try {
      const requestKey = startDraft.requestKey ?? crypto.randomUUID();
      storeStart({ ...startDraft, requestKey });
      const response = await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestKey, ...(initialDate ? { date: startDraft.date, name: startDraft.name, unit: startDraft.unit, newWorkout: true } : {}) }) });
      const body = await readResponseJson<QuickSession & { error?: string }>(response);
      if (!response.ok || !body?.id) throw new Error(body?.error ?? "Could not start workout");
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

  function editSet(set: WorkoutSet, field: keyof SetDraft, value: string) {
    if (!session) return;
    const current = parseDrafts(readDraftSnapshot(session.id));
    const next = { ...(current[set.id] ?? valuesForSet(set)), [field]: value };
    if (!writeDrafts(session.id, { ...current, [set.id]: next })) {
      setError("Device storage is unavailable. Keep this page open and save your changes before leaving.");
    }
    setFailedIds((previous) => withoutId(previous, set.id));
  }

  async function logSet(set: WorkoutSet) {
    if (!session || structureDraft || savingIds.has(set.id)) return;
    const submitted = drafts[set.id] ?? valuesForSet(set);
    const actualReps = Number(submitted.reps);
    const actualWeight = Number(submitted.weight);
    if (submitted.reps.trim() === "" || !Number.isInteger(actualReps) || actualReps < 0) {
      setError("Enter whole reps of zero or more before saving this set.");
      return;
    }
    if (submitted.weight.trim() === "" || !Number.isFinite(actualWeight) || actualWeight < 0) {
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
      const acknowledged = await readResponseJson<{ error?: string; actual_reps?: number; actual_weight?: number; sessionRevision?: number; sessionMetadata?: Pick<QuickSession, "name" | "date" | "unit" | "revision"> }>(response);
      if (!response.ok || !acknowledged || acknowledged.actual_reps !== actualReps || acknowledged.actual_weight !== actualWeight) {
        if (response.status === 409) {
          const latest = await workoutRequest<QuickSession>(`/api/sessions/${session.id}`, "GET");
          const current = latest.sets.find((row) => row.id === set.id);
          if (current) setConflicts((previous) => ({ ...previous, [set.id]: current }));
        }
        throw new Error(acknowledged?.error ?? "Could not confirm the saved set. Retry saving.");
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
        delete pending[set.id];
      } else if (pending[set.id]) {
        pending[set.id].base = { reps: actualReps, weight: actualWeight };
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
    if (!session || structureDraft || newExerciseDraft || appendDraft || savingIds.size > 0 || session.sets.some((set) => drafts[set.id])) return;
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
    if (!session) return;
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
          <label className="text-xs text-muted">Workout name<input aria-label="Workout name" disabled={!hydrated} value={startDraft.name} className={`${workoutInput} mt-1 w-full`} onChange={(e) => storeStart({ ...startDraft, name: e.target.value })} /></label>
          <label className="text-xs text-muted">Workout date<input aria-label="Workout date" disabled={!hydrated} type="date" value={startDraft.date} className={`${workoutInput} mt-1 w-full`} onChange={(e) => storeStart({ ...startDraft, date: e.target.value })} /></label>
          <label className="text-xs text-muted">Units<select aria-label="Workout units" disabled={!hydrated} value={startDraft.unit} className={`${workoutInput} mt-1 w-full`} onChange={(e) => storeStart({ ...startDraft, unit: e.target.value as "lb" | "kg" })}><option value="lb">Pounds (lb)</option><option value="kg">Kilograms (kg)</option></select></label>
        </div>}
        <button
          type="button"
          onClick={start}
          disabled={!hydrated || starting}
          className="touch-target flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-3 text-sm font-semibold text-muted transition-colors active:bg-surface-muted disabled:opacity-50"
        >
          <Zap aria-hidden="true" size={16} />
          {starting ? "Starting…" : "Quick workout"}
        </button>
        {error ? <p className="mt-2 text-center text-sm text-danger-ink">{error}</p> : null}
      </div>
    );
  }

  // --- Active logging surface ----------------------------------------------
  const groups = buildQuickGroups(session.sets);
  const hasPendingChanges = session.sets.some((set) => drafts[set.id]);

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <p className="eyebrow text-[11px] text-brand-strong">Quick workout</p>
        <h2 className="display text-2xl">{session.name ?? "Today"}</h2>
        {session.date && <p className="mt-1 text-sm text-muted">{session.date} · {session.unit ?? "lb"}</p>}
      </div>

      <QuickWorkoutEditor session={session} disabled={hasPendingChanges || savingIds.size > 0 || finishing || discarding} onChanged={setSession} onError={setError} />

      {groups.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">Add your first exercise to start logging.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {groups.map((group) => (
            <li key={group.sets[0].id} className="px-4 py-3">
              <p className="font-semibold text-foreground">{group.sets[0].exercise_name}</p>
              <div className="mt-2 flex flex-col gap-2">
                {group.sets.map((set, i) => {
                  const pending = drafts[set.id];
                  const values = pending ?? valuesForSet(set);
                  const saving = savingIds.has(set.id);
                  const failed = failedIds.has(set.id);
                  const logged = set.actual_reps != null && !pending && !saving;
                  const status = saving ? "Saving…" : failed ? "Save failed" : pending ? "Unsaved" : logged ? "Saved" : "Not logged";
                  return (
                    <div key={set.id}>
                    <div className="flex items-center gap-2">
                      <span className="w-10 shrink-0 text-xs font-semibold text-faint">Set {i + 1}</span>
                      <label className="sr-only" htmlFor={`reps-${set.id}`}>
                        Reps for set {i + 1}
                      </label>
                      <input
                        id={`reps-${set.id}`}
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={values.reps}
                        disabled={finishing || discarding || !!structureDraft}
                        onChange={(e) => editSet(set, "reps", e.target.value)}
                        className="touch-target w-16 rounded-xl border border-line bg-surface px-2 text-center font-display text-lg outline-none focus:border-brand"
                      />
                      <span className="text-xs text-faint">reps</span>
                      <label className="sr-only" htmlFor={`weight-${set.id}`}>
                        Weight for set {i + 1}
                      </label>
                      <input
                        id={`weight-${set.id}`}
                        type="number"
                        min={0}
                        inputMode="decimal"
                        value={values.weight}
                        step="any"
                        disabled={finishing || discarding || !!structureDraft}
                        onChange={(e) => editSet(set, "weight", e.target.value)}
                        className="touch-target w-20 rounded-xl border border-line bg-surface px-2 text-center font-display text-lg outline-none focus:border-brand"
                      />
                      <span className="text-xs text-faint">{session.unit ?? "lb"}</span>
                      <button
                        type="button"
                        onClick={() => logSet(set)}
                        disabled={saving || finishing || discarding || !!structureDraft}
                        aria-label={saving ? `Saving set ${i + 1}` : logged ? `Set ${i + 1} saved, tap to update` : pending ? `Save set ${i + 1}` : `Log set ${i + 1}`}
                        aria-pressed={logged}
                        className={`touch-target ml-auto inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-50 ${
                          logged
                            ? "bg-success-soft text-success-ink active:bg-success-soft"
                            : "bg-brand text-white active:bg-brand-strong"
                        }`}
                      >
                        <Check aria-hidden="true" size={18} />
                      </button>
                    </div>
                    {conflicts[set.id] && <div className="mt-2 rounded-xl border border-line p-3"><p className="text-xs text-muted">Saved elsewhere: {conflicts[set.id].actual_reps ?? "unlogged"} reps at {conflicts[set.id].actual_weight ?? 0} {session.unit ?? "lb"}. Your values are still above.</p><div className="mt-2 flex flex-wrap gap-2">{[false, true].map((keep) => <button key={String(keep)} className="touch-target rounded-xl border border-line px-3 text-xs font-semibold" onClick={() => {
                      const current = conflicts[set.id];
                      setSession((previous) => previous ? { ...previous, sets: previous.sets.map((row) => row.id === set.id ? current : row) } : previous);
                      const pending = parseDrafts(readDraftSnapshot(session.id));
                      if (keep && pending[set.id]) pending[set.id].base = { reps: current.actual_reps, weight: current.actual_weight }; else delete pending[set.id];
                      writeDrafts(session.id, pending); setConflicts((previous) => { const next = { ...previous }; delete next[set.id]; return next; }); setFailedIds((previous) => withoutId(previous, set.id)); setError("");
                    }}>{keep ? "Keep my edits" : "Use saved values"}</button>)}</div></div>}
                    <p aria-live="polite" className={`mt-1 text-right text-xs ${failed ? "text-danger-ink" : logged ? "text-success-ink" : "text-muted"}`}>{status}</p>
                    </div>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}

      <QuickExercisePicker sessionId={session.id} unit={session.unit ?? "lb"} onAdded={onAdded} onError={setError} disabled={finishing || discarding || !!structureDraft} />

      {error ? <p role="alert" className="px-4 pb-1 text-sm text-danger-ink">{error}</p> : null}
      {newExerciseDraft || appendDraft ? <p className="px-4 pb-1 text-sm text-muted">Finish adding the pending exercise or set before completing this workout.</p> : null}
      {structureDraft ? <p className="px-4 pb-1 text-sm text-muted">Save workout details before finishing or adding exercises.</p> : null}
      {hasPendingChanges ? <p className="px-4 pb-1 text-sm text-muted">Save your changed sets before finishing.</p> : null}

      <div className="flex gap-2 px-4 pb-4 pt-2">
        <button
          type="button"
          onClick={finish}
          disabled={finishing || discarding || groups.length === 0 || hasPendingChanges || !!structureDraft || !!newExerciseDraft || !!appendDraft || savingIds.size > 0}
          className="touch-target flex-1 rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-opacity active:opacity-90 disabled:opacity-50"
        >
          {finishing ? "Finishing…" : "Finish workout"}
        </button>
        {confirmingDiscard ? (
          <button
            type="button"
            onClick={discard}
            disabled={discarding || finishing || savingIds.size > 0}
            className="touch-target rounded-xl bg-danger-ink px-4 py-2.5 text-sm font-semibold text-background transition-opacity active:opacity-90 disabled:opacity-50"
          >
            {discarding ? "Discarding…" : "Confirm discard"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDiscard(true)}
            disabled={finishing || savingIds.size > 0}
            className="touch-target rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-danger-ink transition-colors active:bg-danger-soft"
          >
            Discard
          </button>
        )}
      </div>
    </section>
  );
}

type SetDraft = { reps: string; weight: string; base?: { reps: number | null; weight: number | null } };
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
    weight: String(set.actual_reps != null ? set.actual_weight ?? 0 : set.calculated_weight ?? 0),
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
