"use client";

import { useState } from "react";
import { describeProgressionRule, validateProgressionRule, type ProgressionRuleV1, type ProgressionState } from "@/features/program-editor/progression";
import { makeProgressionRulePreset, PROGRESSION_RULE_PRESETS, ProgressionAuthoringError, type ProgressionRulePresetId } from "@/features/program-editor/progression-authoring";
import type { ProgramSetV1 } from "@/features/program-editor/document";
import { ProgressionSimulation } from "./ProgressionSimulation";

const inputClass = "touch-target min-w-0 w-full rounded-xl border border-line bg-surface px-3 py-2 text-foreground outline-none focus:border-brand";
const fieldClass = "flex min-w-0 flex-col gap-1 text-sm font-semibold";
const groupClass = "flex min-w-0 flex-col gap-3 rounded-xl border border-line p-4";
const buttonClass = "touch-target rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold active:bg-surface-muted disabled:opacity-50";

export function defaultEditorRule(unit: "lb" | "kg"): ProgressionRuleV1 {
  return { version: 1, condition: { type: "double_progression" }, action: { variable: "load", unit, operation: "add", amount: 2.5, rounding: { mode: "nearest", quantum: 2.5 }, timing: "per_exposure" }, skipPolicy: "hold", partialPolicy: "hold" };
}

type RuleEditorProps = {
  rule: ProgressionRuleV1 | null; onChange: (rule: ProgressionRuleV1 | null) => void;
  sets: ProgramSetV1[]; state: ProgressionState; initialReps: number; unit: "lb" | "kg"; week: number; isDeload: boolean;
};
export function ProgressionRuleEditor(props: RuleEditorProps) {
  const rule = props.rule;
  if (rule && (!rule.condition || !rule.action || !rule.action.rounding || (rule.failureReset && !rule.failureReset.rounding))) {
    return <section className="rounded-xl border border-danger-line bg-danger-soft p-3"><p role="alert" className="text-sm text-danger-ink">This saved progression rule is incomplete. Your other program edits are retained.</p><button type="button" className={`${buttonClass} mt-3`} onClick={() => props.onChange(null)}>Reset this rule to manual</button></section>;
  }
  return <ConfiguredRuleEditor {...props} />;
}
function ConfiguredRuleEditor({ rule, onChange, sets, state, initialReps, unit, week, isDeload }: RuleEditorProps) {
  const [preset, setPreset] = useState<ProgressionRulePresetId>("double");
  const [presetError, setPresetError] = useState("");
  const errors = validateProgressionRule(rule);
  let explanation = "";
  if (!errors.length) {
    explanation = describeProgressionRule(rule);
    if (rule?.condition.type === "designated_set") {
      const target = rule.condition.setId;
      const index = sets.findIndex(set => set.id === target);
      explanation = explanation.replace(target, index < 0 ? "Missing target set" : `Set ${index + 1}`);
    }
  }
  const update = (change: Partial<ProgressionRuleV1>) => onChange({ ...(rule ?? defaultEditorRule(unit)), ...change });
  const action = (change: Partial<ProgressionRuleV1["action"]>) => update({ action: { ...(rule ?? defaultEditorRule(unit)).action, ...change } });
  const weekly = rule?.condition.type === "weekly";

  return <section aria-label="Progression workbench" className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
    <div className="flex min-w-0 flex-col gap-4">
      <details className="rounded-xl bg-surface-muted p-3">
        <summary className="touch-target cursor-pointer text-sm font-semibold">Start from a rule preset</summary>
        <div className="mt-2 flex min-w-0 flex-col gap-3">
          <label className={fieldClass}>Rule starting point<select className={inputClass} value={preset} onChange={event => { setPreset(event.target.value as ProgressionRulePresetId); setPresetError(""); }}>{PROGRESSION_RULE_PRESETS.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <p className="text-sm leading-6 text-muted">{PROGRESSION_RULE_PRESETS.find(item => item.id === preset)?.description}</p>
          <p className="text-sm leading-6 text-muted">Replaces this lift’s rule, including shared appearances. Keeps its loads and set prescriptions. Undo restores the previous rule.</p>
          <button type="button" className={buttonClass} onClick={() => {
            try { const next = makeProgressionRulePreset(preset, { unit, sets }); setPresetError(""); onChange(next); }
            catch (error) { setPresetError(error instanceof ProgressionAuthoringError ? error.issues.map(issue => issue.message).join(" ") : error instanceof Error ? error.message : "Choose a compatible rule for this lift."); }
          }}>Apply rule preset</button>
          {presetError ? <p role="alert" className="text-sm text-danger-ink">{presetError}</p> : null}
        </div>
      </details>

      <fieldset className={groupClass}>
        <legend className="display px-1 text-xl">When</legend>
        <label className={fieldClass}>Progression condition<select className={inputClass} value={rule?.condition.type ?? "manual"} onChange={event => {
          const value = event.target.value;
          if (value === "manual") { onChange(null); return; }
          const base = rule ?? defaultEditorRule(unit);
          const condition: ProgressionRuleV1["condition"] = value === "all_work_sets" ? { type: "all_work_sets", target: "minimum" } : value === "designated_set" ? { type: "designated_set", setId: sets.find(set => set.role === "top" || set.role === "amrap")?.id ?? "", targetReps: 12 } : value === "weekly" ? { type: "weekly" } : { type: "double_progression" };
          onChange({ ...base, condition });
        }}>
          <option value="manual">Manual — no automatic changes</option><option value="all_work_sets">All work sets reach target</option><option value="double_progression">Double progression — all upper targets</option><option value="designated_set">Designated top or AMRAP set</option><option value="weekly">Fixed weekly change</option>
        </select></label>
        {rule?.condition.type === "all_work_sets" ? <label className={fieldClass}>Rep target<select className={inputClass} value={rule.condition.target} onChange={event => update({ condition: { type: "all_work_sets", target: event.target.value as "minimum" | "maximum" } })}><option value="minimum">Minimum reps on every work set</option><option value="maximum">Maximum reps on every work set</option></select></label> : null}
        {rule?.condition.type === "designated_set" ? <>
          <label className={fieldClass}>Target set<select className={inputClass} value={rule.condition.setId} onChange={event => update({ condition: { type: "designated_set", setId: event.target.value, targetReps: rule.condition.type === "designated_set" ? rule.condition.targetReps : 12 } })}><option value="">Choose a top / AMRAP set</option>{sets.map((set, index) => set.role === "top" || set.role === "amrap" ? <option key={set.id} value={set.id}>Set {index + 1} · {set.role}</option> : null)}</select></label>
          <label className={fieldClass}>Required reps<input type="number" inputMode="numeric" className={inputClass} value={rule.condition.targetReps} onChange={event => update({ condition: { type: "designated_set", setId: rule.condition.type === "designated_set" ? rule.condition.setId : "", targetReps: Number(event.target.value) } })} /></label>
          {!sets.some(set => set.role === "top" || set.role === "amrap") ? <p className="text-sm text-danger-ink">Mark a set as Top set or AMRAP in Prescriptions, or choose another condition.</p> : null}
        </> : null}
        {!rule ? <p className="text-sm text-muted">Keep loads, training max and reps under your control.</p> : null}
      </fieldset>

      {rule ? <>
        <fieldset className={groupClass}>
          <legend className="display px-1 text-xl">Change</legend>
          <label className={fieldClass}>Change<select className={inputClass} value={rule.action.variable} onChange={event => action({ variable: event.target.value as "load" | "trainingMax" | "reps", unit: event.target.value === "reps" ? "reps" : unit, rounding: { mode: "nearest", quantum: event.target.value === "reps" ? 1 : 2.5 } })}><option value="load">Working load ({unit})</option><option value="trainingMax">Training max ({unit})</option><option value="reps">Reps</option></select></label>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className={fieldClass}>Adjustment<select className={inputClass} value={rule.action.operation} onChange={event => action({ operation: event.target.value as "add" | "percent" })}><option value="add">Add {rule.action.unit}</option><option value="percent">Percent change</option></select></label>
            <label className={fieldClass}>Increment ({rule.action.operation === "percent" ? "%" : rule.action.unit})<input className={inputClass} type="number" step="any" inputMode="decimal" value={rule.action.amount} onChange={event => action({ amount: Number(event.target.value) })} /></label>
          </div>
          <details><summary className="touch-target cursor-pointer text-sm font-semibold">Rounding details</summary>
            <p className="text-sm text-muted">Round {rule.action.rounding.mode} to {rule.action.rounding.quantum} {rule.action.unit}.</p>
            <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
              <label className={fieldClass}>Round to ({rule.action.unit})<input className={inputClass} type="number" step="any" inputMode="decimal" value={rule.action.rounding.quantum} onChange={event => action({ rounding: { ...rule.action.rounding, quantum: Number(event.target.value) } })} /></label>
              <label className={fieldClass}>Rounding<select className={inputClass} value={rule.action.rounding.mode} onChange={event => action({ rounding: { ...rule.action.rounding, mode: event.target.value as "nearest" | "up" | "down" } })}><option value="nearest">Nearest</option><option value="down">Down</option><option value="up">Up</option></select></label>
            </div>
          </details>
          <p className="text-xs text-muted">Current rounding: {rule.action.rounding.mode} to {rule.action.rounding.quantum} {rule.action.unit}.</p>
        </fieldset>

        <fieldset className={groupClass}>
          <legend className="display px-1 text-xl">Frequency</legend>
          <label className={fieldClass}>Evaluate<select className={inputClass} value={weekly ? "weekly" : rule.action.timing} disabled={weekly} onChange={event => action({ timing: event.target.value as "weekly" | "per_exposure" })}><option value="per_exposure">After each workout</option><option value="weekly">Once per logical week</option></select></label>
          <p className="text-sm leading-6 text-muted">{weekly ? "A weekly condition always evaluates once per logical program week. Later results in that week hold." : rule.action.timing === "weekly" ? "Only the first eligible result in a logical program week changes progression. Later results in that week hold." : "Each eligible workout evaluates the rule for the next prescription."}</p>
          <p className="text-xs leading-5 text-muted">Logical week means the program’s week, even when a workout is moved to a different calendar date.</p>
        </fieldset>

        <fieldset className={groupClass}>
          <legend className="display px-1 text-xl">Missed workouts</legend>
          {(["skipPolicy", "partialPolicy"] as const).map(policy => <label key={policy} className={fieldClass}>{policy === "skipPolicy" ? "Skipped workout" : "Partial workout"}<select className={inputClass} value={rule[policy] ?? "hold"} onChange={event => update({ [policy]: event.target.value })}><option value="hold">Hold; preserve failure count</option><option value="count_failure">Count as a failed exposure</option></select></label>)}
          <p className="text-sm leading-6 text-muted">A fixed deload holds progression and the failure count before all missed-workout policies. It does not use up the week’s evaluation.</p>
          <label className="touch-target flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={!!rule.failureReset} onChange={event => update({ failureReset: event.target.checked ? { afterFailures: 3, percent: 10, rounding: { ...rule.action.rounding } } : undefined })} />Reset after repeated failures</label>
          {rule.failureReset ? <>
            <p className="text-sm text-muted">After {rule.failureReset.afterFailures} misses, reduce {rule.action.variable === "trainingMax" ? "training max" : rule.action.variable} by {rule.failureReset.percent}% and clear the failure count.</p>
            <details><summary className="touch-target cursor-pointer text-sm font-semibold">Failure reset details</summary>
              <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
                <label className={fieldClass}>Failed exposures<input className={inputClass} type="number" inputMode="numeric" value={rule.failureReset.afterFailures} onChange={event => update({ failureReset: { ...rule.failureReset!, afterFailures: Number(event.target.value) } })} /></label>
                <label className={fieldClass}>Reduce by (%)<input className={inputClass} type="number" inputMode="decimal" value={rule.failureReset.percent} onChange={event => update({ failureReset: { ...rule.failureReset!, percent: Number(event.target.value) } })} /></label>
                <label className={fieldClass}>Reset round to<input className={inputClass} type="number" step="any" inputMode="decimal" value={rule.failureReset.rounding.quantum} onChange={event => update({ failureReset: { ...rule.failureReset!, rounding: { ...rule.failureReset!.rounding, quantum: Number(event.target.value) } } })} /></label>
                <label className={fieldClass}>Reset rounding<select className={inputClass} value={rule.failureReset.rounding.mode} onChange={event => update({ failureReset: { ...rule.failureReset!, rounding: { ...rule.failureReset!.rounding, mode: event.target.value as "nearest" | "up" | "down" } } })}><option value="nearest">Nearest</option><option value="down">Down</option><option value="up">Up</option></select></label>
              </div>
            </details>
          </> : null}
        </fieldset>
      </> : null}
      {errors.length ? <div role="alert" className="rounded-xl border border-danger-line bg-danger-soft p-3"><p className="text-sm font-semibold text-danger-ink">Check the rule fields before previewing.</p>{errors.map(error => <p key={error} className="mt-1 break-words text-sm text-danger-ink">{error}</p>)}</div> : null}
      {explanation ? <details className="rounded-xl bg-surface-muted p-3"><summary className="touch-target cursor-pointer text-sm font-semibold">Full rule explanation</summary><p className="mt-2 text-sm leading-6 text-muted">{explanation}</p></details> : null}
    </div>
    <ProgressionSimulation rule={rule} sets={sets} state={state} initialReps={initialReps} unit={unit} week={week} isDeload={isDeload} />
  </section>;
}
