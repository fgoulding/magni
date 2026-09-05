import { describe, expect, it } from "vitest";
import {
  describeProgressionRule,
  evaluateProgression,
  previewProgressionScenarios,
  validateProgressionRule,
  type ProgressionInput,
  type ProgressionRuleV1,
  type ProgressionSet,
  type ProgressionState,
} from "./progression";

const state: ProgressionState = {
  load: 40, trainingMax: 100, reps: 8, consecutiveFailures: 0, lastEvaluatedWeek: null,
};
const rule: ProgressionRuleV1 = {
  version: 1,
  condition: { type: "double_progression" },
  action: {
    variable: "load", unit: "lb", operation: "add", amount: 2.5,
    rounding: { mode: "nearest", quantum: 2.5 }, timing: "per_exposure",
  },
};
function sets(reps: Array<number | null>): ProgressionSet[] {
  return reps.map((actualReps, index) => ({
    id: `set-${index + 1}`, role: "work", repMin: 8, repMax: 12, actualReps,
  }));
}
function input(overrides: Partial<ProgressionInput> = {}): ProgressionInput {
  return { rule, state, sets: sets([12, 12, 12]), status: "completed", week: 1, ...overrides };
}
function withAction(action: Partial<ProgressionRuleV1["action"]>): ProgressionRuleV1 {
  return { ...rule, action: { ...rule.action, ...action } };
}

describe("configurable progression", () => {
  it("holds three sets at 40 lb after 12/12/11", () => {
    const result = evaluateProgression(input({ sets: sets([12, 12, 11]) }));
    expect(result.outcome).toBe("hold");
    expect(result.reason).toBe("within_rep_range");
    expect(result.nextState.load).toBe(40);
    expect(result.nextState.consecutiveFailures).toBe(0);
  });

  it("advances three sets from 40 to exactly 42.5 lb after 12/12/12", () => {
    const result = evaluateProgression(input());
    expect(result.outcome).toBe("advance");
    expect(result.nextState).toEqual({ ...state, load: 42.5, lastEvaluatedWeek: 1 });
  });

  it("accepts results above the upper bound", () => {
    expect(evaluateProgression(input({ sets: sets([13, 12, 15]) })).nextState.load).toBe(42.5);
  });

  it("uses each set's own range", () => {
    const varied: ProgressionSet[] = [
      { id: "top", role: "top", repMin: 3, repMax: 5, actualReps: 5 },
      { id: "backoff", role: "backoff", repMin: 8, repMax: 10, actualReps: 10 },
    ];
    expect(evaluateProgression(input({ sets: varied })).nextState.load).toBe(42.5);
    expect(evaluateProgression(input({ sets: [{ ...varied[0], actualReps: 4 }, varied[1]] })).nextState.load).toBe(40);
  });

  it("requires every non-warmup set, including top, back-off, and AMRAP", () => {
    for (const role of ["work", "top", "backoff", "amrap"] as const) {
      const results: ProgressionSet[] = [...sets([12]), { ...sets([11])[0], id: "other", role }];
      expect(evaluateProgression(input({ sets: results })).nextState.load).toBe(40);
    }
  });

  it("excludes an unlogged or failed warmup from work-set evaluation", () => {
    for (const actualReps of [null, 0]) {
      const warmup: ProgressionSet = { id: "warmup", role: "warmup", repMin: 5, repMax: 5, actualReps };
      expect(evaluateProgression(input({ sets: [warmup, ...sets([12, 12, 12])] })).nextState.load).toBe(42.5);
    }
  });

  it("evaluates all-work-set success against the chosen minimum or maximum", () => {
    const minimum: ProgressionRuleV1 = { ...rule, condition: { type: "all_work_sets", target: "minimum" } };
    const maximum: ProgressionRuleV1 = { ...rule, condition: { type: "all_work_sets", target: "maximum" } };
    expect(evaluateProgression(input({ rule: minimum, sets: sets([8, 9, 8]) })).nextState.load).toBe(42.5);
    expect(evaluateProgression(input({ rule: minimum, sets: sets([8, 7, 8]) })).nextState.consecutiveFailures).toBe(1);
    expect(evaluateProgression(input({ rule: maximum, sets: sets([12, 12, 11]) })).nextState.consecutiveFailures).toBe(1);
  });

  it("uses a designated top or AMRAP set instead of another set's result", () => {
    const designated: ProgressionRuleV1 = { ...rule, condition: { type: "designated_set", setId: "target", targetReps: 6 } };
    for (const role of ["top", "amrap"] as const) {
      const actual: ProgressionSet[] = [
        { id: "target", role, repMin: 3, repMax: 6, actualReps: 6 },
        { id: "other", role: "backoff", repMin: 8, repMax: 10, actualReps: 4 },
      ];
      expect(evaluateProgression(input({ rule: designated, sets: actual })).nextState.load).toBe(42.5);
      expect(evaluateProgression(input({ rule: designated, sets: [{ ...actual[0], actualReps: 5 }, actual[1]] })).reason).toBe("target_missed");
    }
  });

  it("holds safely for a missing designated set or one with an ineligible role", () => {
    const designated: ProgressionRuleV1 = { ...rule, condition: { type: "designated_set", setId: "target", targetReps: 6 } };
    expect(evaluateProgression(input({ rule: designated })).reason).toBe("missing_target_set");
    expect(evaluateProgression(input({ rule: designated, sets: [{ id: "target", role: "warmup", repMin: 6, repMax: 6, actualReps: 6 }] })).reason).toBe("missing_target_set");
  });

  it("does not consider an empty exercise or warmup-only exercise successful", () => {
    expect(evaluateProgression(input({ sets: [] })).reason).toBe("no_work_sets");
    expect(evaluateProgression(input({ sets: [{ id: "warm", role: "warmup", repMin: 5, repMax: 5, actualReps: 5 }] })).reason).toBe("no_work_sets");
  });

  it("holds unchanged for a manual exercise", () => {
    const prior = { ...state, consecutiveFailures: 2 };
    expect(evaluateProgression(input({ rule: null, state: prior })).nextState).toEqual(prior);
    expect(evaluateProgression(input({ rule: null })).reason).toBe("manual");
  });
});

describe("partial, skipped, failed, and deload exposures", () => {
  const resetting: ProgressionRuleV1 = {
    ...rule, failureReset: { afterFailures: 3, percent: 10, rounding: { mode: "down", quantum: 2.5 } },
  };

  it("holds partial and skipped results by default without changing the failure streak", () => {
    const prior = { ...state, consecutiveFailures: 2 };
    for (const status of ["partial", "skipped"] as const) {
      const result = evaluateProgression(input({ rule: resetting, state: prior, status }));
      expect(result.nextState).toEqual(prior);
      expect(result.reason).toBe(status);
    }
  });

  it("treats null actual reps as partial even if the supplied status is completed", () => {
    const result = evaluateProgression(input({ sets: sets([12, 12, null]) }));
    expect(result.reason).toBe("partial");
    expect(result.nextState).toEqual(state);
  });

  it("treats zero actual reps as a logged failure", () => {
    const result = evaluateProgression(input({ sets: sets([12, 12, 0]) }));
    expect(result.reason).toBe("target_missed");
    expect(result.nextState.consecutiveFailures).toBe(1);
  });

  it("can count skipped and partial results as failure and trigger the same reset", () => {
    for (const status of ["partial", "skipped"] as const) {
      const result = evaluateProgression(input({
        rule: { ...resetting, skipPolicy: "count_failure", partialPolicy: "count_failure" },
        status, state: { ...state, consecutiveFailures: 2 },
      }));
      expect(result.outcome).toBe("reset");
      expect(result.nextState.load).toBe(35);
      expect(result.nextState.consecutiveFailures).toBe(0);
      expect(result.reason).toBe("failure_reset");
    }
  });

  it("counts inferred partial results according to the partial policy", () => {
    const result = evaluateProgression(input({ rule: { ...rule, partialPolicy: "count_failure" }, sets: sets([12, null, 12]) }));
    expect(result.nextState.consecutiveFailures).toBe(1);
  });

  it("holds on misses until the configured consecutive-failure threshold", () => {
    let current = state;
    for (let exposure = 1; exposure <= 3; exposure++) {
      const result = evaluateProgression(input({ rule: resetting, state: current, sets: sets([8, 7, 8]) }));
      expect(result.outcome).toBe(exposure === 3 ? "reset" : "hold");
      expect(result.nextState.load).toBe(exposure === 3 ? 35 : 40);
      current = result.nextState;
    }
    expect(current.consecutiveFailures).toBe(0);
  });

  it("clears failure streaks after success or an in-range double-progression result", () => {
    for (const reps of [[12, 12, 12], [12, 12, 11]]) {
      expect(evaluateProgression(input({ state: { ...state, consecutiveFailures: 2 }, sets: sets(reps) })).nextState.consecutiveFailures).toBe(0);
    }
  });

  it("gives fixed deload precedence over success, failures, and skip/partial policies", () => {
    const prior = { ...state, consecutiveFailures: 2 };
    for (const status of ["completed", "partial", "skipped"] as const) {
      const result = evaluateProgression(input({
        rule: { ...resetting, skipPolicy: "count_failure", partialPolicy: "count_failure" },
        state: prior, status, isDeload: true,
      }));
      expect(result.reason).toBe("fixed_deload");
      expect(result.nextState).toEqual(prior);
    }
  });
});

describe("actions and logical weekly timing", () => {
  it("changes the named training max without changing working load", () => {
    const result = evaluateProgression(input({ rule: withAction({ variable: "trainingMax", amount: 5 }) }));
    expect(result.nextState.trainingMax).toBe(105);
    expect(result.nextState.load).toBe(40);
  });

  it("changes reps in reps units", () => {
    const result = evaluateProgression(input({ rule: withAction({ variable: "reps", unit: "reps", amount: 1, rounding: { mode: "nearest", quantum: 1 } }) }));
    expect(result.nextState.reps).toBe(9);
    expect(result.nextState.load).toBe(40);
  });

  it("computes percentages from the affected variable and applies configured rounding", () => {
    for (const [mode, expected] of [["nearest", 45], ["down", 42.5], ["up", 45]] as const) {
      const result = evaluateProgression(input({ rule: withAction({ operation: "percent", amount: 10, rounding: { mode, quantum: 2.5 } }) }));
      expect(result.nextState.load).toBe(expected);
    }
  });

  it("uses the same numeric behavior with kg and preserves decimal increments", () => {
    const decimal = withAction({ unit: "kg", amount: 0.1, rounding: { mode: "nearest", quantum: 0.1 } });
    const result = evaluateProgression(input({ rule: decimal, state: { ...state, load: 40.1 } }));
    expect(result.nextState.load).toBe(40.2);
  });

  it("does not round an exact decimal grid point down by one step", () => {
    const result = evaluateProgression(input({
      rule: withAction({ amount: 0, rounding: { mode: "down", quantum: 0.1 } }), state: { ...state, load: 4.3 },
    }));
    expect(result.nextState.load).toBe(4.3);
  });

  it("supports negative weekly changes and prevents negative resulting values", () => {
    const result = evaluateProgression(input({ rule: withAction({ amount: -100 }) }));
    expect(result.nextState.load).toBe(0);
  });

  it("can hold after success if configured rounding leaves the value unchanged", () => {
    expect(evaluateProgression(input({ rule: withAction({ amount: 0.5 }) })).outcome).toBe("hold");
    expect(evaluateProgression(input({ rule: withAction({ amount: 0.5 }) })).reason).toBe("rounded_unchanged");
  });

  it("evaluates weekly actions once per logical week, including older completed weeks", () => {
    const weekly = withAction({ timing: "weekly" });
    const first = evaluateProgression(input({ rule: weekly, week: 2 }));
    expect(first.nextState.load).toBe(42.5);
    for (const week of [1, 2]) {
      const duplicate = evaluateProgression(input({ rule: weekly, state: first.nextState, week }));
      expect(duplicate.nextState).toEqual(first.nextState);
      expect(duplicate.reason).toBe("already_evaluated_week");
    }
    expect(evaluateProgression(input({ rule: weekly, state: first.nextState, week: 3 })).nextState.load).toBe(45);
  });

  it("does not let hold-policy skips or fixed deloads consume the weekly evaluation", () => {
    const weekly = withAction({ timing: "weekly" });
    for (const overrides of [{ status: "skipped" as const }, { isDeload: true }]) {
      const held = evaluateProgression(input({ rule: weekly, ...overrides }));
      expect(evaluateProgression(input({ rule: weekly, state: held.nextState })).nextState.load).toBe(42.5);
    }
  });

  it("counts at most one failure per week with weekly timing", () => {
    const weekly = withAction({ timing: "weekly" });
    const failed = evaluateProgression(input({ rule: weekly, sets: sets([7, 8, 8]) }));
    expect(failed.nextState.consecutiveFailures).toBe(1);
    expect(evaluateProgression(input({ rule: weekly, state: failed.nextState, sets: sets([7, 8, 8]) })).nextState.consecutiveFailures).toBe(1);
  });

  it("permits separate per-exposure evaluations in one week", () => {
    const first = evaluateProgression(input());
    expect(evaluateProgression(input({ state: first.nextState })).nextState.load).toBe(45);
  });

  it("applies fixed weekly changes on a complete exposure without checking rep targets", () => {
    const weekly: ProgressionRuleV1 = { ...rule, condition: { type: "weekly" } };
    const result = evaluateProgression(input({ rule: weekly, sets: sets([5, 6, 7]) }));
    expect(result.nextState.load).toBe(42.5);
    expect(evaluateProgression(input({ rule: weekly, state: result.nextState })).reason).toBe("already_evaluated_week");
  });

  it("resets the same affected variable using the reset's own percentage and rounding", () => {
    const configured: ProgressionRuleV1 = {
      ...withAction({ variable: "trainingMax" }),
      failureReset: { afterFailures: 1, percent: 12, rounding: { mode: "up", quantum: 5 } },
    };
    const result = evaluateProgression(input({ rule: configured, sets: sets([7, 8, 8]) }));
    expect(result.nextState.trainingMax).toBe(90);
    expect(result.nextState.load).toBe(40);
  });

  it("never increases an off-grid load during a failure reset rounded upward", () => {
    const configured: ProgressionRuleV1 = {
      ...rule, failureReset: { afterFailures: 1, percent: 1, rounding: { mode: "up", quantum: 5 } },
    };
    const result = evaluateProgression(input({ rule: configured, state: { ...state, load: 41 }, sets: sets([7, 8, 8]) }));
    expect(result.nextState.load).toBe(41);
    expect(result.nextState.consecutiveFailures).toBe(0);
  });

  it("rejects numerical overflow instead of returning a non-serializable state", () => {
    expect(() => evaluateProgression(input({
      rule: withAction({ operation: "percent", amount: Number.MAX_VALUE }), state: { ...state, load: Number.MAX_VALUE },
    }))).toThrow("finite");
  });
});

describe("explanations and scenario parity", () => {
  it("describes all relevant configuration and precedence in readable language", () => {
    const configured: ProgressionRuleV1 = {
      ...rule, skipPolicy: "count_failure", partialPolicy: "hold",
      failureReset: { afterFailures: 3, percent: 10, rounding: { mode: "down", quantum: 2.5 } },
    };
    const description = describeProgressionRule(configured);
    for (const text of ["upper", "2.5 lb", "load", "nearest", "exposure", "3 consecutive", "10%", "down", "Skipped", "count as failures", "Partial", "hold", "deload"]) {
      expect(description).toContain(text);
    }
    expect(describeProgressionRule(null)).toContain("Manual");
  });

  it("explains minimum/maximum targets, designated targets, weekly changes, and reps", () => {
    expect(describeProgressionRule({ ...rule, condition: { type: "all_work_sets", target: "minimum" } })).toContain("minimum");
    expect(describeProgressionRule({ ...rule, condition: { type: "all_work_sets", target: "maximum" } })).toContain("maximum");
    expect(describeProgressionRule({ ...rule, condition: { type: "designated_set", setId: "Top", targetReps: 6 } })).toContain("Top");
    expect(describeProgressionRule({ ...rule, condition: { type: "weekly" } })).toContain("week");
    expect(describeProgressionRule(withAction({ operation: "percent", amount: 10 }))).toContain("10%");
    expect(describeProgressionRule(withAction({ variable: "reps", unit: "reps", amount: 1, rounding: { mode: "nearest", quantum: 1 } }))).toContain("1 reps");
  });

  it("labels hypothetical scenarios and returns results from the actual evaluator", () => {
    const scenarios = previewProgressionScenarios(input());
    expect(scenarios.map((scenario) => scenario.scenario)).toEqual(["success", "miss", "partial", "skipped"]);
    for (const scenario of scenarios) {
      expect(scenario.hypothetical).toBe(true);
      expect(scenario.result).toEqual(evaluateProgression(scenario.input));
    }
    expect(scenarios[0].result.nextState.load).toBe(42.5);
    expect(scenarios[1].result.nextState.load).toBe(40);
    expect(scenarios[2].result.reason).toBe("partial");
    expect(scenarios[3].result.reason).toBe("skipped");
  });

  it("builds designated-set scenarios against the configured target", () => {
    const configured: ProgressionRuleV1 = { ...rule, condition: { type: "designated_set", setId: "set-2", targetReps: 15 } };
    const results = sets([12, 12, 12]);
    results[1].role = "amrap";
    const scenarios = previewProgressionScenarios(input({ rule: configured, sets: results }));
    expect(scenarios[0].input.sets[1].actualReps).toBe(15);
    expect(scenarios[0].result.outcome).toBe("advance");
    expect(scenarios[1].input.sets[1].actualReps).toBe(14);
    expect(scenarios[1].result.reason).toBe("target_missed");
  });

  it("keeps rules, state, and prescribed sets immutable and serializable", () => {
    const original = input();
    const before = JSON.stringify(original);
    evaluateProgression(original);
    previewProgressionScenarios(original);
    expect(JSON.stringify(original)).toBe(before);
    expect(evaluateProgression(JSON.parse(before))).toEqual(evaluateProgression(original));
    const result = evaluateProgression(original);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe("configuration and input validation", () => {
  it("validates serializable rules and accepts a manual null rule", () => {
    expect(validateProgressionRule(rule)).toEqual([]);
    expect(validateProgressionRule(null)).toEqual([]);
  });

  it.each([
    ["version", { ...rule, version: 2 }],
    ["condition", { ...rule, condition: { type: "unknown" } }],
    ["target", { ...rule, condition: { type: "all_work_sets", target: "anything" } }],
    ["setId", { ...rule, condition: { type: "designated_set", setId: "", targetReps: 5 } }],
    ["targetReps", { ...rule, condition: { type: "designated_set", setId: "a", targetReps: -1 } }],
    ["variable", withAction({ variable: "weight" as "load" })],
    ["unit", withAction({ unit: "reps" })],
    ["operation", withAction({ operation: "multiply" as "add" })],
    ["amount", withAction({ amount: Number.NaN })],
    ["amount", withAction({ operation: "percent", amount: -101 })],
    ["rounding", withAction({ rounding: { mode: "sideways" as "nearest", quantum: 1 } })],
    ["quantum", withAction({ rounding: { mode: "nearest", quantum: 0 } })],
    ["timing", withAction({ timing: "daily" as "weekly" })],
    ["skipPolicy", { ...rule, skipPolicy: "ignore" }],
    ["partialPolicy", { ...rule, partialPolicy: "ignore" }],
    ["afterFailures", { ...rule, failureReset: { afterFailures: 0, percent: 10, rounding: { mode: "nearest", quantum: 2.5 } } }],
    ["percent", { ...rule, failureReset: { afterFailures: 3, percent: 101, rounding: { mode: "nearest", quantum: 2.5 } } }],
  ])("rejects invalid %s before evaluation", (field, invalid) => {
    expect(validateProgressionRule(invalid).join(" ")).toContain(field);
    expect(() => evaluateProgression(input({ rule: invalid as ProgressionRuleV1 }))).toThrow();
  });

  it("rejects missing rule objects and fields without crashing validation", () => {
    for (const invalid of [undefined, 5, [], {}, { version: 1 }, { ...rule, action: null }, { ...rule, failureReset: {} }]) {
      expect(validateProgressionRule(invalid).length).toBeGreaterThan(0);
    }
  });

  it("rejects array values that coerce to recognized enum strings", () => {
    expect(validateProgressionRule({ ...rule, action: { ...rule.action, variable: ["load"] } }).join(" ")).toContain("variable");
    expect(validateProgressionRule({ ...rule, action: { ...rule.action, rounding: { mode: ["down"], quantum: 1 } } }).join(" ")).toContain("mode");
  });

  it("requires integer rep increments and rep rounding", () => {
    const invalid = withAction({ variable: "reps", unit: "reps", amount: 0.5, rounding: { mode: "nearest", quantum: 0.5 } });
    expect(validateProgressionRule(invalid).join(" ")).toContain("integer");
  });

  it.each([
    ["load", { state: { ...state, load: -1 } }],
    ["trainingMax", { state: { ...state, trainingMax: Number.POSITIVE_INFINITY } }],
    ["reps", { state: { ...state, reps: 1.5 } }],
    ["consecutiveFailures", { state: { ...state, consecutiveFailures: -1 } }],
    ["lastEvaluatedWeek", { state: { ...state, lastEvaluatedWeek: 0 } }],
    ["week", { week: 0 }],
    ["status", { status: "finished" as "completed" }],
    ["actualReps", { sets: [{ ...sets([12])[0], actualReps: -1 }] }],
    ["actualReps", { sets: [{ ...sets([12])[0], actualReps: 2.5 }] }],
    ["repMin", { sets: [{ ...sets([12])[0], repMin: 0 }] }],
    ["repMax", { sets: [{ ...sets([12])[0], repMax: 7 }] }],
    ["role", { sets: [{ ...sets([12])[0], role: "unknown" as "work" }] }],
    ["id", { sets: [{ ...sets([12])[0], id: "" }] }],
    ["unique", { sets: [sets([12])[0], sets([12])[0]] }],
  ])("rejects invalid input %s", (field, overrides) => {
    expect(() => evaluateProgression(input(overrides))).toThrow(field);
  });
});
