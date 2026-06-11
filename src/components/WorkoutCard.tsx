"use client";

import { Check, Circle, Dumbbell, SkipForward, Trophy } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { AddSessionExerciseForm } from "@/components/AddSessionExerciseForm";
import { ErrorBanner } from "@/components/ErrorBanner";
import { WorkoutTmEditor, type TmUpdatedSet } from "@/components/WorkoutTmEditor";
import { calculateWeight } from "@/lib/calculator";
import {
  buildGroups,
  buildSummaryRows,
  formatTonnage,
  groupExerciseNames,
  isBodyweight,
  isFlatSingle,
  lastGroupIndex,
  summaryDetail,
  type SessionResponse,
  type WorkoutGroup,
} from "@/components/workout-card-utils";

export function WorkoutCard({
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
  /** Pause-run control, rendered in the idle header. */
  holdSlot?: ReactNode;
  /** Small label above the program name (e.g. "Scheduled today"). */
  eyebrow?: string;
  /** Heading over the lift preview (default "Today's lifts"). */
  liftsLabel?: string;
  /** User's weight-rounding setting, for live TM-driven weight recompute. */
  rounding?: number;
}) {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [currentGroupIdx, setCurrentGroupIdx] = useState(0);
  const [values, setValues] = useState<Record<number, number>>({});
  // Optional added weight per set for bodyweight exercises (keyed by set id).
  const [added, setAdded] = useState<Record<number, number>>({});
  const [completedSetIds, setCompletedSetIds] = useState<Set<number>>(new Set());
  // Lifts the user chose to skip this session, keyed by the group's leading set
  // id. Client-only: skipped lifts are simply left unlogged, so the recap marks
  // them skipped at finish. A full reload resets this (the lift returns as "to do").
  const [skippedGroupKeys, setSkippedGroupKeys] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [finished, setFinished] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const router = useRouter();
  const [prs, setPrs] = useState<{ exercise: string; e1rm: number; weight: number; reps: number }[]>([]);

  const groups = buildGroups(session?.sets ?? []);
  const currentGroup = groups[currentGroupIdx];
  const currentSet = currentGroup?.sets[currentGroup.sets.length - 1];
  const prevGroups = groups.slice(0, currentGroupIdx);
  const upcomingGroups = groups.slice(currentGroupIdx + 1);
  const isLastGroup = currentGroupIdx === lastGroupIndex(groups);
  const summaryRows = buildSummaryRows(session?.sets ?? [], completedSetIds, values);
  const totalTonnage = summaryRows.reduce((sum, row) => sum + row.tonnage, 0);
  const totalSets = completedSetIds.size;
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
    const firstUnfinished = gs.findIndex((group) => {
      const last = group.sets[group.sets.length - 1];
      return group.sets.length > 1 ? !logged.has(last.id) : !group.sets.every((s) => logged.has(s.id));
    });
    setCurrentGroupIdx(firstUnfinished === -1 ? Math.max(0, gs.length - 1) : firstUnfinished);
  }

  // Resume an in-progress workout when landing back on this card (e.g. after
  // switching tabs) so logged sets and weights aren't lost. Read-only fetch.
  useEffect(() => {
    if (session || finished || skipped) return;
    let active = true;
    const params = new URLSearchParams({
      dayId: String(dayId),
      definitionDayId: String(definitionDayId ?? ""),
      week: String(currentWeek),
    });
    fetch(`/api/programs/${programId}/sessions/current?${params.toString()}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: SessionResponse | null) => {
        if (active && data && data.sets) loadSession(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId, dayId, definitionDayId, currentWeek]);

  async function startSession() {
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch(`/api/programs/${programId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dayId, definitionDayId, weekNumber: currentWeek, scheduledDate }),
      });
      const body = (await response.json()) as SessionResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not start workout");
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

  async function logSet() {
    if (!session || !currentGroup) return;
    setError("");
    setSaving(true);

    try {
      for (const set of currentGroup.sets) {
        const setReps = values[set.id] ?? set.rep_out_target;
        // Bodyweight renders per-set (never flat-single), so each set has its own added weight.
        const actualWeight = isBodyweight(set) ? (added[set.id] ?? 0) : set.calculated_weight;
        const response = await fetch(`/api/sessions/${session.id}/sets`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setId: set.id, actualReps: setReps, actualWeight }),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? "Could not save set");
        }
        setCompletedSetIds((prev) => new Set(prev).add(set.id));
      }

      if (!isLastGroup) {
        setCurrentGroupIdx((i) => i + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save set");
    } finally {
      setSaving(false);
    }
  }

  async function complete() {
    if (!session) return;
    setError("");
    setCompleting(true);
    try {
      const response = await fetch(`/api/programs/${programId}/complete-and-advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not complete workout");
      setFinished(true);
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
        body: JSON.stringify({ dayId, definitionDayId }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not skip workout");
      setSkipped(true);
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
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not cancel workout");
      // Back to the idle "Start workout" state.
      setSession(null);
      setCompletedSetIds(new Set());
      setValues({});
      setAdded({});
      setCurrentGroupIdx(0);
      setConfirmingCancel(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel workout");
    } finally {
      setCanceling(false);
    }
  }

  function selectGroup(groupIndex: number) {
    setCurrentGroupIdx(groupIndex);
  }

  function groupKey(group: WorkoutGroup): number {
    return group.sets[0].id;
  }

  function isGroupSkipped(group: WorkoutGroup): boolean {
    return skippedGroupKeys.has(groupKey(group));
  }

  // Skip the current lift: mark it skipped (left unlogged → recap shows it as
  // skipped) and advance to the next lift that's neither logged nor skipped.
  function skipLift(group: WorkoutGroup) {
    setSkippedGroupKeys((prev) => new Set(prev).add(groupKey(group)));
    const next = groups.findIndex(
      (g, i) => i > currentGroupIdx && !allSetsInGroupLogged(g) && !isGroupSkipped(g),
    );
    if (next !== -1) setCurrentGroupIdx(next);
  }

  // Re-open a skipped lift to do it after all: clear the skip and focus it.
  function unskipLift(group: WorkoutGroup) {
    setSkippedGroupKeys((prev) => {
      const next = new Set(prev);
      next.delete(groupKey(group));
      return next;
    });
    setCurrentGroupIdx(group.index);
  }

  // Re-open a logged group for editing (e.g. to fix a wrong rep count). Clearing
  // it from completedSetIds re-enables the inputs, pre-filled with the logged
  // values; logging again overwrites the saved set.
  function editGroup(group: WorkoutGroup) {
    setCompletedSetIds((prev) => {
      const next = new Set(prev);
      for (const set of group.sets) next.delete(set.id);
      return next;
    });
  }

  function allSetsInGroupLogged(group: WorkoutGroup): boolean {
    if (group.sets.length > 1) return completedSetIds.has(group.sets[group.sets.length - 1].id);
    return group.sets.every((s) => completedSetIds.has(s.id));
  }

  const isLive = Boolean(session) && !finished && !skipped;
  const idle = !session && !finished && !skipped;
  const showPreview = idle && (Boolean(nextLifts?.length) || Boolean(scheduleLabel) || Boolean(statusLine));

  return (
    <section className={`card overflow-hidden ${isLive ? "sticky top-3 z-10 border-brand-line" : ""}`}>
      {showPreview ? (
        <>
          <div className="h-1 bg-brand" aria-hidden="true" />
          <div className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {eyebrow ? (
                  <p className="eyebrow text-[11px] text-brand-strong">{eyebrow}</p>
                ) : null}
                <p className="display mt-1 truncate text-2xl leading-tight">{programName}</p>
                <p className="mt-1 text-sm text-muted">
                  Week {currentWeek} · Day {currentDay} · {dayName}
                </p>
              </div>
              {scheduleLabel ? (
                <span className="shrink-0 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-muted">
                  {scheduleLabel}
                </span>
              ) : null}
            </div>

            {nextLifts && nextLifts.length > 0 ? (
              <div className="mt-4 rounded-xl bg-surface-muted p-3.5">
                <div className="eyebrow mb-2.5 flex items-center gap-1.5 text-[11px] text-brand-strong">
                  <Dumbbell aria-hidden="true" size={13} />
                  {liftsLabel}
                </div>
                <div className="flex flex-col gap-2.5">
                  {nextLifts.map((lift, index) => (
                    <div key={`${lift.name}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-semibold">{lift.name}</span>
                      <span className="font-display text-base tracking-tight text-muted">{lift.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {statusLine || holdSlot ? (
              <div className="mt-3.5 flex items-center justify-between text-xs text-faint">
                <span>{statusLine}</span>
                {holdSlot}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className={`h-9 w-1 rounded-full ${isLive ? "bg-brand" : "bg-line"}`} />
          <div className="min-w-0">
            <p className="display truncate text-lg leading-tight">{programName}</p>
            <p className="eyebrow mt-0.5 text-[10px] text-faint">
              Day {currentDay} · Week {currentWeek} · {dayName}
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
            <p className="eyebrow mt-1.5 text-[11px] text-faint">lb moved</p>
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
                      {formatTonnage(row.tonnage)} lb total
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
            {showSkip ? (
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
        <div className="border-t border-line">
          {/* Progress header */}
          <div className="px-4 pt-3.5">
            <div className="flex items-center justify-between">
              <span className="eyebrow text-[11px] text-brand-strong">
                Exercise {Math.min(currentGroupIdx + 1, groups.length)} of {groups.length}
              </span>
              <span className="font-display text-xs tracking-tight text-muted">
                {formatTonnage(totalTonnage)} lb · {totalSets} {totalSets === 1 ? "set" : "sets"}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted">
              <div
                className="h-full rounded-full bg-brand transition-all duration-300"
                style={{ width: `${groups.length ? (resolvedGroupCount / groups.length) * 100 : 0}%` }}
              />
            </div>
          </div>

          {error ? (
            <div className="px-4 pt-3">
              <ErrorBanner message={error} />
            </div>
          ) : null}

          {prevGroups.length > 0 && (
            <div className="px-4 pt-3">
              {prevGroups.map((group) =>
                isGroupSkipped(group) ? (
                  <button
                    key={group.index}
                    type="button"
                    onClick={() => unskipLift(group)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm text-faint transition-colors active:bg-surface-muted"
                  >
                    <SkipForward aria-hidden="true" size={15} className="shrink-0 text-faint" />
                    <span className="truncate line-through">{groupExerciseNames(group).join(" + ")}</span>
                    <span className="ml-auto font-display tracking-tight">Skipped</span>
                  </button>
                ) : (
                  <button
                    key={group.index}
                    type="button"
                    onClick={() => selectGroup(group.index)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm text-muted transition-colors active:bg-surface-muted"
                  >
                    <Check aria-hidden="true" size={16} className="shrink-0 text-success" strokeWidth={3} />
                    <span className="truncate">{groupExerciseNames(group).join(" + ")}</span>
                    <span className="ml-auto font-display tracking-tight text-faint">
                      {group.sets.map((s) => `${values[s.id] ?? s.rep_out_target}`).join("/")} reps
                    </span>
                  </button>
                ),
              )}
            </div>
          )}

          {currentGroup && isGroupSkipped(currentGroup) && (
            <div className="px-4 py-3">
              <div className="rounded-2xl border border-line bg-surface-muted px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="eyebrow block text-[10px] text-faint">Skipped</span>
                    <h3 className="display text-2xl leading-tight text-muted">
                      {groupExerciseNames(currentGroup).join(" + ")}
                    </h3>
                  </div>
                  <SkipForward aria-hidden="true" size={20} className="mt-1 shrink-0 text-faint" />
                </div>
                <button
                  type="button"
                  onClick={() => unskipLift(currentGroup)}
                  className="touch-target mt-3 w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-muted transition-colors active:bg-surface-muted"
                >
                  Do this lift instead
                </button>
              </div>
            </div>
          )}

          {currentGroup && !isGroupSkipped(currentGroup) && (
            <div className="px-4 py-3">
              <div className="rounded-2xl border border-brand-line bg-brand-soft px-4 py-4">
                <div className="flex items-start gap-2">
                  {allSetsInGroupLogged(currentGroup) ? (
                    <Check aria-hidden="true" size={22} className="mt-1 shrink-0 text-success" strokeWidth={3} />
                  ) : null}
                  <div className="min-w-0">
                    {currentGroup.supersetGroup ? (
                      <span className="eyebrow block text-[10px] text-brand-strong">Superset</span>
                    ) : null}
                    <h3 className="display text-3xl leading-tight">
                      {groupExerciseNames(currentGroup).join(" + ")}
                    </h3>
                  </div>
                  {!currentGroup.supersetGroup &&
                  currentGroup.sets[0].training_max &&
                  !isBodyweight(currentGroup.sets[0]) ? (
                    <WorkoutTmEditor
                      key={currentGroup.sets[0].exercise_name}
                      sessionId={session.id}
                      exerciseName={currentGroup.sets[0].exercise_name}
                      value={currentGroup.sets[0].training_max}
                      onPreview={(tm) => previewTm(currentGroup.sets[0].exercise_name, tm)}
                      onUpdated={applyTmUpdate}
                    />
                  ) : null}
                </div>

                {isFlatSingle(currentGroup) ? (
                  <>
                    <div className="mt-2.5 flex items-end gap-2.5">
                      <span className="display text-5xl leading-none">
                        {currentGroup.sets[0].calculated_weight}
                      </span>
                      <span className="mb-1 text-sm font-semibold text-muted">lb</span>
                      <span className="mb-1 ml-auto rounded-full bg-surface/80 px-2.5 py-1 font-display text-sm tracking-tight">
                        {currentGroup.sets.length} × {currentGroup.sets[0].reps}
                      </span>
                    </div>

                    {!allSetsInGroupLogged(currentGroup) ? (
                      <label className="mt-4 flex flex-col gap-1.5">
                        <span className="eyebrow text-[10px] text-muted">Reps</span>
                        <input
                          type="number"
                          value={values[currentSet.id] ?? currentSet.rep_out_target}
                          onChange={(event) =>
                            setValues({ ...values, [currentSet.id]: Number(event.target.value) })
                          }
                          min={0}
                          className="touch-target w-full rounded-xl border border-line bg-surface px-3 py-3 text-center font-display text-3xl tracking-tight outline-none transition-colors focus:border-brand"
                        />
                      </label>
                    ) : null}
                  </>
                ) : (
                  <div className="mt-2.5 flex flex-col gap-2.5">
                    {currentGroup.sets.map((set) => (
                      <div key={set.id} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {currentGroup.supersetGroup ? set.exercise_name : `Set ${set.set_number}`}
                          </p>
                          <p className="font-display text-xs tracking-tight text-muted">
                            {set.sets > 1 ? `${set.sets} × ` : ""}
                            {set.reps} @{" "}
                            {isBodyweight(set) ? `BW${added[set.id] ? ` +${added[set.id]}` : ""}` : `${set.calculated_weight} lb`}
                          </p>
                        </div>
                        {allSetsInGroupLogged(currentGroup) ? (
                          <Check aria-hidden="true" size={18} className="shrink-0 text-success" strokeWidth={3} />
                        ) : (
                          <div className="flex shrink-0 items-center gap-1.5">
                            {isBodyweight(set) ? (
                              <label className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  step={0.5}
                                  placeholder="0"
                                  value={added[set.id] ?? ""}
                                  onChange={(event) => setAdded({ ...added, [set.id]: Number(event.target.value) })}
                                  aria-label={`${set.exercise_name} added weight`}
                                  className="touch-target w-14 rounded-xl border border-line bg-surface px-2 py-2 text-center font-display text-xl tracking-tight outline-none transition-colors focus:border-brand"
                                />
                                <span className="text-xs text-faint">+lb</span>
                              </label>
                            ) : null}
                            <label className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min={0}
                                value={values[set.id] ?? set.rep_out_target}
                                onChange={(event) =>
                                  setValues({ ...values, [set.id]: Number(event.target.value) })
                                }
                                aria-label={`${set.exercise_name} reps`}
                                className="touch-target w-16 rounded-xl border border-line bg-surface px-2 py-2 text-center font-display text-xl tracking-tight outline-none transition-colors focus:border-brand"
                              />
                              <span className="text-xs text-faint">reps</span>
                            </label>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {allSetsInGroupLogged(currentGroup) ? (
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-success-ink">
                      <Check aria-hidden="true" size={15} strokeWidth={3} />
                      Logged
                    </span>
                    <button
                      type="button"
                      onClick={() => editGroup(currentGroup)}
                      className="touch-target rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-muted transition-colors active:bg-surface-muted"
                    >
                      Edit
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={logSet}
                      className="touch-target mt-3 w-full rounded-xl bg-brand px-4 py-3 text-base font-semibold text-white transition-colors active:bg-brand-strong disabled:opacity-50"
                    >
                      {saving ? "Saving…" : isLastGroup ? "Log Set" : "Log & Next"}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => skipLift(currentGroup)}
                      className="touch-target mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-faint transition-colors active:bg-surface-muted disabled:opacity-50"
                    >
                      <SkipForward aria-hidden="true" size={14} />
                      Skip this lift
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {upcomingGroups.length > 0 && (
            <div className="px-4 pb-1">
              {upcomingGroups.map((group) =>
                isGroupSkipped(group) ? (
                  <button
                    key={group.index}
                    type="button"
                    onClick={() => unskipLift(group)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm text-faint transition-colors active:bg-surface-muted"
                  >
                    <SkipForward aria-hidden="true" size={15} className="shrink-0 text-faint" />
                    <span className="truncate line-through">{groupExerciseNames(group).join(" + ")}</span>
                    <span className="ml-auto font-display tracking-tight">Skipped</span>
                  </button>
                ) : (
                  <button
                    key={group.index}
                    type="button"
                    onClick={() => selectGroup(group.index)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm text-faint transition-colors active:bg-surface-muted"
                  >
                    <Circle aria-hidden="true" size={15} className="shrink-0 text-line" strokeWidth={2.5} />
                    <span className="truncate text-muted">{groupExerciseNames(group).join(" + ")}</span>
                    <span className="ml-auto font-display tracking-tight">
                      {group.sets.length} set{group.sets.length > 1 ? "s" : ""} · {group.sets[0].reps} @{" "}
                      {group.sets[0].calculated_weight} lb
                    </span>
                  </button>
                ),
              )}
            </div>
          )}

          <AddSessionExerciseForm
            sessionId={session.id}
            onAdded={(newSets) => {
              setSession((prev) => (prev ? { ...prev, sets: [...prev.sets, ...newSets] } : prev));
              setValues((prev) => ({
                ...prev,
                ...Object.fromEntries(newSets.map((set) => [set.id, set.rep_out_target])),
              }));
            }}
            onError={setError}
          />

          <div className="flex flex-col gap-2 px-4 pb-4 pt-3">
            <div className="flex gap-2">
              {showSkip ? (
                <button
                  type="button"
                  disabled={skipping}
                  onClick={skipWorkout}
                  className="touch-target rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-faint transition-colors active:bg-surface-muted disabled:opacity-50"
                >
                  Skip workout
                </button>
              ) : null}
              <button
                type="button"
                disabled={completing}
                onClick={complete}
                className="touch-target flex-1 rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-colors active:opacity-90 disabled:opacity-50"
              >
                {completing ? "Finishing…" : "Finish Workout"}
              </button>
            </div>
            <button
              type="button"
              disabled={canceling}
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
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
