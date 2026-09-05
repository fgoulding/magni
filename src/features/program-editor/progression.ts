/** Versioned, JSON-serializable progression. Keep v1 semantics stable for saved definitions. */
export type ProgressionSetRole = "warmup" | "work" | "top" | "backoff" | "amrap";
export type ProgressionVariable = "load" | "trainingMax" | "reps";
export type ProgressionUnit = "lb" | "kg" | "reps";
export type ProgressionPolicy = "hold" | "count_failure";
export type ProgressionRounding = { mode: "nearest" | "down" | "up"; quantum: number };
export type ProgressionCondition =
  | { type: "all_work_sets"; target: "minimum" | "maximum" }
  | { type: "double_progression" }
  | { type: "designated_set"; setId: string; targetReps: number }
  | { type: "weekly" };
export type ProgressionAction = {
  variable: ProgressionVariable;
  unit: ProgressionUnit;
  operation: "add" | "percent";
  amount: number;
  rounding: ProgressionRounding;
  timing: "per_exposure" | "weekly";
};
export type ProgressionRuleV1 = {
  version: 1;
  condition: ProgressionCondition;
  action: ProgressionAction;
  skipPolicy?: ProgressionPolicy;
  partialPolicy?: ProgressionPolicy;
  /** A percentage reduction of action.variable; the counter clears after a reset. */
  failureReset?: { afterFailures: number; percent: number; rounding: ProgressionRounding };
};
export type ProgressionSet = {
  id: string;
  role: ProgressionSetRole;
  repMin: number;
  repMax: number;
  /** null means unperformed; zero means performed with no successful repetitions. */
  actualReps: number | null;
};
export type ProgressionState = {
  load: number;
  trainingMax: number;
  reps: number;
  consecutiveFailures: number;
  lastEvaluatedWeek: number | null;
};
export type ProgressionInput = {
  rule: ProgressionRuleV1 | null;
  state: ProgressionState;
  sets: readonly ProgressionSet[];
  status: "completed" | "partial" | "skipped";
  /** Logical program week, never derived from a moved workout's calendar date. */
  week: number;
  isDeload?: boolean;
};
export type ProgressionReason =
  | "manual" | "fixed_deload" | "skipped" | "partial" | "no_work_sets"
  | "missing_target_set" | "already_evaluated_week" | "target_missed"
  | "within_rep_range" | "success" | "rounded_unchanged" | "failure_reset";
export type ProgressionResult = {
  outcome: "advance" | "hold" | "reset";
  reason: ProgressionReason;
  explanation: string;
  nextState: ProgressionState;
};
export type ProgressionScenario = {
  scenario: "success" | "miss" | "partial" | "skipped";
  hypothetical: true;
  input: ProgressionInput;
  result: ProgressionResult;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function isNonnegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isSafeInteger(value) && value >= 0;
}
function isPositiveInteger(value: unknown): value is number {
  return isNonnegativeInteger(value) && value > 0;
}
function roundingErrors(value: unknown, field: string, reps: boolean): string[] {
  if (!isRecord(value)) return [`${field} must specify mode and quantum.`];
  const errors: string[] = [];
  if (value.mode !== "nearest" && value.mode !== "down" && value.mode !== "up") errors.push(`${field}.mode must be nearest, down, or up.`);
  if (!isFiniteNumber(value.quantum) || value.quantum <= 0) errors.push(`${field}.quantum must be positive and finite.`);
  else if (reps && !isPositiveInteger(value.quantum)) errors.push(`${field}.quantum must be an integer for reps.`);
  return errors;
}

/** Validate at the editor/API boundary as well as immediately before evaluation. */
export function validateProgressionRule(rule: unknown): string[] {
  if (rule === null) return [];
  if (!isRecord(rule)) return ["Rule must be a versioned object or null for manual progression."];
  const errors: string[] = [];
  if (rule.version !== 1) errors.push("Rule version must be 1.");
  const condition = rule.condition;
  if (!isRecord(condition)) errors.push("Rule condition is required.");
  else {
    switch (condition.type) {
      case "all_work_sets":
        if (condition.target !== "minimum" && condition.target !== "maximum") errors.push("condition.target must be minimum or maximum.");
        break;
      case "designated_set":
        if (typeof condition.setId !== "string" || !condition.setId.trim()) errors.push("condition.setId is required.");
        if (!isPositiveInteger(condition.targetReps)) errors.push("condition.targetReps must be a positive integer.");
        break;
      case "double_progression":
      case "weekly":
        break;
      default: errors.push("Unsupported condition type.");
    }
  }
  const action = rule.action;
  if (!isRecord(action)) errors.push("Rule action is required.");
  else {
    if (action.variable !== "load" && action.variable !== "trainingMax" && action.variable !== "reps") errors.push("action.variable must be load, trainingMax, or reps.");
    if (action.variable === "reps" ? action.unit !== "reps" : action.unit !== "lb" && action.unit !== "kg") {
      errors.push("action.unit must be reps for a reps action, or lb/kg for a load/trainingMax action.");
    }
    if (action.operation !== "add" && action.operation !== "percent") errors.push("action.operation must be add or percent.");
    if (!isFiniteNumber(action.amount) || (action.operation === "percent" && action.amount < -100)) errors.push("action.amount must be finite and percentage changes cannot be below -100%.");
    else if (action.variable === "reps" && action.operation === "add" && !Number.isSafeInteger(action.amount)) errors.push("action.amount must be an integer when adding reps.");
    errors.push(...roundingErrors(action.rounding, "action.rounding", action.variable === "reps"));
    if (action.timing !== "per_exposure" && action.timing !== "weekly") errors.push("action.timing must be per_exposure or weekly.");
  }
  for (const policy of ["skipPolicy", "partialPolicy"]) {
    if (rule[policy] !== undefined && rule[policy] !== "hold" && rule[policy] !== "count_failure") errors.push(`${policy} must be hold or count_failure.`);
  }
  if (rule.failureReset !== undefined) {
    const reset = rule.failureReset;
    if (!isRecord(reset)) errors.push("failureReset must specify afterFailures, percent, and rounding.");
    else {
      if (!isPositiveInteger(reset.afterFailures)) errors.push("failureReset.afterFailures must be a positive integer.");
      if (!isFiniteNumber(reset.percent) || reset.percent <= 0 || reset.percent > 100) errors.push("failureReset.percent must be greater than 0 and at most 100.");
      errors.push(...roundingErrors(reset.rounding, "failureReset.rounding", isRecord(action) && action.variable === "reps"));
    }
  }
  return errors;
}

function validateInput(input: ProgressionInput): void {
  const errors = validateProgressionRule(input.rule);
  for (const variable of ["load", "trainingMax"] as const) {
    if (!isFiniteNumber(input.state[variable]) || input.state[variable] < 0) errors.push(`state.${variable} must be nonnegative and finite.`);
  }
  for (const variable of ["reps", "consecutiveFailures"] as const) {
    if (!isNonnegativeInteger(input.state[variable])) errors.push(`state.${variable} must be a nonnegative integer.`);
  }
  if (input.state.lastEvaluatedWeek !== null && !isPositiveInteger(input.state.lastEvaluatedWeek)) errors.push("state.lastEvaluatedWeek must be null or a positive integer.");
  if (!isPositiveInteger(input.week)) errors.push("week must be a positive logical program week.");
  if (!["completed", "partial", "skipped"].includes(input.status)) errors.push("status must be completed, partial, or skipped.");
  if (input.isDeload !== undefined && typeof input.isDeload !== "boolean") errors.push("isDeload must be a boolean.");
  const ids = new Set<string>();
  for (const set of input.sets) {
    if (typeof set.id !== "string" || !set.id.trim()) errors.push("Each set id is required.");
    if (ids.has(set.id)) errors.push("Set ids must be unique within an exercise.");
    ids.add(set.id);
    if (!["warmup", "work", "top", "backoff", "amrap"].includes(set.role)) errors.push(`Set ${set.id} role is invalid.`);
    if (!isPositiveInteger(set.repMin)) errors.push(`Set ${set.id} repMin must be a positive integer.`);
    if (!isPositiveInteger(set.repMax) || set.repMax < set.repMin) errors.push(`Set ${set.id} repMax must be an integer at least repMin.`);
    if (set.actualReps !== null && !isNonnegativeInteger(set.actualReps)) errors.push(`Set ${set.id} actualReps must be null or a nonnegative integer.`);
  }
  if (errors.length) throw new Error(errors.join(" "));
}

function rounded(value: number, rounding: ProgressionRounding): number {
  const scaled = Math.max(0, value) / rounding.quantum;
  // Decimal plate sizes can produce 42.99999999999999; snap exact grid points first.
  const closest = Math.round(scaled);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  const stable = Math.abs(scaled - closest) <= tolerance ? closest : scaled;
  const units = rounding.mode === "down" ? Math.floor(stable) : rounding.mode === "up" ? Math.ceil(stable) : Math.round(stable);
  const result = Number((units * rounding.quantum).toPrecision(15));
  if (!Number.isFinite(result)) throw new Error("Progression result must be finite; reduce the amount or rounding precision.");
  return result;
}

/**
 * No I/O, clocks, or shared state. Callers own progression sharing and must persist
 * the decision transactionally once per occurrence; per-exposure retry identity
 * cannot be inferred from training results alone.
 *
 * Precedence: manual/fixed deload → target availability → skip/partial policies
 * → weekly gate → success/range/miss → repeated-failure reset or success action.
 */
export function evaluateProgression(input: ProgressionInput): ProgressionResult {
  validateInput(input);
  const { rule, state } = input;
  const hold = (reason: ProgressionReason, explanation: string, nextState = state): ProgressionResult => ({
    outcome: "hold", reason, explanation, nextState: { ...nextState },
  });
  if (!rule) return hold("manual", "Manual progression: keep the current load, training max, reps, and failure count.");
  if (input.isDeload) return hold("fixed_deload", "Fixed deload: keep progression and the failure count unchanged; this takes precedence over all result policies.");

  const workSets = input.sets.filter((set) => set.role !== "warmup");
  const condition = rule.condition;
  const designatedSet = condition.type === "designated_set"
    ? workSets.find((set) => set.id === condition.setId && (set.role === "top" || set.role === "amrap"))
    : undefined;
  if (condition.type === "designated_set" && !designatedSet) return hold("missing_target_set", "The designated top/AMRAP set is missing. Keep progression unchanged until the target is corrected.");
  if (!workSets.length) return hold("no_work_sets", "There are no work sets to evaluate; keep progression unchanged.");

  const effectiveStatus = input.status === "skipped" ? "skipped"
    : input.status === "partial" || workSets.some((set) => set.actualReps === null) ? "partial" : "completed";
  if (effectiveStatus === "skipped" && (rule.skipPolicy ?? "hold") === "hold") return hold("skipped", "Skipped exposure: the configured policy holds progression and the failure count.");
  if (effectiveStatus === "partial" && (rule.partialPolicy ?? "hold") === "hold") return hold("partial", "Partial exposure: the configured policy holds progression and the failure count. Unlogged sets are not failures.");

  const weekly = rule.action.timing === "weekly" || condition.type === "weekly";
  if (weekly && state.lastEvaluatedWeek !== null && state.lastEvaluatedWeek >= input.week) return hold("already_evaluated_week", "This logical week or a later week has already been evaluated. Keep progression unchanged.");
  const evaluatedState: ProgressionState = { ...state, lastEvaluatedWeek: Math.max(state.lastEvaluatedWeek ?? 0, input.week) };

  let success = false;
  let inRange = false;
  if (effectiveStatus === "completed") {
    switch (condition.type) {
      case "weekly": success = true; break;
      case "designated_set": success = designatedSet!.actualReps! >= condition.targetReps; break;
      case "all_work_sets": success = workSets.every((set) => set.actualReps! >= (condition.target === "minimum" ? set.repMin : set.repMax)); break;
      case "double_progression":
        success = workSets.every((set) => set.actualReps! >= set.repMax);
        inRange = !success && workSets.every((set) => set.actualReps! >= set.repMin);
        break;
    }
  }
  if (inRange) return hold("within_rep_range", "Every work set reached its minimum, but at least one has not reached its upper rep target. Hold the configured value and clear the failure streak.", { ...evaluatedState, consecutiveFailures: 0 });

  const variable = rule.action.variable;
  const variableName = variable === "trainingMax" ? "training max" : variable;
  if (!success) {
    const failures = state.consecutiveFailures + 1;
    const reset = rule.failureReset;
    if (reset && failures >= reset.afterFailures) {
      // Rounding a reduction up may land above an off-grid current value; a reset never increases it.
      const nextValue = Math.min(state[variable], rounded(state[variable] * (1 - reset.percent / 100), reset.rounding));
      return {
        outcome: "reset", reason: "failure_reset",
        explanation: `${failures} consecutive failed exposures: reduce ${variableName} by ${reset.percent}%, rounded ${reset.rounding.mode} to ${reset.rounding.quantum} ${rule.action.unit}. Next ${variableName}: ${nextValue} ${rule.action.unit}. The failure count resets to 0.`,
        nextState: { ...evaluatedState, [variable]: nextValue, consecutiveFailures: 0 },
      };
    }
    const reason = effectiveStatus === "completed" ? "target_missed" : effectiveStatus;
    return hold(reason, `${effectiveStatus === "completed" ? "The configured rep target was missed" : `${effectiveStatus === "skipped" ? "Skipped" : "Partial"} exposure counts as a failure under this rule`}. Hold ${variableName}; consecutive failures: ${failures}${reset ? ` of ${reset.afterFailures} before a reset` : ""}.`, { ...evaluatedState, consecutiveFailures: failures });
  }

  const action = rule.action;
  const raw = action.operation === "add" ? state[variable] + action.amount : state[variable] * (1 + action.amount / 100);
  const nextValue = rounded(raw, action.rounding);
  const nextState = { ...evaluatedState, [variable]: nextValue, consecutiveFailures: 0 };
  if (nextValue === state[variable]) return hold("rounded_unchanged", `The condition succeeded; the configured action and rounding leave ${variableName} at ${nextValue} ${action.unit}. The failure count resets to 0.`, nextState);
  return {
    outcome: "advance", reason: "success", nextState,
    explanation: `${condition.type === "weekly" ? "The first eligible exposure of this logical week is complete" : "The configured rep condition succeeded"}. ${variableName === "training max" ? "Training max" : variableName === "load" ? "Load" : "Reps"} changes from ${state[variable]} to ${nextValue} ${action.unit}; the failure count resets to 0.`,
  };
}

/** Readable, complete explanation for the persisted v1 rule, not a second evaluator. */
export function describeProgressionRule(rule: ProgressionRuleV1 | null): string {
  const errors = validateProgressionRule(rule);
  if (errors.length) throw new Error(errors.join(" "));
  if (!rule) return "Manual progression: edit load, training max, or reps yourself. Results do not automatically change them.";
  const condition = rule.condition;
  let when: string;
  switch (condition.type) {
    case "all_work_sets": when = `When every non-warmup set reaches its own ${condition.target} rep target`; break;
    case "double_progression": when = "When every non-warmup set reaches its own upper rep target"; break;
    case "designated_set": when = `When the designated top/AMRAP set “${condition.setId}” reaches ${condition.targetReps} reps`; break;
    case "weekly": when = "On the first complete exposure of each logical program week, regardless of rep targets"; break;
  }
  const action = rule.action;
  const variable = action.variable === "trainingMax" ? "training max" : action.variable;
  const amount = action.operation === "percent" ? `${action.amount}% (${action.unit})` : `${action.amount} ${action.unit}`;
  const weekly = action.timing === "weekly" || condition.type === "weekly";
  const sentences = [
    `${when}, change ${variable} by ${amount}, rounded ${action.rounding.mode} to ${action.rounding.quantum} ${action.unit}.`,
    weekly ? "Evaluate once per logical week, using its first eligible result; later results in that week hold." : "Evaluate after each eligible exposure.",
    condition.type === "double_progression" ? "Results within every rep range hold and clear the failure streak; a result below any minimum counts as a failure." : condition.type === "weekly" ? "The weekly change is independent of achieved reps." : "A missed target holds the value and counts as a failure.",
    `Skipped exposures ${(rule.skipPolicy ?? "hold") === "hold" ? "hold the value and failure count" : "count as failures"}.`,
    `Partial exposures ${(rule.partialPolicy ?? "hold") === "hold" ? "hold the value and failure count" : "count as failures"}; unlogged sets are partial, not performed zero-rep sets.`,
  ];
  if (rule.failureReset) {
    const reset = rule.failureReset;
    sentences.push(`After ${reset.afterFailures} consecutive failed exposures, reduce ${variable} by ${reset.percent}%, rounded ${reset.rounding.mode} to ${reset.rounding.quantum} ${action.unit}, and clear the failure count.`);
  }
  sentences.push("A fixed deload holds the value and failure count before all other policies, and does not consume a weekly evaluation. Changes affect the next prescription.");
  return sentences.join(" ");
}

/** Each hypothetical result is computed by the same function used for completion. */
export function previewProgressionScenarios(input: ProgressionInput): ProgressionScenario[] {
  validateInput(input);
  const condition = input.rule?.condition;
  const successSets = input.sets.map((set): ProgressionSet => ({
    ...set,
    actualReps: condition?.type === "designated_set" && condition.setId === set.id
      ? condition.targetReps : condition?.type === "all_work_sets" && condition.target === "minimum" ? set.repMin : set.repMax,
  }));
  const targetIndex = successSets.findIndex((set) => condition?.type === "designated_set" ? set.id === condition.setId : set.role !== "warmup");
  return (["success", "miss", "partial", "skipped"] as const).map((scenario) => {
    const scenarioSets = successSets.map((set, index): ProgressionSet => {
      if (scenario === "skipped") return { ...set, actualReps: null };
      if (index !== targetIndex) return { ...set };
      if (scenario === "partial") return { ...set, actualReps: null };
      if (scenario === "miss") {
        const target = condition?.type === "designated_set" ? condition.targetReps
          : condition?.type === "all_work_sets" && condition.target === "maximum" ? set.repMax : set.repMin;
        return { ...set, actualReps: target - 1 };
      }
      return { ...set };
    });
    const scenarioInput: ProgressionInput = {
      ...input, state: { ...input.state }, sets: scenarioSets,
      status: scenario === "partial" || scenario === "skipped" ? scenario : "completed",
    };
    return { scenario, hypothetical: true, input: scenarioInput, result: evaluateProgression(scenarioInput) };
  });
}
