"use client";

import { Check, Dumbbell, SkipForward, Trophy } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { ExerciseLogCard, SetLogRow } from "./ExerciseLogCard";
import { AddSessionExerciseForm } from "@/components/AddSessionExerciseForm";
import { ErrorBanner } from "@/components/ErrorBanner";
import { WorkoutTmEditor, type TmUpdatedSet } from "@/components/WorkoutTmEditor";
import { calculateWeight } from "@/lib/calculator";
import { currentTrainingHref, subscribeTrainingLocation, withWorkoutReturn } from "@/features/workouts/navigation";
import {
  buildGroups,
  buildSummaryRows,
  editorMetadata,
  setUnit,
  formatTonnage,
  groupExerciseNames,
  isBodyweight,
  isFlatSingle,
  readResponseJson,
  summaryDetail,
  type LastPerformance,
  type SessionResponse,
  type WorkoutGroup,
  type WorkoutSet,
} from "@/components/workout-card-utils";

import { isDraftVolatile, parseDrafts, readDraftSnapshot, subscribeDrafts, writeDrafts, type SetDraft, type ActualBaseline } from "@/components/planned-workout-drafts";

import styles from "./WorkoutCard.module.css";

function isPending(draft?: SetDraft): boolean { return !!draft && draft.intent !== "retained"; }

/** Compact "last time" line, e.g. "5/5/8 @ 225 lb" or "12/12/12 BW +25". */
function formatLastPerformance(last: LastPerformance): string {
  const scheme = last.reps.join("/");
  if (last.topWeight === null) return `${scheme} reps · load not recorded`;
  const missing = last.hasMissingWeight ? " · some load not recorded" : "";
  if (last.bodyweight) return `${scheme} BW${last.topWeight > 0 ? ` +${last.topWeight} ${last.unit ?? "lb"}` : ""}${missing}`;
  return `${scheme} @ ${last.topWeight} ${last.unit ?? "lb"}${missing}`;
}

export function WorkoutCard({
  occurrenceId,
  focusMode = false,
  resumeSessionId,
  programId,
  dayId,
  definitionDayId,
  programName,
  dayName,
  currentWeek,
  currentDay,
  startLabel = "Start Workout",
  scheduledDate,
  showSkip = true,
  nextLifts,
  scheduleLabel,
  statusLine,
  holdSlot,
  eyebrow,
  liftsLabel = "Today's lifts",
  rounding = 2.5,
}: {
  occurrenceId?: number;
  /** Compact primary logger used on Today. */
  focusMode?: boolean;
  /** Exact legacy session selected from History; resume never creates a substitute. */
  resumeSessionId?: number;
  programId: number;
  dayId: number;
  definitionDayId?: number;
  programName: string;
  dayName: string;
  currentWeek: number;
  currentDay: number;
  startLabel?: string;
  scheduledDate?: string;
  showSkip?: boolean;
  /** Next-lift preview shown in the idle (pre-start) state. */
  nextLifts?: { name: string; detail: string }[];
  scheduleLabel?: string;
  statusLine?: string;
  /** Pause-run control, rendered under More in the focused idle card. */
  holdSlot?: ReactNode;
  /** Small label above the program name (e.g. "Scheduled today"). */
  eyebrow?: string;
  /** Heading over the lift preview (default "Today's lifts"). */
  liftsLabel?: string;
  /** User's weight-rounding setting, for live TM-driven weight recompute. */
  rounding?: number;
}) {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [values, setValues] = useState<Record<number, number>>({});
  // Optional added weight per set for bodyweight exercises (keyed by set id).
  const [added, setAdded] = useState<Record<number, number>>({});
  // Editable working weight per set for superset / custom lifts (keyed by set id).
  // Main lifts edit weight via the training max instead, so they're excluded.
  const [weights, setWeights] = useState<Record<number, number>>({});
  const [completedSetIds, setCompletedSetIds] = useState<Set<number>>(new Set());
  // Lifts the user chose to skip this session, keyed by the group's leading set
  // id. Client-only: skipped lifts are simply left unlogged, so the recap marks
  // them skipped at finish. A full reload resets this (the lift returns as "to do").
  const [skippedGroupKeys, setSkippedGroupKeys] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [unavailableTemplate, setUnavailableTemplate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [failedIds, setFailedIds] = useState<Set<number>>(new Set());
  const [conflicts, setConflicts] = useState<Record<number, ActualBaseline>>({});
  const [storageWarning, setStorageWarning] = useState(false);
  const [progressionDecisions, setProgressionDecisions] = useState<{ progressionKey: string; exerciseName: string; result: { explanation: string } }[]>([]);
  const draftSnapshot = useSyncExternalStore(subscribeDrafts, () => readDraftSnapshot(session?.id), () => null);
  const drafts = useMemo(() => parseDrafts(draftSnapshot), [draftSnapshot]);
  const hasPending = session?.sets.some((set) => isPending(drafts[set.id])) ?? false;
  const [skipping, setSkipping] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [refreshingCompletion, startCompletionRefresh] = useTransition();
  const [canceling, setCanceling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [finished, setFinished] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const router = useRouter();
  const trainingHref = useSyncExternalStore(subscribeTrainingLocation, currentTrainingHref, () => "/today");
  const [prs, setPrs] = useState<{ exercise: string; e1rm: number; weight: number; reps: number }[]>([]);

  const groups = buildGroups(session?.sets ?? []);
  const unit = (session?.sets[0] ? editorMetadata(session.sets[0])?.unit : undefined) ?? session?.unit ?? "lb";
  // Summaries describe acknowledged actuals; pending edits never inflate performed volume.
  const summaryRows = buildSummaryRows(session?.sets ?? [], completedSetIds, {}, {}, {}, unit);
  const totalTonnage = summaryRows.reduce((sum, row) => sum + row.tonnage, 0);
  const totalSets = (session?.sets ?? []).filter(set => completedSetIds.has(set.id)).reduce((sum, set) => sum + Math.max(1, set.sets), 0);
  const liftCount = summaryRows.length;
  // A lift is "resolved" once it's logged or deliberately skipped — both let the
  // progress bar advance and the workout reach a finishable state.
  const resolvedGroupCount = groups.filter(
    (group) => allSetsInGroupLogged(group) || isGroupSkipped(group),
  ).length;

  // Load a session into the card, restoring any already-logged sets (a set with
  // actual_reps is logged) and jumping to the first unfinished group. Used both
  // when starting/resuming and when remounting onto an in-progress workout.
  function loadSession(body: SessionResponse) {
    setSession(body);
    setValues(
      Object.fromEntries(body.sets.map((set) => [set.id, set.actual_reps ?? set.rep_out_target])),
    );
    setAdded(
      Object.fromEntries(
        body.sets.filter((set) => set.actual_weight != null).map((set) => [set.id, set.actual_weight as number]),
      ),
    );
    const logged = new Set(body.sets.filter((set) => set.actual_reps != null).map((set) => set.id));
    setCompletedSetIds(logged);
    const gs = buildGroups(body.sets);
    // Restore edited working weights for superset/custom sets (main lifts derive
    // their weight from the training max, so they're left out).
    const editableWeightIds = new Set(
      gs.filter((group) => !isFlatSingle(group)).flatMap((group) => group.sets.map((set) => set.id)),
    );
    setWeights(
      Object.fromEntries(
        body.sets
          .filter((set) => !isBodyweight(set) && editableWeightIds.has(set.id) && set.actual_weight != null)
          .map((set) => [set.id, set.actual_weight as number]),
      ),
    );

  }

  // Resume an in-progress workout when landing back on this card (e.g. after
  // switching tabs) so logged sets and weights aren't lost. Read-only fetch.
  useEffect(() => {
    if (session || finished || skipped) return;
    let active = true;
    const params = new URLSearchParams({
      occurrenceId: String(occurrenceId ?? ""),
      dayId: String(dayId),
      definitionDayId: String(definitionDayId ?? ""),
      week: String(currentWeek),
    });
    fetch(resumeSessionId ? `/api/sessions/${resumeSessionId}` : `/api/programs/${programId}/sessions/current?${params.toString()}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: (SessionResponse & { status?: string }) | null) => {
        if (resumeSessionId && (!data || data.id !== resumeSessionId || data.status !== "in_progress" || !Array.isArray(data.sets))) {
          throw new Error("Could not resume this exact workout. Retry or return to its history.");
        }
        if (active && data && data.sets) loadSession(data);
      })
      .catch(() => { if (active && resumeSessionId) setError("Could not resume this exact workout. Retry or return to its history."); });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId, dayId, definitionDayId, currentWeek, occurrenceId, resumeSessionId]);

  async function startSession() {
    setError("");
    setSubmitting(true);
    try {
      const response = resumeSessionId ? await fetch(`/api/sessions/${resumeSessionId}`, { method: "GET" }) : await fetch(`/api/programs/${programId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occurrenceId, dayId, definitionDayId, weekNumber: currentWeek, scheduledDate }),
      });
      const body = await readResponseJson<SessionResponse & { error?: string; status?: string }>(response);
      if (!response.ok || !body) throw new Error(body?.error ?? "Could not start workout");
      if (resumeSessionId && (body.id !== resumeSessionId || body.status !== "in_progress" || !Array.isArray(body.sets))) throw new Error("Could not resume this exact workout. Retry or return to its history.");
      loadSession(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start workout");
    } finally {
      setSubmitting(false);
    }
  }

  // Live: as the TM field changes, re-price this exercise's unlogged sets right
  // away (using the same formula as the server) so the working weight tracks the
  // TM before you commit. Persisting happens on blur via applyTmUpdate.
  function previewTm(exerciseName: string, trainingMax: number) {
    setSession((prev) =>
      prev
        ? {
            ...prev,
            sets: prev.sets.map((set) =>
              set.exercise_name === exerciseName
                ? {
                    ...set,
                    training_max: trainingMax,
                    calculated_weight:
                      set.actual_reps == null && set.intensity_pct != null
                        ? calculateWeight(trainingMax, set.intensity_pct, rounding)
                        : set.calculated_weight,
                  }
                : set,
            ),
          }
        : prev,
    );
  }

  function applyTmUpdate(updated: TmUpdatedSet[]) {
    const byId = new Map(updated.map((s) => [s.id, s]));
    setSession((prev) =>
      prev
        ? {
            ...prev,
            sets: prev.sets.map((s) =>
              byId.has(s.id)
                ? {
                    ...s,
                    training_max: byId.get(s.id)!.training_max,
                    calculated_weight: byId.get(s.id)!.calculated_weight,
                  }
                : s,
            ),
          }
        : prev,
    );
  }

  function inputValues(set: WorkoutSet): SetDraft {
    const draft = drafts[set.id];
    return draft && !(draft.intent === "retained" && set.actual_reps != null) ? draft : {
      expectedActual: { reps: set.actual_reps, weight: set.actual_weight },
      reps: String(values[set.id] ?? set.actual_reps ?? set.rep_out_target),
      weight: set.actual_reps != null && set.actual_weight == null ? "" : String(isBodyweight(set) ? (added[set.id] ?? set.actual_weight ?? set.calculated_weight ?? 0) : (weights[set.id] ?? set.actual_weight ?? set.calculated_weight)),
    };
  }

  function editSet(set: WorkoutSet, field: keyof SetDraft, value: string) {
    if (!session) return;
    const next = { ...inputValues(set), expectedActual: inputValues(set).expectedActual ?? { reps: set.actual_reps, weight: set.actual_weight }, [field]: value, intent: drafts[set.id]?.intent === "undo" ? "undo" as const : undefined };
    if (!writeDrafts(session.id, { ...parseDrafts(readDraftSnapshot(session.id)), [set.id]: next })) setStorageWarning(true);
    setFailedIds((prev) => new Set([...prev].filter((id) => id !== set.id)));
  }

  function discardSetChanges(set: WorkoutSet) {
    if (!session || savingIds.has(set.id)) return;
    const latest = parseDrafts(readDraftSnapshot(session.id));
    delete latest[set.id];
    writeDrafts(session.id, latest);
    setConflicts((prev) => { const next = { ...prev }; delete next[set.id]; return next; });
    setFailedIds((prev) => new Set([...prev].filter((id) => id !== set.id)));
  }

  async function saveSets(sets: WorkoutSet[], overrides: Record<number, SetDraft> = {}, undo = false) {
    if (!session || savingIds.size || saving) return;
    setError("");
    const submissions = sets.map(set => {
      const entered = overrides[set.id] ?? inputValues(set);
      return { set, draft: { ...entered, expectedActual: entered.expectedActual ?? { reps: set.actual_reps, weight: set.actual_weight }, intent: undo ? "undo" as const : undefined } };
    });
    for (const { draft } of submissions) {
      if (!undo && (!/^\d+$/.test(draft.reps) || !Number.isSafeInteger(Number(draft.reps)))) {
        setError("Enter whole reps, including 0 for a performed set with no reps."); return;
      }
      if (!undo && (!draft.weight.trim() || !Number.isFinite(Number(draft.weight)) || Number(draft.weight) < 0)) {
        setError("Enter a weight of 0 or more."); return;
      }
    }
    const pending = parseDrafts(readDraftSnapshot(session.id));
    for (const { set, draft } of submissions) pending[set.id] = draft;
    if (!writeDrafts(session.id, pending)) setStorageWarning(true);
    setSaving(true);
    setSavingIds(new Set(sets.map((set) => set.id)));
    let savingId = sets[0]?.id;
    try {
      for (const { set, draft } of submissions) {
        savingId = set.id;
        const actualReps = undo ? null : Number(draft.reps);
        const actualWeight = undo ? null : Number(draft.weight);
        const response = await fetch(`/api/sessions/${session.id}/sets`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setId: set.id, actualReps, actualWeight, expectedActual: draft.expectedActual ?? { reps: set.actual_reps, weight: set.actual_weight } }),
        });
        if (!response.ok) {
          const body = await readResponseJson<{ error?: string }>(response);
          if (response.status === 409) {
            const latestResponse = await fetch(`/api/sessions/${session.id}`);
            const latest = await readResponseJson<SessionResponse>(latestResponse);
            const changed = latestResponse.ok ? latest?.sets.find((row) => row.id === set.id) : undefined;
            if (changed) {
              setConflicts((prev) => ({ ...prev, [set.id]: { reps: changed.actual_reps, weight: changed.actual_weight } }));
              setSession((prev) => prev ? { ...prev, sets: prev.sets.map((row) => row.id === set.id ? { ...row, actual_reps: changed.actual_reps, actual_weight: changed.actual_weight } : row) } : prev);
              setValues((prev) => ({ ...prev, [set.id]: changed.actual_reps ?? set.rep_out_target }));
              setWeights((prev) => ({ ...prev, [set.id]: changed.actual_weight ?? set.calculated_weight }));
              setAdded((prev) => ({ ...prev, [set.id]: changed.actual_weight ?? set.calculated_weight }));
              setCompletedSetIds((prev) => { const next = new Set(prev); if (changed.actual_reps == null) next.delete(set.id); else next.add(set.id); return next; });
            }
          }
          throw new Error(body?.error ?? "Could not save set");
        }
        const acknowledgement = await readResponseJson<{ success?: boolean; actual_reps?: number | null; actual_weight?: number | null }>(response);
        const actualsMatch = acknowledgement?.actual_reps === actualReps && acknowledgement?.actual_weight === actualWeight;
        if (!(undo ? actualsMatch : acknowledgement?.success === true || actualsMatch)) throw new Error(undo ? "Could not confirm Undo. Retry undo before finishing." : "Could not confirm the saved set. Retry to recover the result.");
        setSession((prev) => prev ? { ...prev, sets: prev.sets.map((row) => row.id === set.id ? { ...row, actual_reps: actualReps, actual_weight: actualWeight } : row) } : prev);
        if (!undo) {
          setValues((prev) => ({ ...prev, [set.id]: actualReps! }));
          if (isBodyweight(set)) setAdded((prev) => ({ ...prev, [set.id]: actualWeight! }));
          else setWeights((prev) => ({ ...prev, [set.id]: actualWeight! }));
        }
        setCompletedSetIds(prev => { const next = new Set(prev); if (undo) next.delete(set.id); else next.add(set.id); return next; });
        setFailedIds((prev) => new Set([...prev].filter((id) => id !== set.id)));
        const latest = parseDrafts(readDraftSnapshot(session.id));
        if (latest[set.id]?.reps === draft.reps && latest[set.id]?.weight === draft.weight) {
          if (undo) latest[set.id] = { ...latest[set.id], expectedActual: { reps: null, weight: null }, intent: "retained" };
          else delete latest[set.id];
        } else if (latest[set.id] && JSON.stringify(latest[set.id].expectedActual) === JSON.stringify(draft.expectedActual)) {
          latest[set.id] = { ...latest[set.id], expectedActual: { reps: actualReps, weight: actualWeight }, intent: undefined };
        }
        writeDrafts(session.id, latest);
        setConflicts((prev) => { const next = { ...prev }; delete next[set.id]; return next; });
        setSavingIds((prev) => new Set([...prev].filter((id) => id !== set.id)));
      }
    } catch (err) {
      if (savingId != null) setFailedIds((prev) => new Set(prev).add(savingId));
      setError(err instanceof Error ? err.message : "Could not save set");
    } finally {
      setSavingIds(new Set());
      setSaving(false);
    }
  }

  async function complete(holdUnavailable = false) {
    if (!session || saving || hasPending) return;
    setError("");
    setCompleting(true);
    try {
      const response = await fetch(`/api/programs/${programId}/complete-and-advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, ...(holdUnavailable ? { unavailableTemplatePolicy: "hold" } : {}) }),
      });
      const body = await readResponseJson<{ error?: string; code?: string; success?: boolean; progressionDecisions?: typeof progressionDecisions }>(response);
      if (!response.ok) {
        setUnavailableTemplate(body?.code === "missing_legacy_template");
        throw new Error(body?.error ?? "Could not complete workout");
      }
      if (body?.success !== true) throw new Error("Could not confirm completion. Retry finishing to recover the saved result.");
      setProgressionDecisions(body?.progressionDecisions ?? []);
      writeDrafts(session.id, {});
      // Today can replace this card with its saved recap. Commit the local
      // completion and refreshed route together so navigation never starts
      // from a transient, already-complete view during that replacement.
      startCompletionRefresh(() => {
        setFinished(true);
        router.refresh();
      });
      // Surface any personal records set this session (non-fatal if it fails).
      try {
        const prResponse = await fetch(`/api/sessions/${session.id}/prs`);
        if (prResponse.ok) {
          const prBody = (await prResponse.json()) as { prs?: typeof prs };
          setPrs(prBody.prs ?? []);
        }
      } catch {
        /* PRs are a bonus — never block the finish on them */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete workout");
    } finally {
      setCompleting(false);
    }
  }

  async function skipWorkout() {
    setError("");
    setSkipping(true);
    try {
      const response = await fetch(`/api/programs/${programId}/skip-workout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occurrenceId, dayId, definitionDayId }),
      });
      const body = await readResponseJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(body?.error ?? "Could not skip workout");
      setSkipped(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not skip workout");
    } finally {
      setSkipping(false);
    }
  }

  // Discard an in-progress workout (and its logged sets) and return to idle.
  // Two-tap: the first tap arms the button, the second actually cancels.
  async function cancelWorkout() {
    if (!session) return;
    if (!confirmingCancel) {
      setConfirmingCancel(true);
      return;
    }
    setError("");
    setCanceling(true);
    try {
      const response = await fetch(`/api/sessions/${session.id}`, { method: "DELETE" });
      const body = await readResponseJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(body?.error ?? "Could not cancel workout");
      // Back to the idle "Start workout" state — clear ALL per-set state so it
      // can't bleed into the next session (weights and skips were left behind).
      writeDrafts(session.id, {});
      setSession(null);
      setCompletedSetIds(new Set());
      setValues({});
      setAdded({});
      setWeights({});
      setSkippedGroupKeys(new Set());
      setConfirmingCancel(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel workout");
    } finally {
      setCanceling(false);
    }
  }

  function groupKey(group: WorkoutGroup): number { return group.sets[0].id; }
  function isGroupSkipped(group: WorkoutGroup): boolean { return skippedGroupKeys.has(groupKey(group)); }
  function skipLift(group: WorkoutGroup) { setSkippedGroupKeys(prev => new Set(prev).add(groupKey(group))); }
  function unskipLift(group: WorkoutGroup) { setSkippedGroupKeys(prev => { const next = new Set(prev); next.delete(groupKey(group)); return next; }); }
  function allSetsInGroupLogged(group: WorkoutGroup): boolean {
    return group.sets.every(set => completedSetIds.has(set.id) && !isPending(drafts[set.id]) && !savingIds.has(set.id));
  }

  const isLive = Boolean(session) && !finished && !skipped;
  const idle = !session && !finished && !skipped;
  const showPreview = idle && (focusMode || Boolean(nextLifts?.length) || Boolean(scheduleLabel) || Boolean(statusLine));

  const addExerciseControl = session ? (<AddSessionExerciseForm
    sessionId={session.id}
            onAdded={(newSets) => {
              setSession((prev) => (prev ? { ...prev, sets: [...prev.sets, ...newSets] } : prev));
              setValues((prev) => ({
                ...prev,
                ...Object.fromEntries(newSets.map((set) => [set.id, set.rep_out_target])),
              }));
            }}
            onError={setError}
          />) : null;
  const cancelControl = (<button
              type="button"
              disabled={canceling || saving}
              onClick={cancelWorkout}
              onBlur={() => setConfirmingCancel(false)}
              className={`touch-target rounded-xl px-4 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                confirmingCancel ? "bg-danger-soft text-danger-ink" : "text-faint active:bg-surface-muted"
              }`}
            >
              {canceling
                ? "Canceling…"
                : confirmingCancel
                  ? "Tap again to discard this workout"
                  : "Cancel workout"}
            </button>);

  return (
    <section data-workout-focus={focusMode || undefined} className={`card overflow-hidden ${isLive ? "border-brand-line" : ""} ${focusMode ? styles.focus : ""}`}>
      {showPreview ? (
        <>
          {!focusMode && <div className="h-1 bg-brand" aria-hidden="true" />}
          <div className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {eyebrow && (!focusMode || eyebrow === "Unscheduled run") ? (
                  <p className="eyebrow text-[11px] text-brand-strong">{eyebrow}</p>
                ) : null}
                {focusMode ? <h2 className="display break-words text-3xl leading-tight">{dayName}</h2> : <p className="display mt-1 truncate text-2xl leading-tight">{programName}</p>}
                <p className="mt-1 text-sm text-muted">
                  {focusMode ? `${programName} · Week ${currentWeek}` : `Week ${currentWeek} · Day ${currentDay} · ${dayName}`}
                </p>
              </div>
              {scheduleLabel && !focusMode ? (
                <span className="shrink-0 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-muted">
                  {scheduleLabel}
                </span>
              ) : null}
            </div>

            {nextLifts && nextLifts.length > 0 ? (
              <div className={focusMode ? "mt-4 border-t border-line pt-3" : "mt-4 rounded-xl bg-surface-muted p-3.5"}>
                {!focusMode && <div className="eyebrow mb-2.5 flex items-center gap-1.5 text-[11px] text-brand-strong">
                  <Dumbbell aria-hidden="true" size={13} />
                  {liftsLabel}
                </div>}
                <div className="flex flex-col gap-2.5">
                  {nextLifts.map((lift, index) => (
                    <div key={`${lift.name}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-semibold">{lift.name}</span>
                      <span className="text-right font-display text-base tracking-tight text-muted">{lift.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {statusLine || (!focusMode && holdSlot) ? (
              <div className="mt-3.5 flex items-center justify-between text-xs text-faint">
                <span>{statusLine}</span>
                {!focusMode && holdSlot}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div data-workout-header className="flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className={`h-9 w-1 rounded-full ${isLive ? "bg-brand" : "bg-line"}`} />
          <div className="min-w-0">
            {focusMode ? <h2 className="display break-words text-xl leading-tight">{dayName}</h2> : <p className="display truncate text-lg leading-tight">{programName}</p>}
            <p className={focusMode ? "mt-0.5 text-xs text-muted" : "eyebrow mt-0.5 text-[10px] text-faint"}>
              {focusMode ? `${programName} · Week ${currentWeek}` : `Day ${currentDay} · Week ${currentWeek} · ${dayName}`}
            </p>
          </div>
        </div>
      )}

      {skipped ? (
        <div className="border-t border-line px-4 py-7 text-center">
          <p className="display text-lg text-muted">Workout skipped</p>
        </div>
      ) : finished ? (
        <div className="border-t border-line px-4 py-6">
          <div className="flex flex-col items-center text-center">
            <span className="eyebrow inline-flex items-center gap-1.5 text-[11px] text-success-ink">
              <Check aria-hidden="true" size={14} strokeWidth={3} />
              Workout complete
            </span>
            <p className="display mt-2.5 text-6xl leading-[0.9] text-foreground">
              {formatTonnage(totalTonnage)}
            </p>
            <p className="eyebrow mt-1.5 text-[11px] text-faint">{unit} moved</p>
            {totalSets > 0 && (
              <div className="mt-4 flex items-stretch divide-x divide-line rounded-xl bg-surface-muted">
                <div className="px-5 py-2">
                  <p className="font-display text-xl leading-none">{totalSets}</p>
                  <p className="eyebrow mt-1 text-[9px] text-faint">sets</p>
                </div>
                <div className="px-5 py-2">
                  <p className="font-display text-xl leading-none">{liftCount}</p>
                  <p className="eyebrow mt-1 text-[9px] text-faint">{liftCount === 1 ? "lift" : "lifts"}</p>
                </div>
              </div>
            )}
          </div>
          {progressionDecisions.length > 0 && (
            <div className="mt-5 rounded-xl border border-line bg-surface-muted p-3.5">
              <p className="eyebrow text-xs text-brand-strong">Progression</p>
              {progressionDecisions.map((decision) => <div key={decision.progressionKey} className="mt-3 text-sm"><p className="font-semibold">{decision.exerciseName}</p><p className="mt-1 text-muted">{decision.result.explanation}</p></div>)}
            </div>
          )}
          {prs.length > 0 && (
            <div className="mt-5 rounded-xl border border-brand-line bg-brand-soft p-3.5">
              <p className="eyebrow flex items-center gap-1.5 text-[11px] text-brand-strong">
                <Trophy aria-hidden="true" size={13} />
                New personal record{prs.length > 1 ? "s" : ""}
              </p>
              <ul className="mt-2.5 flex flex-col gap-2">
                {prs.map((pr) => (
                  <li key={pr.exercise} className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold">{pr.exercise}</span>
                    <span className="font-display tracking-tight text-muted">
                      {pr.weight} × {pr.reps} · e1RM{" "}
                      <span className="font-semibold text-brand-strong">{pr.e1rm}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summaryRows.length > 0 && (
            <ul className="mt-5 flex flex-col gap-2 text-left">
              {summaryRows.map((row) => (
                <li
                  key={row.key}
                  className="flex items-center justify-between rounded-xl bg-surface-muted px-3.5 py-2.5 text-sm"
                >
                  <span className="font-semibold">{row.exerciseName}</span>
                  <span className="text-right text-muted">
                    {summaryDetail(row)}
                    <span className="block font-display text-xs tracking-tight text-faint">
                      {formatTonnage(row.tonnage)} {row.unit} total
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : !session ? (
        <div className="border-t border-line px-4 py-4">
          <ErrorBanner message={error} />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={startSession}
              className="touch-target flex-1 rounded-xl bg-brand px-4 py-3 text-base font-semibold text-white transition-colors active:bg-brand-strong disabled:opacity-50"
            >
              {submitting ? "Loading…" : startLabel}
            </button>
            {focusMode && (showSkip || holdSlot) ? <details className={styles.options}>
              <summary className="touch-target flex cursor-pointer items-center justify-center rounded-xl px-4 text-sm font-semibold text-muted hover:bg-surface-muted">More</summary>
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
                {holdSlot}
                {showSkip && <button type="button" disabled={skipping} onClick={skipWorkout} className="touch-target rounded-xl px-3 text-sm font-semibold text-muted hover:bg-surface-muted disabled:opacity-50">{skipping ? "Skipping…" : "Skip workout"}</button>}
              </div>
            </details> : showSkip ? (
              <button
                type="button"
                disabled={skipping}
                onClick={skipWorkout}
                className="touch-target rounded-xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-faint transition-colors active:bg-surface-muted disabled:opacity-50"
              >
                Skip
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <fieldset disabled={completing || refreshingCompletion} className="min-w-0 border-0 border-t border-line p-0">
          <div className="px-4 py-3">
            <p className="text-sm text-muted">{formatTonnage(totalTonnage)} {unit} · {totalSets} {totalSets === 1 ? "set" : "sets"}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-label={`${resolvedGroupCount} of ${groups.length} lifts complete or skipped`}>
              <div className="h-full bg-brand" style={{ width: `${groups.length ? (resolvedGroupCount / groups.length) * 100 : 0}%` }} />
            </div>
          </div>
          {storageWarning || isDraftVolatile(session.id) ? <p role="status" className="px-4 pb-3 text-sm text-muted">Device storage is unavailable. Keep this page open until your pending sets are saved.</p> : null}
          {error ? <div className="px-4 pb-3"><ErrorBanner message={error} /></div> : null}
          {groups.map(group => {
            const savedCount = group.sets.filter(set => completedSetIds.has(set.id) && !isPending(drafts[set.id]) && !savingIds.has(set.id)).reduce((sum, set) => sum + Math.max(1, set.sets), 0);
            const status = group.sets.some(set => conflicts[set.id]) ? "Resolve conflicting changes" : group.sets.some(set => savingIds.has(set.id)) ? "Saving…" : group.sets.some(set => drafts[set.id]?.intent === "undo") ? "Undo unconfirmed" : group.sets.some(set => failedIds.has(set.id)) ? "Save failed" : group.sets.some(set => isPending(drafts[set.id])) ? "Unsaved changes" : isGroupSkipped(group) ? "Skipped" : undefined;
            const first = group.sets[0];
            return <ExerciseLogCard key={groupKey(group)} name={groupExerciseNames(group).join(" + ")} saved={savedCount} total={group.sets.reduce((sum, set) => sum + Math.max(1, set.sets), 0)} status={status}>
              {group.supersetGroup && <p className="mb-2 text-xs font-semibold text-muted">Superset · {group.supersetGroup}</p>}
              {group.sets.filter((set, index, all) => {
                const last = session.lastPerformance?.[String(set.id)];
                return last && !all.slice(0, index).some(prior => { const other = session.lastPerformance?.[String(prior.id)]; return other?.sessionId === last.sessionId && other?.exerciseId === last.exerciseId; });
              }).map(set => { const last = session.lastPerformance![String(set.id)]; return <Link key={set.id} href={withWorkoutReturn(`/workouts/${last.sessionId}`, trainingHref)} className="touch-target mb-2 flex items-center text-sm text-muted underline decoration-line underline-offset-2" aria-label={`Previous ${set.exercise_name} workout, ${last.date}: ${formatLastPerformance(last)}`}>Last{group.supersetGroup ? ` · ${set.exercise_name}` : ""}: {formatLastPerformance(last)}</Link>; })}
              {isGroupSkipped(group) ? <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted">Unlogged sets skipped</p><button type="button" onClick={() => unskipLift(group)} className="touch-target rounded-xl border border-line px-3 text-sm font-semibold">Do this lift</button></div> : null}
              {group.sets.map((set, index) => {
                const number = index + 1;
                const rowUnit = setUnit(set, unit);
                const draft = drafts[set.id];
                const pending = isPending(draft);
                const rowSaving = savingIds.has(set.id);
                const logged = completedSetIds.has(set.id);
                const saved = logged && !pending && !rowSaving;
                const editor = editorMetadata(set);
                const spec = editor?.set;
                const role = spec?.role ?? (set.rep_out_target > set.reps ? "amrap" : "work");
                const roleLabel = role === "amrap" ? "AMRAP" : role[0].toUpperCase() + role.slice(1);
                const range = set.reps === set.rep_out_target ? String(set.reps) : `${set.reps}–${set.rep_out_target}`;
                const loadLabel = isBodyweight(set) ? `BW${set.calculated_weight > 0 ? ` +${set.calculated_weight} ${rowUnit}` : ""}` : `${set.calculated_weight} ${rowUnit}`;
                return <SetLogRow key={set.id} number={number} count={set.sets} name={group.supersetGroup ? set.exercise_name : undefined}
                  reps={inputValues(set).reps} weight={inputValues(set).weight} unit={rowUnit} addedWeight={isBodyweight(set)}
                  repsLabel={`${set.exercise_name} set ${number} reps`} weightLabel={`${set.exercise_name} set ${number} weight (${rowUnit})`}
                  saved={saved} logged={logged} pending={pending} saving={rowSaving} failed={failedIds.has(set.id)} missingWeight={set.actual_reps != null && set.actual_weight == null} undoPending={draft?.intent === "undo"}
                  saveDisabled={saving || !!conflicts[set.id]} saveLabel={`Save set ${number}`}
                  onChange={(field, value) => editSet(set, field, value)} onSave={() => { unskipLift(group); void saveSets([set]); }} onUndo={() => { void saveSets([set], {}, true); }}
                  prescription={<>
                    <p className="mt-1 text-sm text-muted">{roleLabel} · {range} reps · {loadLabel}</p>
                    {spec ? <p className="mt-1 text-xs text-muted">{[spec.effortKind !== "none" ? `${spec.effortKind.toUpperCase()} ${spec.effort}` : "", `Rest ${spec.restSeconds} s`, spec.tempo ? `Tempo ${spec.tempo}` : ""].filter(Boolean).join(" · ")}</p> : null}
                    {spec?.notes ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{spec.notes}</p> : null}
                  </>}>
                  {conflicts[set.id] ? <div className="mt-3 rounded-xl border border-warn-line bg-warn-soft p-3 text-sm text-warn-ink">
                    <p>Saved elsewhere: {conflicts[set.id].reps == null ? "unperformed" : `${conflicts[set.id].reps} reps at ${conflicts[set.id].weight ?? 0} ${rowUnit}`}.</p>
                    <button type="button" disabled={saving} onClick={() => discardSetChanges(set)} className="touch-target mt-2 w-full rounded-xl border border-line bg-surface px-2 text-sm font-semibold text-muted">Use saved values</button>
                    <button type="button" aria-label={`Keep my set ${number} edits`} disabled={saving} onClick={() => saveSets([set], { [set.id]: { ...inputValues(set), expectedActual: conflicts[set.id] } }, draft?.intent === "undo")} className="touch-target mt-2 w-full rounded-xl border border-line bg-surface px-2 text-sm font-semibold text-muted">Keep my edits</button>
                  </div> : null}
                  {pending && !rowSaving && draft?.intent !== "undo" ? <button type="button" aria-label={`Discard set ${number} changes`} onClick={() => discardSetChanges(set)} className="touch-target mt-1 w-full rounded-xl px-3 py-2 text-sm font-semibold text-muted">Discard changes</button> : null}
                </SetLogRow>;
              })}
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
                {!isGroupSkipped(group) && !allSetsInGroupLogged(group) ? <button type="button" disabled={saving || group.sets.some(set => isPending(drafts[set.id]))} onClick={() => skipLift(group)} className="touch-target inline-flex items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold text-muted active:bg-surface-muted disabled:opacity-50"><SkipForward aria-hidden="true" size={16} />Skip lift</button> : null}
                {!group.supersetGroup && !group.sets.some(set => set.editor_json) && first.training_max && !isBodyweight(first) ? <details className={styles.options}><summary className="touch-target flex cursor-pointer items-center justify-center rounded-xl px-3 text-sm font-semibold text-muted">Training max</summary><WorkoutTmEditor key={first.exercise_name} sessionId={session.id} exerciseName={first.exercise_name} value={first.training_max} onPreview={tm => previewTm(first.exercise_name, tm)} onUpdated={applyTmUpdate} /></details> : null}
              </div>
            </ExerciseLogCard>;
          })}

          {!focusMode && addExerciseControl}

          <div className="flex flex-col gap-2 px-4 pb-4 pt-3">
            {hasPending ? <p className="text-xs text-muted">Save pending edits before finishing. Sets left unlogged stay unperformed.</p> : null}
            <div className="flex flex-wrap items-start gap-2">
              <button
                type="button"
                disabled={completing || refreshingCompletion || saving || hasPending}
                onClick={() => { void complete(); }}
                className="touch-target flex-[1_1_12rem] whitespace-normal break-words rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-colors active:opacity-90 disabled:opacity-50"
              >
                {completing || refreshingCompletion ? "Finishing…" : "Finish Workout"}
              </button>
              {focusMode && <details className={styles.options}>
                <summary className="touch-target flex cursor-pointer items-center justify-center rounded-xl border border-line px-3 text-sm font-semibold text-muted">More</summary>
                <div className="rounded-xl border border-line bg-surface py-2">{addExerciseControl}{cancelControl}</div>
              </details>}
            </div>
            {unavailableTemplate ? <button type="button" className="touch-target rounded-xl border border-warn-line bg-warn-soft px-4 py-3 text-sm font-semibold text-warn-ink disabled:opacity-50" disabled={completing || refreshingCompletion || saving || hasPending} onClick={() => { void complete(true); }}>Finish without changing affected training maxes</button> : null}
            {!focusMode && cancelControl}
          </div>
        </fieldset>
      )}
    </section>
  );
}
