import { describe, expect, it } from "vitest";
import type { ProgressSet } from "@/features/progress/types";
import { representativeSet } from "./representative-set";
const set = (id: number, reps: number, weight: number | null): ProgressSet => ({ setId: id, name: "Bench", reps, weight, unit: "kg", count: 1, role: null, loadMode: null });
describe("recent workout representative set", () => {
  it("shows a heaviest completed set instead of a warmup or a heavier failed attempt", () => {
    const sets = [set(1, 10, 20), set(2, 5, 100), set(3, 0, 200), set(4, 8, 100)];
    expect(representativeSet(sets)?.setId).toBe(4);
    expect(sets.map(item => item.setId)).toEqual([1, 2, 3, 4]);
  });
  it("uses reps for zero/missing load and preserves the original zero or null", () => {
    expect(representativeSet([set(1, 8, 0), set(2, 12, 0)])).toMatchObject({ reps: 12, weight: 0, unit: "kg" });
    expect(representativeSet([set(1, 8, null), set(2, 12, null)])).toMatchObject({ reps: 12, weight: null });
    expect(representativeSet([set(1, 0, 140)])).toMatchObject({ reps: 0, weight: 140 });
    expect(representativeSet([])).toBeNull();
  });
  it("uses most reps when completed sets mix zero and missing loads without a positive load", () => {
    expect(representativeSet([set(1, 10, 0), set(2, 20, null)])).toMatchObject({ reps: 20, weight: null });
    expect(representativeSet([set(1, 20, null), set(2, 10, 0)])).toMatchObject({ reps: 20, weight: null });
  });
});
