"use client";

import { useState } from "react";
import type { ProgramSetV1 } from "@/features/program-editor/document";
import { simulateProgressionSequence, type ProgressionSimulationResult } from "@/features/program-editor/progression-authoring";
import { resolveEditorSetPrescription } from "@/features/program-editor/prescription";
import { previewProgressionScenarios, validateProgressionRule, type ProgressionInput, type ProgressionRuleV1, type ProgressionState } from "@/features/program-editor/progression";

const inputClass = "touch-target min-w-0 w-full rounded-xl border border-line bg-surface px-3 py-2 text-foreground outline-none focus:border-brand";
const buttonClass = "touch-target rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold active:bg-surface-muted disabled:opacity-50";
const fieldClass = "flex min-w-0 flex-col gap-1 text-sm font-semibold";
const MAX_TRIALS = 8;
type Trial = { id: string; week: string; status: ProgressionInput["status"]; isDeload: boolean; reps: Record<string, string> };
type SimulationProps = { rule: ProgressionRuleV1 | null; sets: ProgramSetV1[]; state: ProgressionState; initialReps: number; unit: "lb" | "kg"; week: number; isDeload: boolean };

export function ProgressionSimulation({ rule, sets, state, initialReps, unit, week, isDeload }: SimulationProps) {
  function newTrial(nextState: ProgressionState, nextWeek: number, deload = false): Trial {
    const reps = Object.fromEntries(sets.map(set => {
      try { return [set.id, String(resolveEditorSetPrescription({ set, rule, state: nextState, initialReps }).repMax)]; }
      catch { return [set.id, String(set.repMax)]; }
    }));
    return { id: crypto.randomUUID(), week: String(nextWeek), status: "completed", isDeload: deload, reps };
  }
  const [trials, setTrials] = useState<Trial[]>(() => [newTrial(state, week, isDeload)]);
  const [priorFailures, setPriorFailures] = useState(String(state.consecutiveFailures));
  const invalidRule = validateProgressionRule(rule).length > 0;
  let results: ProgressionSimulationResult[] = [];
  let simulationError = "";
  let scenarios: ReturnType<typeof previewProgressionScenarios> = [];
  if (!invalidRule) {
    try {
      results = simulateProgressionSequence({
        rule, sets, state: { ...state, consecutiveFailures: Number(priorFailures) }, initialReps,
        steps: trials.map(trial => ({ week: Number(trial.week), status: trial.status, isDeload: trial.isDeload, actualReps: Object.fromEntries(sets.map(set => [set.id, trial.reps[set.id] === "" || trial.reps[set.id] === undefined ? null : Number(trial.reps[set.id])])) })),
      });
      if (results[0]) scenarios = previewProgressionScenarios(results[0].input);
    } catch (error) {
      simulationError = (error instanceof Error ? error.message : "Check the hypothetical workout inputs.")
        .replace(/steps\.(\d+)/g, (_, index) => `Workout ${Number(index) + 1}`)
        .replaceAll("state.consecutiveFailures", "Prior failed exposures");
      for (const [index, set] of sets.entries()) simulationError = simulationError.replaceAll(set.id, `Set ${index + 1}`);
    }
  }
  const variable = rule?.action.variable ?? "load";
  const valueUnit = variable === "reps" ? "reps" : unit;
  const variableLabel = variable === "trainingMax" ? "Training max" : variable === "reps" ? "Shared rep baseline" : "Working load";
  function editTrial(id: string, patch: Partial<Trial>) { setTrials(value => value.map(trial => trial.id === id ? { ...trial, ...patch } : trial)); }

  return <aside aria-label="Hypothetical progression" className="flex min-w-0 flex-col gap-4 rounded-xl border border-line bg-surface-muted p-4">
    <div><h3 className="display text-2xl">Preview results</h3><p className="mt-1 text-sm leading-6 text-muted">Hypothetical workouts only. These use the same evaluator as workout completion and never update training history.</p></div>
    <p className="text-sm leading-6 text-muted">Repeat this selected prescription to explore a sequence. This is not a forecast of other program weeks. Edited outcomes stay as entered; targets recalculate as the rule changes.</p>
    {variable === "reps" ? <p className="text-sm leading-6 text-muted">Rep changes start from the first shared appearance’s {initialReps} reps. Each set keeps its own rep offset; its resulting target appears below.</p> : null}
    {rule?.failureReset ? <label className={fieldClass}>Prior failed exposures (hypothetical)<input className={inputClass} type="number" min="0" inputMode="numeric" value={priorFailures} onChange={event => setPriorFailures(event.target.value)} /></label> : null}
    <p className="text-sm text-muted">Blank reps mean unlogged. Enter 0 for a performed set with no successful reps.</p>
    {simulationError ? <p role="alert" className="break-words rounded-xl border border-danger-line bg-danger-soft p-3 text-sm text-danger-ink">Check the simulation: {simulationError}</p> : null}

    {trials.map((trial, index) => {
      const preview = results[index];
      const number = index + 1;
      return <fieldset key={trial.id} className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-3">
        <legend className="display px-1 text-xl">Hypothetical workout {number}</legend>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className={fieldClass}>Logical week<input aria-label={index === 0 ? "Logical week (hypothetical)" : `Workout ${number} logical week`} className={inputClass} type="number" min="1" inputMode="numeric" value={trial.week} onChange={event => editTrial(trial.id, { week: event.target.value })} /></label>
          <label className={fieldClass}>Workout status<select aria-label={index === 0 ? "Workout status (hypothetical)" : `Workout ${number} status`} className={inputClass} value={trial.status} onChange={event => editTrial(trial.id, { status: event.target.value as Trial["status"] })}><option value="completed">Completed</option><option value="partial">Partial</option><option value="skipped">Skipped</option></select></label>
        </div>
        <label className="touch-target flex items-center gap-2 text-sm font-semibold"><input aria-label={index === 0 ? "Deload (hypothetical)" : `Workout ${number} deload`} type="checkbox" checked={trial.isDeload} onChange={event => editTrial(trial.id, { isDeload: event.target.checked })} />Fixed deload — hold progression</label>
        <div className="grid min-w-0 grid-cols-2 gap-3">{sets.map((set, setIndex) => {
          if (set.role === "warmup") return null;
          const target = preview?.prescription.find(item => item.setId === set.id);
          return <label key={set.id} className={fieldClass}>Set {setIndex + 1} reps<input aria-label={index === 0 ? `Set ${setIndex + 1} reps` : `Workout ${number}, set ${setIndex + 1} reps`} className={inputClass} type="number" min="0" inputMode="numeric" placeholder="Unlogged" disabled={trial.status === "skipped"} value={trial.reps[set.id] ?? ""} onChange={event => editTrial(trial.id, { reps: { ...trial.reps, [set.id]: event.target.value } })} />{target ? <span className="text-xs font-normal leading-5 text-muted">Target {target.repMin === target.repMax ? target.repMin : `${target.repMin}–${target.repMax}`} reps · {set.loadMode === "bodyweight" ? "Bodyweight" : `${set.loadMode === "added" ? "Bodyweight + " : ""}${target.weight} ${unit}`}</span> : null}</label>;
        })}</div>
        {preview ? <div className="rounded-xl bg-surface-muted p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${preview.result.outcome === "advance" ? "bg-success-soft text-success-ink" : preview.result.outcome === "reset" ? "bg-warn-soft text-warn-ink" : "bg-surface text-muted"}`}>{preview.result.outcome === "advance" ? "Advance" : preview.result.outcome === "reset" ? "Reset" : "Hold"}</span><span className="text-xs text-muted">{variableLabel}</span></div>
          <p className="display mt-2 break-words text-2xl">{preview.input.state[variable]} {valueUnit} → {preview.result.nextState[variable]} {valueUnit}</p>
          <p className="mt-1 text-xs text-muted">Failures {preview.input.state.consecutiveFailures} → {preview.result.nextState.consecutiveFailures} · Last evaluated week {preview.result.nextState.lastEvaluatedWeek ?? "none"}</p>
        </div> : null}
        <p role="status" aria-label={index === 0 ? "Progression preview result" : `Workout ${number} preview result`} className="break-words text-sm leading-6 text-foreground">{preview?.result.explanation ?? (invalidRule ? "Correct the rule fields to preview this workout." : "Correct the hypothetical inputs to preview this sequence.")}</p>
        {trials.length > 1 ? <button type="button" className={`${buttonClass} self-start text-muted`} aria-label={`Remove hypothetical workout ${number}`} onClick={() => setTrials(value => value.filter(item => item.id !== trial.id))}>Remove workout</button> : null}
      </fieldset>;
    })}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={buttonClass} disabled={trials.length >= MAX_TRIALS || results.length !== trials.length} onClick={() => {
        const last = results.at(-1);
        if (last) setTrials(value => [...value, newTrial(last.result.nextState, last.input.week + 1)]);
      }}>Add hypothetical workout</button>
      <button type="button" className={buttonClass} onClick={() => { setPriorFailures(String(state.consecutiveFailures)); setTrials([newTrial(state, week, isDeload)]); }}>Reset simulation</button>
    </div>
    <p className="text-xs text-muted">{trials.length} of {MAX_TRIALS} hypothetical workouts. New workouts start with the resulting upper rep targets.</p>
    <details><summary className="touch-target cursor-pointer text-sm font-semibold">Success, miss, partial and skip scenarios</summary><p className="mt-1 text-xs text-muted">Each example starts independently from workout 1.</p><div className="flex flex-col gap-3 pt-2">{scenarios.map(scenario => <p key={scenario.scenario} className="text-sm leading-6 text-muted"><strong className="capitalize text-foreground">{scenario.scenario}: </strong>{scenario.result.explanation}</p>)}</div></details>
  </aside>;
}
