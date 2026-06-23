import { describe, expect, it } from "vitest";
import { parseSharedProgramSnapshot } from "@/features/shared-programs/snapshot";
import { applySbsCycleToSnapshot, getProgramDefault, listProgramDefaults, snapshotUsesSbs } from "./defaults";

describe("program defaults", () => {
  it("exposes stable keys and valid shared snapshots", () => {
    for (const programDefault of listProgramDefaults()) {
      const snapshot = parseSharedProgramSnapshot(JSON.stringify(programDefault.snapshot));
      const dayKeys = snapshot.days.map((day) => day.key);
      const exerciseKeys = snapshot.days.flatMap((day) => day.exercises.map((exercise) => exercise.key));

      expect(dayKeys.length).toBeGreaterThan(0);
      expect(new Set(dayKeys).size).toBe(dayKeys.length);
      expect(new Set(exerciseKeys).size).toBe(exerciseKeys.length);
      expect(dayKeys.every((key) => key.startsWith(`${programDefault.id}:day:`))).toBe(true);
      expect(exerciseKeys.every((key) => key.startsWith(programDefault.id) && key.includes(":exercise:"))).toBe(
        true,
      );
      expect(snapshot.days.flatMap((day) => day.exercises)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            weeks: expect.any(Array),
          }),
        ]),
      );
    }
  });

  it("returns copies with ids, labels, descriptions, and reusable template weeks", () => {
    const defaults = listProgramDefaults();

    expect(defaults.map((programDefault) => programDefault.id).sort()).toEqual([
      "basic-strength-3-day",
      "phul-4-day",
      "sbs-hypertrophy-4-day",
      "starting-strength-3-day",
      "stronglifts-5x5",
      "superset-hypertrophy-3-day",
    ]);
    expect(defaults).toEqual(
      defaults.map((programDefault) =>
        expect.objectContaining({
          id: programDefault.id,
          label: expect.any(String),
          description: expect.any(String),
          snapshot: expect.objectContaining({
            name: expect.any(String),
            description: expect.any(String),
          }),
        }),
      ),
    );

    const firstList = listProgramDefaults();
    const secondList = listProgramDefaults();
    expect(firstList).not.toBe(secondList);
    expect(firstList[0]).not.toBe(secondList[0]);
    expect(firstList[0].snapshot).not.toBe(secondList[0].snapshot);
    expect(firstList[0].snapshot.days[0].exercises[0].weeks).not.toBe(
      secondList[0].snapshot.days[0].exercises[0].weeks,
    );

    expect(getProgramDefault("basic-strength-3-day")?.snapshot.days[0].exercises[0].weeks[0].intensityPct).toBe(
      0.7,
    );
    expect(getProgramDefault("basic-strength-3-day")?.snapshot.days[0].exercises[0].weeks[0].reps).toBe(5);
    expect(getProgramDefault("basic-strength-3-day")?.snapshot.days[0].exercises[0].weeks[0].sets).toBe(5);
    expect(getProgramDefault("missing")).toBeUndefined();
  });

  it("materialises bodyweight default exercises as N individual sets (a ramp)", () => {
    const superset = getProgramDefault("superset-hypertrophy-3-day")!;
    const pullUp = superset.snapshot.days
      .flatMap((day) => day.exercises)
      .find((exercise) => exercise.name === "Pull-Up")!;

    expect(pullUp.progressionType).toBe("bodyweight");
    // 3 sets of 10 → a 3-set ramp so each logs its own reps + optional added weight.
    expect(pullUp.weeks[0].ramp).toHaveLength(3);
    expect(pullUp.weeks[0].ramp?.[0]).toMatchObject({ setNumber: 1, reps: 10, intensityPct: 0 });
  });

  it("re-plans SBS lifts to the chosen cycle, leaving non-SBS lifts untouched", () => {
    const base = getProgramDefault("superset-hypertrophy-3-day")!.snapshot;
    expect(snapshotUsesSbs(base)).toBe(true);

    const cycle2 = applySbsCycleToSnapshot(base, 2);
    const squat = cycle2.days[0].exercises.find((e) => e.name === "Squat")!;
    // Main SBS lift now loads as cycle 2: week 1 = 5×4 @ 75% (was 5×5 @ 70%).
    expect(squat.progressionType).toBe("sbs-c2");
    expect(squat.weeks[0]).toMatchObject({ intensityPct: 0.75, reps: 4, sets: 5 });

    // A custom/bodyweight accessory is left exactly as-is.
    const before = base.days[0].exercises.find((e) => e.name === "Pull-Up")!;
    const after = cycle2.days[0].exercises.find((e) => e.name === "Pull-Up")!;
    expect(after).toEqual(before);

    // Cycle 1 maps SBS lifts back to the base "sbs" progression.
    const cycle1 = applySbsCycleToSnapshot(cycle2, 1);
    const squatC1 = cycle1.days[0].exercises.find((e) => e.name === "Squat")!;
    expect(squatC1.progressionType).toBe("sbs");
    expect(squatC1.weeks[0]).toMatchObject({ intensityPct: 0.7, reps: 5 });
  });

  it("reports no SBS usage for a fully linear default", () => {
    expect(snapshotUsesSbs(getProgramDefault("stronglifts-5x5")!.snapshot)).toBe(false);
  });
});
