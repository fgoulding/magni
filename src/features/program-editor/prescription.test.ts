import { describe, expect, it } from "vitest";
import { createSet } from "./document";
import type { ProgressionRuleV1 } from "./progression";
import { resolveEditorSetPrescription } from "./prescription";

const state = { load: 42.5, trainingMax: 123.45, reps: 10, consecutiveFailures: 0, lastEvaluatedWeek: null };
const rule: ProgressionRuleV1 = { version: 1, condition: { type: "all_work_sets", target: "minimum" }, action: { variable: "reps", unit: "reps", operation: "add", amount: 1, rounding: { mode: "nearest", quantum: 1 }, timing: "per_exposure" } };

describe("shared editor prescription resolution", () => {
  it.each([
    ["working", 0, 42.5], ["percent", 63.5, 78.39075], ["fixed", 31.25, 31.25], ["added", 12.5, 12.5], ["bodyweight", 99, 0],
  ] as const)("resolves %s without changing authored values", (loadMode, load, weight) => {
    const set = { ...createSet(), loadMode, load };
    const before = structuredClone(set);
    expect(resolveEditorSetPrescription({ set, rule: null, state })).toEqual({ weight, repMin: 8, repMax: 12 });
    expect(set).toEqual(before);
  });

  it("applies the original shared rep baseline to local overrides and clamps reductions", () => {
    const set = { ...createSet(), repMin: 12, repMax: 15 };
    expect(resolveEditorSetPrescription({ set, rule, state, initialReps: 8 })).toMatchObject({ repMin: 14, repMax: 17 });
    expect(resolveEditorSetPrescription({ set, rule, state: { ...state, reps: 0 }, initialReps: 20 })).toMatchObject({ repMin: 1, repMax: 1 });
    expect(resolveEditorSetPrescription({ set: { ...set, role: "warmup" }, rule, state })).toMatchObject({ repMin: 12, repMax: 15 });
    expect(() => resolveEditorSetPrescription({ set, rule, state })).toThrow("original minimum rep target");
  });

  it("rejects nonfinite or negative working weights before they become prescriptions", () => {
    expect(() => resolveEditorSetPrescription({ set: createSet(), rule: null, state: { ...state, load: -1 } })).toThrow("nonnegative and finite");
    expect(() => resolveEditorSetPrescription({ set: { ...createSet(), loadMode: "percent", load: 200 }, rule: null, state: { ...state, trainingMax: Number.MAX_VALUE } })).toThrow("nonnegative and finite");
  });
});
