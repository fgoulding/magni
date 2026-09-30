import { describe, expect, it } from "vitest";
import { createBlankDocument, createDay, createExercise, createSet, createWeek } from "./document";
import { cloneExercise } from "./operations";
import type { ProgressionRuleV1, ProgressionState } from "./progression";
import {
  copyProgressionRule, listProgressionGroups, makeProgressionRulePreset,
  previewProgressionRuleCopy, simulateProgressionSequence,
} from "./progression-authoring";

const state = (): ProgressionState => ({ load: 40, trainingMax: 100, reps: 8, consecutiveFailures: 0, lastEvaluatedWeek: null });
function fixture() {
  const document = createBlankDocument();
  const source = createExercise("Squat");
  source.rule = makeProgressionRulePreset("double", { unit: "lb", sets: source.sets });
  const target = createExercise("Row");
  target.baseLoad = 65; target.trainingMax = 155;
  const repeated = cloneExercise(target);
  document.weeks[0].days[0].exercises = [source, target];
  document.weeks.push({ ...createWeek("Week 2"), days: [{ ...createDay("Day B"), exercises: [repeated] }] });
  return { document, source, target, repeated };
}

describe("progression rule presets", () => {
  it.each(["lb", "kg"] as const)("creates independent v1 presets in %s without changing prescriptions", unit => {
    const exercise = createExercise("Lift");
    exercise.sets[1].role = "top";
    const before = structuredClone(exercise);
    for (const id of ["all-set", "double", "top", "weekly", "reset"] as const) {
      const rule = makeProgressionRulePreset(id, { unit, sets: exercise.sets });
      expect(rule).toMatchObject({ version: 1, action: { unit }, skipPolicy: "hold", partialPolicy: "hold" });
    }
    expect(makeProgressionRulePreset("manual", { unit, sets: exercise.sets })).toBeNull();
    expect(exercise).toEqual(before);
    const first = makeProgressionRulePreset("reset", { unit, sets: exercise.sets })!;
    first.action.amount = 99;
    expect(makeProgressionRulePreset("reset", { unit, sets: exercise.sets })!.action.amount).toBe(2.5);
  });

  it("requires a real eligible top/AMRAP target and uses its own rep target", () => {
    const sets = [createSet(), { ...createSet(), role: "amrap" as const, repMax: 15 }];
    expect(makeProgressionRulePreset("top", { unit: "lb", sets })).toMatchObject({ condition: { type: "designated_set", setId: sets[1].id, targetReps: 15 } });
    expect(() => makeProgressionRulePreset("top", { unit: "lb", sets, targetSetId: sets[0].id })).toThrow(/top|AMRAP/);
    expect(() => makeProgressionRulePreset("top", { unit: "lb", sets: [sets[0]] })).toThrow(/top|AMRAP/);
  });
});

describe("copying rule configuration without linking progression", () => {
  it("lists every appearance and copies only the rule to the full selected group", () => {
    const { document, source, target, repeated } = fixture();
    const before = structuredClone(document);
    const groups = listProgressionGroups(document);
    expect(groups).toHaveLength(2);
    expect(groups[1]).toMatchObject({ progressionKey: target.progressionKey, name: "Row", appearances: [
      { exerciseId: target.id, path: "weeks.0.days.0.exercises.1", weekName: "Week 1" },
      { exerciseId: repeated.id, path: "weeks.1.days.0.exercises.0", weekName: "Week 2" },
    ] });
    const preview = previewProgressionRuleCopy(document, source.id, [target.progressionKey, target.progressionKey]);
    expect(preview.issues).toEqual([]);
    expect(preview.appearanceCount).toBe(2);
    const copied = copyProgressionRule(document, source.id, [target.progressionKey]);
    for (const exercise of [copied.weeks[0].days[0].exercises[1], copied.weeks[1].days[0].exercises[0]]) {
      const original = exercise.id === target.id ? target : repeated;
      expect(exercise).toEqual({ ...original, rule: source.rule });
      expect(exercise.progressionKey).not.toBe(source.progressionKey);
    }
    expect(copied.weeks[0].days[0].exercises[0]).toEqual(source);
    copied.weeks[0].days[0].exercises[1].rule!.action.amount = 100;
    expect(copied.weeks[1].days[0].exercises[0].rule!.action.amount).toBe(2.5);
    expect(document).toEqual(before);
  });

  it("copies manual rules and rejects unknown groups, source IDs, and mismatched units", () => {
    const { document, source, target } = fixture();
    target.rule = structuredClone(source.rule); source.rule = null;
    expect(copyProgressionRule(document, source.id, [target.progressionKey]).weeks[0].days[0].exercises[1].rule).toBeNull();
    expect(previewProgressionRuleCopy(document, "missing", [target.progressionKey]).issues[0].path).toBe("sourceExerciseId");
    expect(previewProgressionRuleCopy(document, source.id, ["missing"]).issues[0].path).toBe("targetProgressionKeys");
    source.rule = makeProgressionRulePreset("double", { unit: "kg", sets: source.sets });
    expect(previewProgressionRuleCopy(document, source.id, [target.progressionKey]).issues).toContainEqual(expect.objectContaining({ path: "weeks.0.days.0.exercises.0.rule.action.unit" }));
    expect(() => copyProgressionRule(document, source.id, [target.progressionKey])).toThrow(/units/i);
  });

  it("preserves independent starting values across multiple target groups and rejects copying to the source", () => {
    const { document, source, target } = fixture();
    const third = createExercise("Bench"); third.baseLoad = 120;
    document.weeks[0].days[0].exercises.push(third);
    const copied = copyProgressionRule(document, source.id, [target.progressionKey, third.progressionKey]);
    expect(copied.weeks[0].days[0].exercises.map(exercise => [exercise.progressionKey, exercise.baseLoad]))
      .toEqual([[source.progressionKey, 40], [target.progressionKey, 65], [third.progressionKey, 120]]);
    expect(() => copyProgressionRule(document, source.id, [source.progressionKey, target.progressionKey])).toThrow(/source group/);
    expect(() => copyProgressionRule(document, source.id, [])).toThrow(/at least one/);
  });

  it("maps the designated target by role and ordinal despite inserted warmups", () => {
    const { document, source, target, repeated } = fixture();
    source.sets[0].role = source.sets[2].role = "top";
    source.rule = makeProgressionRulePreset("top", { unit: "lb", sets: source.sets, targetSetId: source.sets[2].id });
    for (const exercise of [target, repeated]) {
      exercise.sets[0].role = exercise.sets[2].role = "top";
      exercise.sets.unshift({ ...createSet(), role: "warmup" });
    }
    const copied = copyProgressionRule(document, source.id, [target.progressionKey]);
    expect(copied.weeks[0].days[0].exercises[1].rule!.condition).toMatchObject({ setId: target.sets[3].id });
    expect(copied.weeks[1].days[0].exercises[0].rule!.condition).toMatchObject({ setId: repeated.sets[3].id });
  });

  it("rejects the whole copy with the incompatible appearance path before any target changes", () => {
    const { document, source, target, repeated } = fixture();
    source.sets[0].role = "top";
    source.rule = makeProgressionRulePreset("top", { unit: "lb", sets: source.sets });
    target.sets[0].role = "top";
    const before = structuredClone(document);
    const preview = previewProgressionRuleCopy(document, source.id, [target.progressionKey]);
    expect(preview.issues).toEqual([expect.objectContaining({ path: "weeks.1.days.0.exercises.0.rule.condition.setId" })]);
    expect(preview.groups[0].appearances.map(row => row.exerciseId)).toEqual([target.id, repeated.id]);
    expect(() => copyProgressionRule(document, source.id, [target.progressionKey])).toThrow(/top/);
    expect(document).toEqual(before);
  });
});

describe("sequential hypothetical progression", () => {
  it("holds manual state and keeps within-range outcomes distinct from a missed target", () => {
    const sets = [createSet()];
    const steps = [{ week: 1, status: "completed" as const, actualReps: { [sets[0].id]: 10 } }];
    const initial = { ...state(), consecutiveFailures: 2 };
    expect(simulateProgressionSequence({ rule: null, sets, state: initial, steps })[0].result.nextState).toEqual(initial);
    const rule = makeProgressionRulePreset("double", { unit: "lb", sets });
    const [within] = simulateProgressionSequence({ rule, sets, state: initial, steps });
    expect(within.result).toMatchObject({ reason: "within_rep_range", nextState: { load: 40, consecutiveFailures: 0 } });
  });

  it("carries failures through a reset and then progresses independently from the input state", () => {
    const sets = [createSet()];
    const rule = makeProgressionRulePreset("reset", { unit: "lb", sets });
    const initialState = state();
    const results = simulateProgressionSequence({ rule, sets, state: initialState, steps: [7, 7, 7, 8].map(actual => ({ week: 1, status: "completed" as const, actualReps: { [sets[0].id]: actual } })) });
    expect(results.map(row => row.result.outcome)).toEqual(["hold", "hold", "reset", "advance"]);
    expect(results.map(row => row.result.nextState.load)).toEqual([40, 40, 35, 37.5]);
    expect(results.map(row => row.result.nextState.consecutiveFailures)).toEqual([1, 2, 0, 0]);
    expect(results.every(row => row.hypothetical)).toBe(true);
    expect(initialState).toEqual(state());
    expect(sets[0].repMin).toBe(8);
  });

  it("applies logical-week and deload precedence, preserving the gate through held skips", () => {
    const sets = [createSet()];
    const rule = makeProgressionRulePreset("weekly", { unit: "lb", sets });
    const step = (week: number, status: "completed" | "skipped" = "completed", isDeload = false) => ({ week, status, isDeload, actualReps: { [sets[0].id]: 8 } });
    const results = simulateProgressionSequence({ rule, sets, state: state(), steps: [step(1, "skipped"), step(1, "completed", true), step(1), step(1), step(2)] });
    expect(results.map(row => row.result.reason)).toEqual(["skipped", "fixed_deload", "success", "already_evaluated_week", "success"]);
    expect(results.at(-1)!.result.nextState.trainingMax).toBe(110);
  });

  it("resolves increased rep targets for later exposures and preserves local range offsets and warmups", () => {
    const sets = [{ ...createSet(), role: "warmup" as const, repMin: 5, repMax: 5 }, createSet(), { ...createSet(), repMin: 10, repMax: 14 }];
    const rule: ProgressionRuleV1 = { version: 1, condition: { type: "all_work_sets", target: "minimum" }, action: { variable: "reps", unit: "reps", operation: "add", amount: 1, rounding: { mode: "nearest", quantum: 1 }, timing: "per_exposure" } };
    const actualReps = { [sets[1].id]: 8, [sets[2].id]: 10 };
    const results = simulateProgressionSequence({ rule, sets, state: state(), initialReps: 8, steps: [
      { week: 1, status: "completed", actualReps },
      { week: 2, status: "completed", actualReps },
    ] });
    expect(results[0].result.outcome).toBe("advance");
    expect(results[1].input.sets.map(set => [set.repMin, set.repMax])).toEqual([[5, 5], [9, 13], [11, 15]]);
    expect(results[1].result.reason).toBe("target_missed");
  });

  it("distinguishes unlogged/null and zero reps while retaining fixed and percentage prescriptions", () => {
    const sets = [{ ...createSet(), loadMode: "percent" as const, load: 65 }, { ...createSet(), loadMode: "fixed" as const, load: 25 }];
    const rule = makeProgressionRulePreset("all-set", { unit: "kg", sets });
    const results = simulateProgressionSequence({ rule, sets, state: state(), steps: [
      { week: 1, status: "completed", actualReps: { [sets[0].id]: null, [sets[1].id]: 8 } },
      { week: 1, status: "completed", actualReps: { [sets[0].id]: 0, [sets[1].id]: 8 } },
    ] });
    expect(results.map(row => row.result.reason)).toEqual(["partial", "target_missed"]);
    expect(results.map(row => row.result.nextState.consecutiveFailures)).toEqual([0, 1]);
    expect(results[0].prescription.map(set => set.weight)).toEqual([65, 25]);
  });

  it("uses configured partial failure policies and treats omitted set results as unlogged", () => {
    const sets = [createSet()];
    const rule = makeProgressionRulePreset("reset", { unit: "lb", sets })!;
    rule.partialPolicy = "count_failure";
    const [result] = simulateProgressionSequence({ rule, sets, state: { ...state(), consecutiveFailures: 2 }, steps: [{ week: 1, status: "completed", actualReps: {} }] });
    expect(result.input.sets[0].actualReps).toBeNull();
    expect(result.result.reason).toBe("failure_reset");
  });

  it("rejects malformed simulations contextually instead of returning misleading results", () => {
    const sets = [createSet()];
    const step = { week: 1, status: "completed" as const, actualReps: {} };
    expect(() => simulateProgressionSequence({ rule: null, sets, state: state(), steps: Array(13).fill(step) })).toThrow(/at most 12/);
    expect(() => simulateProgressionSequence({ rule: null, sets, state: state(), steps: [{ ...step, week: 0 }] })).toThrow(/steps.0.*logical program week/);
    expect(() => simulateProgressionSequence({ rule: null, sets, state: state(), steps: [{ ...step, actualReps: { unknown: 8 } }] })).toThrow(/no longer in this exercise/);
    expect(() => simulateProgressionSequence({ rule: {} as ProgressionRuleV1, sets, state: state(), steps: [] })).toThrow(/Rule version/);
    expect(() => simulateProgressionSequence({ rule: null, sets, state: { ...state(), load: NaN }, steps: [] })).toThrow(/state.load/);
  });
});
