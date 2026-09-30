import type { ProgramSetV1 } from "./document";
import type { ProgressionRuleV1, ProgressionState } from "./progression";

/** Pure resolution shared by pending execution and hypothetical authoring.
 * Started sessions retain their saved prescription instead of resolving again. */
export function resolveEditorSetPrescription({ set, rule, state, initialReps }: {
  set: ProgramSetV1; rule: ProgressionRuleV1 | null; state: ProgressionState; initialReps?: number;
}): { weight: number; repMin: number; repMax: number } {
  let weight: number;
  switch (set.loadMode) {
    case "working": weight = state.load; break;
    case "percent": weight = state.trainingMax * set.load / 100; break;
    case "bodyweight": weight = 0; break;
    case "fixed": case "added": weight = set.load; break;
    default: throw new Error("The frozen prescription has an unsupported load mode.");
  }
  if (!Number.isFinite(weight) || weight < 0) throw new Error("The resolved working weight must be nonnegative and finite.");
  weight = Number(weight.toPrecision(15));
  let repMin = set.repMin;
  let repMax = set.repMax;
  if (rule?.action.variable === "reps" && set.role !== "warmup") {
    if (!Number.isSafeInteger(initialReps) || initialReps! < 1) throw new Error("Rep progression requires the exercise's original minimum rep target.");
    const delta = state.reps - initialReps!;
    repMin = Math.max(1, repMin + delta);
    repMax = Math.max(repMin, repMax + delta);
  }
  return { weight, repMin, repMax };
}
