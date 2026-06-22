"use client";

import Link from "next/link";
import { Check, LineChart, Zap } from "lucide-react";
import { useState } from "react";
import { AddSessionExerciseForm } from "@/components/AddSessionExerciseForm";
import { buildGroups, readResponseJson, type WorkoutSet } from "@/components/workout-card-utils";

type QuickSession = { id: number; sets: WorkoutSet[] };

type Recap = {
  volume: number;
  loggedCount: number;
  skippedCount: number;
};

/** Inline "Quick Workout" card for the Today tab: start a program-less session,
 *  add exercises on the fly, log each set, and finish. Reuses the program-agnostic
 *  session routes (POST /api/sessions, POST/PUT .../sets, PATCH/DELETE the session). */
export function QuickWorkout({ initialSession }: { initialSession: QuickSession | null }) {
  const [session, setSession] = useState<QuickSession | null>(initialSession);
  const [reps, setReps] = useState<Record<number, string>>(() => seedReps(initialSession));
  const [weights, setWeights] = useState<Record<number, string>>(() => seedWeights(initialSession));
  const [loggedIds, setLoggedIds] = useState<Set<number>>(() => seedLogged(initialSession));
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  async function start() {
    setStarting(true);
    setError("");
    try {
      const response = await fetch("/api/sessions", { method: "POST" });
      const body = await readResponseJson<QuickSession & { error?: string }>(response);
      if (!response.ok || !body?.id) throw new Error(body?.error ?? "Could not start workout");
      setSession({ id: body.id, sets: body.sets ?? [] });
      setReps(seedReps(body));
      setWeights(seedWeights(body));
      setLoggedIds(seedLogged(body));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start workout");
    } finally {
      setStarting(false);
    }
  }

  function onAdded(newSets: WorkoutSet[]) {
    setError("");
    setSession((prev) => (prev ? { ...prev, sets: [...prev.sets, ...newSets] } : prev));
    setReps((prev) => ({ ...prev, ...Object.fromEntries(newSets.map((s) => [s.id, String(s.reps)])) }));
    setWeights((prev) => ({
      ...prev,
      ...Object.fromEntries(newSets.map((s) => [s.id, String(s.calculated_weight ?? 0)])),
    }));
  }

  async function logSet(set: WorkoutSet) {
    if (!session) return;
    setSavingId(set.id);
    setError("");
    try {
      const response = await fetch(`/api/sessions/${session.id}/sets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setId: set.id,
          actualReps: Number(reps[set.id]) || 0,
          actualWeight: weights[set.id] === "" ? 0 : Number(weights[set.id]) || 0,
        }),
      });
      if (!response.ok) {
        const body = await readResponseJson<{ error?: string }>(response);
        throw new Error(body?.error ?? "Could not log set");
      }
      setLoggedIds((prev) => new Set(prev).add(set.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log set");
    } finally {
      setSavingId(null);
    }
  }

  async function finish() {
    if (!session) return;
    setFinishing(true);
    setError("");
    try {
      const response = await fetch(`/api/sessions/${session.id}`, { method: "PATCH" });
      const body = await readResponseJson<Recap & { error?: string }>(response);
      if (!response.ok) throw new Error(body?.error ?? "Could not finish workout");
      setRecap({ volume: body?.volume ?? 0, loggedCount: body?.loggedCount ?? 0, skippedCount: body?.skippedCount ?? 0 });
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
    setSession(null);
    setReps({});
    setWeights({});
    setLoggedIds(new Set());
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
          {recap.volume > 0 ? ` · ${new Intl.NumberFormat("en-US").format(Math.round(recap.volume))} lb total` : ""}.
        </p>
        <div className="mt-4 flex justify-center gap-2">
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
        <button
          type="button"
          onClick={start}
          disabled={starting}
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
  const groups = buildGroups(session.sets);

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <p className="eyebrow text-[11px] text-brand-strong">Quick workout</p>
        <h2 className="display text-2xl">Today</h2>
      </div>

      {groups.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">Add your first exercise to start logging.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {groups.map((group) => (
            <li key={group.sets[0].id} className="px-4 py-3">
              <p className="font-semibold text-foreground">{group.sets[0].exercise_name}</p>
              <div className="mt-2 flex flex-col gap-2">
                {group.sets.map((set, i) => {
                  const logged = loggedIds.has(set.id);
                  return (
                    <div key={set.id} className="flex items-center gap-2">
                      <span className="w-10 shrink-0 text-xs font-semibold text-faint">Set {i + 1}</span>
                      <label className="sr-only" htmlFor={`reps-${set.id}`}>
                        Reps for set {i + 1}
                      </label>
                      <input
                        id={`reps-${set.id}`}
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={reps[set.id] ?? ""}
                        onChange={(e) => setReps((p) => ({ ...p, [set.id]: e.target.value }))}
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
                        value={weights[set.id] ?? ""}
                        onChange={(e) => setWeights((p) => ({ ...p, [set.id]: e.target.value }))}
                        className="touch-target w-20 rounded-xl border border-line bg-surface px-2 text-center font-display text-lg outline-none focus:border-brand"
                      />
                      <span className="text-xs text-faint">lb</span>
                      <button
                        type="button"
                        onClick={() => logSet(set)}
                        disabled={savingId === set.id}
                        aria-label={logged ? `Set ${i + 1} logged, tap to update` : `Log set ${i + 1}`}
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
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}

      <AddSessionExerciseForm sessionId={session.id} onAdded={onAdded} onError={setError} />

      {error ? <p className="px-4 pb-1 text-sm text-danger-ink">{error}</p> : null}

      <div className="flex gap-2 px-4 pb-4 pt-2">
        <button
          type="button"
          onClick={finish}
          disabled={finishing || groups.length === 0}
          className="touch-target flex-1 rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-opacity active:opacity-90 disabled:opacity-50"
        >
          {finishing ? "Finishing…" : "Finish workout"}
        </button>
        {confirmingDiscard ? (
          <button
            type="button"
            onClick={discard}
            disabled={discarding}
            className="touch-target rounded-xl bg-danger-ink px-4 py-2.5 text-sm font-semibold text-background transition-opacity active:opacity-90 disabled:opacity-50"
          >
            {discarding ? "Discarding…" : "Confirm discard"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDiscard(true)}
            className="touch-target rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-danger-ink transition-colors active:bg-danger-soft"
          >
            Discard
          </button>
        )}
      </div>
    </section>
  );
}

function seedReps(session: QuickSession | null): Record<number, string> {
  if (!session) return {};
  return Object.fromEntries(session.sets.map((s) => [s.id, String(s.actual_reps ?? s.reps)]));
}

function seedWeights(session: QuickSession | null): Record<number, string> {
  if (!session) return {};
  return Object.fromEntries(session.sets.map((s) => [s.id, String(s.actual_weight ?? s.calculated_weight ?? 0)]));
}

function seedLogged(session: QuickSession | null): Set<number> {
  if (!session) return new Set();
  return new Set(session.sets.filter((s) => s.actual_reps != null).map((s) => s.id));
}
