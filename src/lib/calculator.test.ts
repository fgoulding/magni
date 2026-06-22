import { describe, expect, it } from "vitest";
import { applyTmDelta, calculateTmDelta, calculateWeight, getAdjustmentPerRep } from "./calculator";

describe("calculateWeight", () => {
  it("rounds calculated weights to the nearest configured increment", () => {
    expect(calculateWeight(350, 0.7, 2.5)).toBe(245);
    expect(calculateWeight(295.3, 0.75, 2.5)).toBe(222.5);
    expect(calculateWeight(287.6, 0.7, 5)).toBe(200);
  });
});

describe("training max adjustments", () => {
  it("calculates positive, negative, and zero TM deltas from AMRAP performance", () => {
    expect(calculateTmDelta(10, 8, 2.5)).toBe(5);
    expect(calculateTmDelta(6, 8, 2.5)).toBe(-5);
    expect(calculateTmDelta(8, 8, 2.5)).toBe(0);
  });

  it("applies deltas without allowing non-positive training maxes", () => {
    expect(applyTmDelta(350, 5)).toBe(355);
    expect(applyTmDelta(10, -20)).toBe(2.5);
  });

  it("rounds to 0.1 so floating-point residue can't accumulate in the stored TM", () => {
    // 20.1 + 1.1 = 21.200000000000003 in IEEE-754; unrounded this residue
    // compounds across weeks and leaks into stored expected_max + displayed TMs.
    expect(applyTmDelta(20.1, 1.1)).toBe(21.2);
    expect(applyTmDelta(20.4, 2.2)).toBe(22.6); // 22.599999999999998 unrounded
  });

  it("uses smaller adjustments for aux and accessory exercises", () => {
    expect(getAdjustmentPerRep("main")).toBe(2.5);
    expect(getAdjustmentPerRep("aux")).toBe(1.25);
    expect(getAdjustmentPerRep("accessory")).toBe(1.25);
  });
});
