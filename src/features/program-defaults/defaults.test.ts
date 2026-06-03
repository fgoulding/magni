import { describe, expect, it } from "vitest";
import { parseSharedProgramSnapshot } from "@/features/shared-programs/snapshot";
import { getProgramDefault, listProgramDefaults } from "./defaults";

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
});
