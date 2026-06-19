import { describe, expect, it } from "vitest";
import { evaluateProgressionRule, parseProgressionRule, ruleAutoProgresses } from "./custom-rule";
import type { TrainingMaxContext } from "./types";

const ctx = (actualReps: number, repOutTarget: number): TrainingMaxContext => ({
  actualReps,
  repOutTarget,
  category: "main",
  currentTrainingMax: 300,
});

describe("evaluateProgressionRule", () => {
  it("none never moves the training max", () => {
    expect(evaluateProgressionRule({ kind: "none" }, ctx(20, 5))).toBe(0);
  });

  it("amrap-proportional scales by reps over/under the target (both directions)", () => {
    const rule = { kind: "amrap-proportional", perRep: 2.5 } as const;
    expect(evaluateProgressionRule(rule, ctx(8, 5))).toBe(7.5); // +3 reps
    expect(evaluateProgressionRule(rule, ctx(5, 5))).toBe(0);
    expect(evaluateProgressionRule(rule, ctx(3, 5))).toBe(-5); // -2 reps → deload
  });

  it("linear-add adds onSuccess at/above target, onFail (default 0) below", () => {
    expect(evaluateProgressionRule({ kind: "linear-add", onSuccess: 5 }, ctx(5, 5))).toBe(5);
    expect(evaluateProgressionRule({ kind: "linear-add", onSuccess: 5 }, ctx(4, 5))).toBe(0);
    expect(evaluateProgressionRule({ kind: "linear-add", onSuccess: 5, onFail: -10 }, ctx(4, 5))).toBe(-10);
  });
});

describe("ruleAutoProgresses", () => {
  it("is false only for none", () => {
    expect(ruleAutoProgresses({ kind: "none" })).toBe(false);
    expect(ruleAutoProgresses({ kind: "linear-add", onSuccess: 5 })).toBe(true);
    expect(ruleAutoProgresses({ kind: "amrap-proportional", perRep: 2.5 })).toBe(true);
  });
});

describe("parseProgressionRule", () => {
  it("accepts valid rules and drops unknown fields", () => {
    expect(parseProgressionRule({ kind: "none", junk: 1 })).toEqual({ kind: "none" });
    expect(parseProgressionRule({ kind: "amrap-proportional", perRep: 2.5 })).toEqual({
      kind: "amrap-proportional",
      perRep: 2.5,
    });
    expect(parseProgressionRule({ kind: "linear-add", onSuccess: 5, onFail: -10 })).toEqual({
      kind: "linear-add",
      onSuccess: 5,
      onFail: -10,
    });
  });

  it("rejects malformed rules", () => {
    expect(() => parseProgressionRule(null)).toThrow();
    expect(() => parseProgressionRule({ kind: "made-up" })).toThrow();
    expect(() => parseProgressionRule({ kind: "amrap-proportional", perRep: -1 })).toThrow();
    expect(() => parseProgressionRule({ kind: "linear-add", onSuccess: -5 })).toThrow();
    expect(() => parseProgressionRule({ kind: "linear-add", onSuccess: 5, onFail: 5 })).toThrow();
  });
});
