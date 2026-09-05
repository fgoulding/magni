import { describe, expect, it } from "vitest";
import { buildGroups, isFlatSingle, isBodyweight, buildSummaryRows, summaryDetail, type WorkoutSet } from "./workout-card-utils";

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

describe("editor prescription display", () => {
  it("keeps identical custom sets individually editable while preserving legacy flat groups", () => {
    const legacy = buildGroups([set(1, "Row"), set(2, "Row")])[0];
    expect(isFlatSingle(legacy)).toBe(true);
    const edited = buildGroups([set(1, "Row", { editor_json: '{"unit":"kg","set":{"loadMode":"working"}}' }), set(2, "Row", { editor_json: '{"unit":"kg","set":{"loadMode":"working"}}' })])[0];
    expect(isFlatSingle(edited)).toBe(false);
  });
  it("recognizes bodyweight on each editor set even in a mixed exercise", () => {
    expect(isBodyweight(set(1, "Pull-up", { progression_type: "custom", editor_json: '{"set":{"loadMode":"added"}}' }))).toBe(true);
    expect(isBodyweight(set(1, "Row", { progression_type: "bodyweight", editor_json: '{"set":{"loadMode":"working"}}' }))).toBe(false);
  });
  it("retains kg in summary labels and uses the actual saved weight", () => {
    const row = buildSummaryRows([set(1, "Row", { actual_reps: 10, actual_weight: 40, calculated_weight: 50, editor_json: '{"unit":"kg"}' })], new Set([1]), {})[0];
    expect(summaryDetail(row)).toBe("10 reps @ 40 kg");
    expect(row.tonnage).toBe(400);
  });
});
