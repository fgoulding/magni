import { describe, expect, it } from "vitest";
import { buildGroups, type WorkoutSet } from "./workout-card-utils";

function set(id: number, name: string, opts: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    id,
    exercise_name: name,
    reps: 5,
    sets: 1,
    set_number: 1,
    rep_out_target: 5,
    calculated_weight: 100,
    actual_reps: null,
    actual_weight: null,
    superset_group: null,
    ...opts,
  };
}

describe("buildGroups", () => {
  it("assigns ordinal group indices even when groups hold multiple sets", () => {
    // Bench day: a 3-set lift, then two supersets — exactly the shape that broke
    // group navigation when index was the flat set index instead of the ordinal.
    const sets: WorkoutSet[] = [
      set(1, "Bench"),
      set(2, "Bench", { set_number: 2 }),
      set(3, "Bench", { set_number: 3 }),
      set(4, "Split Squat", { superset_group: "a" }),
      set(5, "Lateral Raise", { superset_group: "a" }),
      set(6, "DB Row", { superset_group: "b" }),
      set(7, "Dip", { superset_group: "b" }),
    ];

    const groups = buildGroups(sets);

    // Three groups, indexed 0/1/2 — NOT the first-set indices 0/3/5.
    expect(groups.map((group) => group.index)).toEqual([0, 1, 2]);
    expect(groups[0].sets).toHaveLength(3);
    expect(groups[1].sets.map((s) => s.exercise_name)).toEqual(["Split Squat", "Lateral Raise"]);
    expect(groups[2].sets.map((s) => s.exercise_name)).toEqual(["DB Row", "Dip"]);
  });
});
