"use client";

import { useState } from "react";
import {
  describeProgressionRule, evaluateProgression, previewProgressionScenarios, validateProgressionRule,
  type ProgressionRuleV1, type ProgressionSet, type ProgressionState,
} from "@/features/program-editor/progression";

const inputClass = "touch-target w-full rounded-xl border border-line bg-surface px-3 py-2 text-foreground outline-none focus:border-brand";

export function defaultEditorRule(unit: "lb" | "kg"): ProgressionRuleV1 {
  return { version: 1, condition: { type: "double_progression" }, action: { variable: "load", unit, operation: "add", amount: 2.5, rounding: { mode: "nearest", quantum: 2.5 }, timing: "per_exposure" }, skipPolicy: "hold", partialPolicy: "hold" };
}

type RuleEditorProps = {
  rule: ProgressionRuleV1 | null; onChange: (rule: ProgressionRuleV1 | null) => void;
  sets: ProgressionSet[]; state: ProgressionState; unit: "lb" | "kg"; week: number; isDeload: boolean;
};
export function ProgressionRuleEditor(props: RuleEditorProps) {
  const rule = props.rule;
  if (rule && (!rule.condition || !rule.action || !rule.action.rounding || (rule.failureReset && !rule.failureReset.rounding))) {
    return <section className="rounded-xl border border-danger-line bg-danger-soft p-3"><p role="alert" className="text-sm text-danger-ink">This saved progression rule is incomplete. Your other program edits are retained.</p><button className="touch-target mt-3 rounded-xl border border-line bg-surface px-3 text-sm font-semibold" onClick={() => props.onChange(null)}>Reset this rule to manual</button></section>;
  }
  return <ConfiguredRuleEditor {...props} />;
}
function ConfiguredRuleEditor({ rule, onChange, sets, state, unit, week, isDeload }: RuleEditorProps) {
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [priorFailures, setPriorFailures] = useState(0);
  const errors = validateProgressionRule(rule);
  const previewInput = { rule, sets: sets.map(set => ({ ...set, actualReps: outcomes[set.id] === "" ? null : Number(outcomes[set.id] ?? set.repMax) })), state: { ...state, consecutiveFailures: priorFailures }, week, status: "completed" as const, isDeload };
  let explanation = "";
  let result = "";
  let scenarios: ReturnType<typeof previewProgressionScenarios> = [];
  if (!errors.length) {
    try {
      explanation = describeProgressionRule(rule);
      if (rule?.condition.type === "designated_set") explanation = explanation.replace(rule.condition.setId, `Set ${sets.findIndex(set => set.id === (rule.condition as { setId: string }).setId) + 1}`);
      result = evaluateProgression(previewInput).explanation;
      scenarios = previewProgressionScenarios(previewInput);
    } catch (error) { result = error instanceof Error ? error.message : "Check the set prescriptions."; }
  }
  const update = (change: Partial<ProgressionRuleV1>) => onChange({ ...(rule ?? defaultEditorRule(unit)), ...change });
  const action = (change: Partial<ProgressionRuleV1["action"]>) => update({ action: { ...(rule ?? defaultEditorRule(unit)).action, ...change } });
  const kind = rule?.condition.type ?? "manual";
  return <section className="flex flex-col gap-3">
    <label className="flex flex-col gap-1 text-sm font-semibold">Progression condition
      <select className={inputClass} value={kind} onChange={event => {
        const value = event.target.value;
        if (value === "manual") { onChange(null); return; }
        const base = rule ?? defaultEditorRule(unit);
        const condition: ProgressionRuleV1["condition"] = value === "all_work_sets" ? { type: "all_work_sets", target: "minimum" } : value === "designated_set" ? { type: "designated_set", setId: sets.find(set => set.role === "top" || set.role === "amrap")?.id ?? "", targetReps: 12 } : value === "weekly" ? { type: "weekly" } : { type: "double_progression" };
        onChange({ ...base, condition });
      }}>
        <option value="manual">Manual — no automatic changes</option>
        <option value="all_work_sets">All work sets reach target</option>
        <option value="double_progression">Double progression — all upper targets</option>
        <option value="designated_set">Designated top or AMRAP set</option>
        <option value="weekly">Fixed weekly change</option>
      </select>
    </label>
    {rule ? <>
      {rule.condition.type === "all_work_sets" ? <label className="text-sm font-semibold">Rep target<select className={inputClass} value={rule.condition.target} onChange={event => update({ condition: { type: "all_work_sets", target: event.target.value as "minimum" | "maximum" } })}><option value="minimum">Minimum reps on every work set</option><option value="maximum">Maximum reps on every work set</option></select></label> : null}
      {rule.condition.type === "designated_set" ? <div className="grid grid-cols-2 gap-2">
        <label className="text-sm font-semibold">Target set<select className={inputClass} value={rule.condition.setId} onChange={event => update({ condition: { type: "designated_set", setId: event.target.value, targetReps: rule.condition.type === "designated_set" ? rule.condition.targetReps : 12 } })}><option value="">Choose a top / AMRAP set</option>{sets.map((set, index) => set.role === "top" || set.role === "amrap" ? <option key={set.id} value={set.id}>Set {index + 1} · {set.role}</option> : null)}</select></label>
        <label className="text-sm font-semibold">Required reps<input type="number" inputMode="numeric" className={inputClass} value={rule.condition.targetReps} onChange={event => update({ condition: { type: "designated_set", setId: rule.condition.type === "designated_set" ? rule.condition.setId : "", targetReps: Number(event.target.value) } })} /></label>
      </div> : null}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm font-semibold">Change<select className={inputClass} value={rule.action.variable} onChange={event => action({ variable: event.target.value as "load" | "trainingMax" | "reps", unit: event.target.value === "reps" ? "reps" : unit, rounding: { mode: "nearest", quantum: event.target.value === "reps" ? 1 : 2.5 } })}><option value="load">Working load ({unit})</option><option value="trainingMax">Training max ({unit})</option><option value="reps">Reps</option></select></label>
        <label className="text-sm font-semibold">Adjustment<select className={inputClass} value={rule.action.operation} onChange={event => action({ operation: event.target.value as "add" | "percent" })}><option value="add">Add {rule.action.unit}</option><option value="percent">Percent change</option></select></label>
        <label className="text-sm font-semibold">Increment ({rule.action.operation === "percent" ? "%" : rule.action.unit})<input className={inputClass} type="number" step="any" inputMode="decimal" value={rule.action.amount} onChange={event => action({ amount: Number(event.target.value) })} /></label>
      </div>
      <details><summary className="touch-target cursor-pointer text-sm font-semibold">Timing, rounding and missed workouts</summary><div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-sm font-semibold">Evaluate<select className={inputClass} value={rule.action.timing} onChange={event => action({ timing: event.target.value as "weekly" | "per_exposure" })}><option value="per_exposure">After each workout</option><option value="weekly">Once per logical week</option></select></label>
        <label className="text-sm font-semibold">Round to ({rule.action.unit})<input className={inputClass} type="number" step="any" inputMode="decimal" value={rule.action.rounding.quantum} onChange={event => action({ rounding: { ...rule.action.rounding, quantum: Number(event.target.value) } })} /></label>
        <label className="text-sm font-semibold">Rounding<select className={inputClass} value={rule.action.rounding.mode} onChange={event => action({ rounding: { ...rule.action.rounding, mode: event.target.value as "nearest" | "up" | "down" } })}><option value="nearest">Nearest</option><option value="down">Down</option><option value="up">Up</option></select></label>
        {(["skipPolicy", "partialPolicy"] as const).map(policy => <label key={policy} className="text-sm font-semibold">{policy === "skipPolicy" ? "Skipped workout" : "Partial workout"}<select className={inputClass} value={rule[policy] ?? "hold"} onChange={event => update({ [policy]: event.target.value })}><option value="hold">Hold; preserve failure count</option><option value="count_failure">Count as a failed exposure</option></select></label>)}
      </div>
      <label className="touch-target flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={!!rule.failureReset} onChange={event => update({ failureReset: event.target.checked ? { afterFailures: 3, percent: 10, rounding: { ...rule.action.rounding } } : undefined })} />Reset after repeated failures</label>
      {rule.failureReset ? <div className="grid grid-cols-2 gap-2"><label className="text-sm font-semibold">Failed exposures<input className={inputClass} type="number" inputMode="numeric" value={rule.failureReset.afterFailures} onChange={event => update({ failureReset: { ...rule.failureReset!, afterFailures: Number(event.target.value) } })} /></label><label className="text-sm font-semibold">Reduce by (%)<input className={inputClass} type="number" inputMode="decimal" value={rule.failureReset.percent} onChange={event => update({ failureReset: { ...rule.failureReset!, percent: Number(event.target.value) } })} /></label><label className="text-sm font-semibold">Reset round to<input className={inputClass} type="number" step="any" inputMode="decimal" value={rule.failureReset.rounding.quantum} onChange={event => update({ failureReset: { ...rule.failureReset!, rounding: { ...rule.failureReset!.rounding, quantum: Number(event.target.value) } } })} /></label><label className="text-sm font-semibold">Reset rounding<select className={inputClass} value={rule.failureReset.rounding.mode} onChange={event => update({ failureReset: { ...rule.failureReset!, rounding: { ...rule.failureReset!.rounding, mode: event.target.value as "nearest" | "up" | "down" } } })}><option value="nearest">Nearest</option><option value="down">Down</option><option value="up">Up</option></select></label></div> : null}
      </details>
    </> : null}
    {errors.map(error => <p key={error} className="text-sm text-danger-ink">{error}</p>)}
    {explanation ? <p className="rounded-xl bg-surface-muted p-3 text-sm leading-6 text-muted">{explanation}</p> : null}
    <div className="card flex flex-col gap-3 p-3">
      <h3 className="display text-xl">Preview results</h3>
      <p className="text-sm text-muted">Hypothetical outcomes. These use the same evaluator as workout completion.</p>
      {rule?.failureReset ? <label className="text-sm font-semibold">Prior failed exposures (hypothetical)<input className={inputClass} type="number" min="0" inputMode="numeric" value={priorFailures} onChange={event => setPriorFailures(Number(event.target.value))} /></label> : null}
      <div className="grid grid-cols-3 gap-2">{sets.map((set, index) => set.role === "warmup" ? null : <label key={set.id} className="text-sm font-semibold">Set {index + 1} reps<input className={inputClass} type="number" min="0" inputMode="numeric" placeholder="Unlogged" value={outcomes[set.id] ?? set.repMax} onChange={event => setOutcomes({ ...outcomes, [set.id]: event.target.value })} /></label>)}</div>
      <p role="status" aria-label="Progression preview result" className="text-sm font-semibold leading-6 text-brand-strong">{result}</p>
      <details><summary className="touch-target cursor-pointer text-sm font-semibold">Success, miss, partial and skip scenarios</summary><div className="flex flex-col gap-3 pt-2">{scenarios.map(scenario => <p key={scenario.scenario} className="text-sm text-muted"><strong className="capitalize text-foreground">{scenario.scenario}: </strong>{scenario.result.explanation}</p>)}</div></details>
    </div>
  </section>;
}
