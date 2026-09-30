import type { DocumentIssue, ProgramDocumentV1, ProgramSetV1 } from "./document";
import { evaluateProgression, validateProgressionRule, type ProgressionInput, type ProgressionResult, type ProgressionRuleV1, type ProgressionState } from "./progression";
import { resolveEditorSetPrescription } from "./prescription";

export const PROGRESSION_RULE_PRESETS = [
  { id: "manual", title: "Manual", description: "Keep loads and rep targets unchanged." },
  { id: "all-set", title: "All-set linear", description: "Add load when every work set reaches its minimum." },
  { id: "double", title: "Double progression", description: "Add load when every work set reaches its upper target." },
  { id: "top", title: "Top or AMRAP set", description: "Use a designated top or AMRAP set's rep target." },
  { id: "weekly", title: "Weekly training max", description: "Increase the training max once per logical week." },
  { id: "reset", title: "Repeated-failure reset", description: "All-set progression with a 10% reset after three misses." },
] as const;
export type ProgressionRulePresetId = typeof PROGRESSION_RULE_PRESETS[number]["id"];
export type ProgressionAppearance = {
  weekId: string; weekName: string; weekIndex: number;
  dayId: string; dayName: string; dayIndex: number;
  exerciseId: string; exerciseName: string; exerciseIndex: number; path: string;
};
export type ProgressionGroup = { progressionKey: string; name: string; appearances: ProgressionAppearance[] };
export type ProgressionRuleCopyPreview = { sourceExerciseId: string; groups: ProgressionGroup[]; appearanceCount: number; issues: DocumentIssue[] };
export type ProgressionSimulationStep = {
  week: number; status: ProgressionInput["status"]; isDeload?: boolean;
  actualReps: Record<string, number | null>;
};
export type ProgressionSimulationInput = {
  rule: ProgressionRuleV1 | null; sets: readonly ProgramSetV1[]; state: ProgressionState;
  initialReps?: number; steps: readonly ProgressionSimulationStep[];
};
export type ProgressionSimulationResult = {
  hypothetical: true; index: number; input: ProgressionInput; result: ProgressionResult;
  prescription: { setId: string; repMin: number; repMax: number; weight: number }[];
};
export const MAX_PROGRESSION_SIMULATION_STEPS = 12;
export class ProgressionAuthoringError extends Error {
  constructor(public issues: DocumentIssue[]) {
    super(issues.map(issue => `${issue.path}: ${issue.message}`).join(" "));
    this.name = "ProgressionAuthoringError";
  }
}

export function makeProgressionRulePreset(id: ProgressionRulePresetId, { unit, sets, targetSetId }: { unit: "lb" | "kg"; sets: readonly ProgramSetV1[]; targetSetId?: string }): ProgressionRuleV1 | null {
  if (!PROGRESSION_RULE_PRESETS.some(preset => preset.id === id)) throw new ProgressionAuthoringError([{ path: "preset", message: "Choose a supported progression preset." }]);
  if (unit !== "lb" && unit !== "kg") throw new ProgressionAuthoringError([{ path: "unit", message: "Choose lb or kg." }]);
  if (id === "manual") return null;
  const rule: ProgressionRuleV1 = {
    version: 1, condition: { type: "all_work_sets", target: "minimum" },
    action: { variable: "load", unit, operation: "add", amount: 2.5, rounding: { mode: "nearest", quantum: 2.5 }, timing: "per_exposure" },
    skipPolicy: "hold", partialPolicy: "hold",
  };
  if (id === "double") rule.condition = { type: "double_progression" };
  if (id === "top") {
    const target = targetSetId ? sets.find(set => set.id === targetSetId) : sets.find(set => set.role === "top" || set.role === "amrap");
    if (!target || (target.role !== "top" && target.role !== "amrap")) throw new ProgressionAuthoringError([{ path: "rule.condition.setId", message: "Choose an existing top or AMRAP set before applying this preset." }]);
    rule.condition = { type: "designated_set", setId: target.id, targetReps: target.repMax };
  }
  if (id === "weekly") {
    rule.condition = { type: "weekly" };
    rule.action = { ...rule.action, variable: "trainingMax", amount: 5, timing: "weekly" };
  }
  if (id === "reset") rule.failureReset = { afterFailures: 3, percent: 10, rounding: { mode: "down", quantum: 2.5 } };
  const issues = validateProgressionRule(rule).map(message => ({ path: "rule", message }));
  if (issues.length) throw new ProgressionAuthoringError(issues);
  return rule;
}

function appearances(document: ProgramDocumentV1) {
  return document.weeks.flatMap((week, weekIndex) => week.days.flatMap((day, dayIndex) => day.exercises.map((exercise, exerciseIndex) => ({
    exercise,
    appearance: {
      weekId: week.id, weekName: week.name, weekIndex, dayId: day.id, dayName: day.name, dayIndex,
      exerciseId: exercise.id, exerciseName: exercise.name, exerciseIndex, path: `weeks.${weekIndex}.days.${dayIndex}.exercises.${exerciseIndex}`,
    } satisfies ProgressionAppearance,
  }))));
}
export function listProgressionGroups(document: ProgramDocumentV1): ProgressionGroup[] {
  const groups = new Map<string, ProgressionGroup>();
  for (const { exercise, appearance } of appearances(document)) {
    const group = groups.get(exercise.progressionKey) ?? { progressionKey: exercise.progressionKey, name: exercise.name, appearances: [] };
    group.appearances.push(appearance);
    groups.set(exercise.progressionKey, group);
  }
  return [...groups.values()];
}

function planRuleCopy(document: ProgramDocumentV1, sourceExerciseId: string, targetProgressionKeys: readonly string[]) {
  const rows = appearances(document);
  const sources = rows.filter(row => row.exercise.id === sourceExerciseId);
  const keys = new Set(targetProgressionKeys);
  const groups = listProgressionGroups(document).filter(group => keys.has(group.progressionKey));
  const issues: DocumentIssue[] = [];
  const changes: { appearance: ProgressionAppearance; rule: ProgressionRuleV1 | null }[] = [];
  const preview: ProgressionRuleCopyPreview = { sourceExerciseId, groups, appearanceCount: groups.reduce((count, group) => count + group.appearances.length, 0), issues };
  if (sources.length !== 1) {
    issues.push({ path: "sourceExerciseId", message: "Choose one existing source exercise with a unique identity." });
    return { preview, changes };
  }
  const source = sources[0].exercise;
  const sourcePath = sources[0].appearance.path;
  if (!keys.size) issues.push({ path: "targetProgressionKeys", message: "Select at least one other progression group." });
  if (keys.has(source.progressionKey)) issues.push({ path: "targetProgressionKeys", message: "Choose other progression groups; the source group is already configured." });
  for (const key of keys) if (!groups.some(group => group.progressionKey === key)) issues.push({ path: "targetProgressionKeys", message: `Progression group ${key} no longer exists. Select the targets again.` });
  issues.push(...validateProgressionRule(source.rule).map(message => ({ path: `${sourcePath}.rule`, message })));
  if (issues.length) return { preview, changes };
  if (source.rule && source.rule.action.variable !== "reps" && source.rule.action.unit !== document.unit) {
    issues.push({ path: `${sourcePath}.rule.action.unit`, message: "Progression units must match the program; copying does not convert units." });
    return { preview, changes };
  }
  const condition = source.rule?.condition;
  const designated = condition?.type === "designated_set" ? source.sets.find(set => set.id === condition.setId) : undefined;
  if (condition?.type === "designated_set" && (!designated || (designated.role !== "top" && designated.role !== "amrap"))) {
    issues.push({ path: `${sourcePath}.rule.condition.setId`, message: "The source must designate an existing top or AMRAP set." });
    return { preview, changes };
  }
  const ordinal = designated ? source.sets.filter(set => set.role === designated.role).findIndex(set => set.id === designated.id) : -1;
  for (const { exercise, appearance } of rows) {
    if (!keys.has(exercise.progressionKey)) continue;
    const rule = structuredClone(source.rule);
    if (rule?.condition.type === "designated_set") {
      const target = exercise.sets.filter(set => set.role === designated!.role)[ordinal];
      if (!target) {
        issues.push({ path: `${appearance.path}.rule.condition.setId`, message: `${appearance.weekName} / ${appearance.dayName} / ${appearance.exerciseName} needs ${designated!.role} set ${ordinal + 1}. Add that set or choose a different rule.` });
        continue;
      }
      rule.condition.setId = target.id;
    }
    changes.push({ appearance, rule });
  }
  return { preview, changes };
}
export function previewProgressionRuleCopy(document: ProgramDocumentV1, sourceExerciseId: string, targetProgressionKeys: readonly string[]): ProgressionRuleCopyPreview {
  return planRuleCopy(document, sourceExerciseId, targetProgressionKeys).preview;
}

/** Preflight every appearance before changing a cloned draft. Never share state,
 * copy starting values, or silently omit an incompatible selected appearance. */
export function copyProgressionRule(document: ProgramDocumentV1, sourceExerciseId: string, targetProgressionKeys: readonly string[]): ProgramDocumentV1 {
  const { preview, changes } = planRuleCopy(document, sourceExerciseId, targetProgressionKeys);
  if (preview.issues.length) throw new ProgressionAuthoringError(preview.issues);
  const copied = structuredClone(document);
  for (const { appearance, rule } of changes) copied.weeks[appearance.weekIndex].days[appearance.dayIndex].exercises[appearance.exerciseIndex].rule = rule;
  return copied;
}

/** Repeats the selected authored prescriptions, not the program's later weeks.
 * User-entered results stay literal while each new prescription resolves from
 * the carried state. No database, clocks, or saved progression are involved. */
export function simulateProgressionSequence({ rule, sets, state, initialReps, steps }: ProgressionSimulationInput): ProgressionSimulationResult[] {
  if (steps.length > MAX_PROGRESSION_SIMULATION_STEPS) throw new ProgressionAuthoringError([{ path: "steps", message: `Use at most ${MAX_PROGRESSION_SIMULATION_STEPS} hypothetical workouts.` }]);
  const issues = validateProgressionRule(rule).map(message => ({ path: "rule", message }));
  if (issues.length) throw new ProgressionAuthoringError(issues);
  try {
    evaluateProgression({ rule: null, state, sets: sets.map(set => ({ ...set, actualReps: null })), week: 1, status: "completed" });
  } catch (error) {
    throw new ProgressionAuthoringError([{ path: "simulation", message: error instanceof Error ? error.message : "Review the starting state and prescriptions." }]);
  }
  const baseline = initialReps ?? sets.find(set => set.role !== "warmup")?.repMin ?? sets[0]?.repMin;
  const setIds = new Set(sets.map(set => set.id));
  let currentState = structuredClone(state);
  return steps.map((step, index) => {
    try {
      if (Object.keys(step.actualReps).some(id => !setIds.has(id))) throw new Error("A result refers to a set that is no longer in this exercise.");
      const prescription = sets.map(set => ({ setId: set.id, ...resolveEditorSetPrescription({ set, rule, state: currentState, initialReps: baseline }) }));
      const input: ProgressionInput = {
        rule: structuredClone(rule), state: structuredClone(currentState), week: step.week, status: step.status, isDeload: step.isDeload,
        sets: sets.map((set, setIndex) => ({ id: set.id, role: set.role, repMin: prescription[setIndex].repMin, repMax: prescription[setIndex].repMax, actualReps: step.actualReps[set.id] ?? null })),
      };
      const result = evaluateProgression(input);
      currentState = structuredClone(result.nextState);
      return { hypothetical: true as const, index, input, result, prescription };
    } catch (error) {
      throw new ProgressionAuthoringError([{ path: `steps.${index}`, message: error instanceof Error ? error.message : "Review this hypothetical workout." }]);
    }
  });
}
