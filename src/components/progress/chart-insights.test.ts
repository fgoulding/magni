import { describe, expect, it } from "vitest";
import { chartScale, formatMetricValue, metricDifference } from "./chart-insights";
describe("readable progress axis", () => {
  it("uses rounded enclosing ticks without changing actual values", () => {
    const scale = chartScale([163.3, 177.7, 182.4]);
    expect(scale.ticks).toEqual([160, 170, 180, 190]);
    expect(scale.low).toBeLessThan(163.3);
    expect(scale.high).toBeGreaterThan(182.4);
  });
  it("keeps zero and a single value in finite nonnegative bounds", () => {
    for (const values of [[], [0], [225], [0, 0]]) {
      const { low, high, ticks } = chartScale(values);
      expect(low).toBeGreaterThanOrEqual(0);
      expect(high).toBeGreaterThan(low);
      expect(ticks.every(Number.isFinite)).toBe(true);
    }
  });
});

describe("decimal performance differences", () => {
  it.each([
    [110.3, 110.1, 0.2],
    [100.1, 100, 0.1],
    [110.1, 110.3, -0.2],
    [20.25, 1.25, 19],
    [0.3, 0.1, 0.2],
    [20.25, 20.25, 0],
  ])("compares authored decimal loads %s and %s without cancellation noise", (latest, previous, expected) => {
    expect(metricDifference(latest, previous)).toBe(expected);
    expect(formatMetricValue(metricDifference(latest, previous), "load:lb")).toBe(formatMetricValue(expected, "load:lb"));
  });
  it.each([
    [1.1e-7, 1e-7, 1e-8],
    [1.2e-20, 1.1e-20, 1e-21],
    [1.2e21, 1.1e21, 1e20],
    [1.2e300, 1.1e300, 1e299],
    [5e-324, 0, 5e-324],
  ])("preserves decimal differences when operands use exponent notation", (latest, previous, expected) => {
    expect(metricDifference(latest, previous)).toBe(expected);
  });
});
