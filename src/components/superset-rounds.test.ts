import { describe, expect, it } from "vitest";
import { buildSupersetRounds } from "./superset-rounds";
import type { WorkoutGroup, WorkoutSet } from "./workout-card-utils";

function row(id: number, name: string, number: number, fields: Partial<WorkoutSet> = {}): WorkoutSet {
  return { id, exercise_name: name, reps: 5, sets: 1, set_number: number, rep_out_target: 5, calculated_weight: 100, actual_reps: null, actual_weight: null, superset_group: "A", ...fields };
}
const group = (sets: WorkoutSet[]): WorkoutGroup => ({ index: 0, sets, supersetGroup: "A" });
const projection = (sets: WorkoutSet[]) => buildSupersetRounds(group(sets))?.map(round => round.entries.map(entry => [entry.set.id, entry.label]));

describe("superset round projection", () => {
  it("interleaves authored appearances without sorting or changing original rows", () => {
    const sets = [row(8, "Squat", 1, { exercise_key: "squat" }), row(4, "Squat", 2, { exercise_key: "squat" }), row(7, "Row", 1, { exercise_key: "row" }), row(2, "Row", 2, { exercise_key: "row" })];
    const snapshot = structuredClone(sets);
    expect(projection(sets)).toEqual([[[8, "1a"], [7, "1b"]], [[4, "2a"], [2, "2b"]]]);
    expect(sets).toEqual(snapshot);
    expect(buildSupersetRounds(group(sets))![0].entries[0].set).toBe(sets[0]);
  });

  it("uses editor appearance IDs before definition IDs, exercise keys or shared progression", () => {
    const sets = ["first", "second"].flatMap((exerciseId, i) => [1, 2].map(number => row(i * 2 + number, "Row", number, {
      program_definition_exercise_id: 5, exercise_key: "shared-row", editor_json: JSON.stringify({ exerciseId, progressionKey: "shared-progression" }),
    })));
    expect(projection(sets)).toEqual([[[1, "1a"], [3, "1b"]], [[2, "2a"], [4, "2b"]]]);
  });

  it("uses definition appearance IDs before a repeated exercise key", () => {
    const sets = [1, 2].flatMap(appearance => [1, 2].map(number => row(appearance * 10 + number, "Row", number, { program_definition_exercise_id: appearance, exercise_key: "shared-row" })));
    expect(projection(sets)).toEqual([[[11, "1a"], [21, "1b"]], [[12, "2a"], [22, "2b"]]]);
  });

  it("splits legacy same-name appearances on set-number reset, regardless of shared progression", () => {
    const sets = [row(1, "Row", 1), row(2, "Row", 2), row(3, "Row", 1), row(4, "Row", 2)].map(set => ({ ...set, editor_json: JSON.stringify({ progressionKey: "shared" }) }));
    expect(projection(sets)).toEqual([[[1, "1a"], [3, "1b"]], [[2, "2a"], [4, "2b"]]]);
  });

  it("keeps legacy name runs distinct and never invents missing triplet partners", () => {
    const sets = [row(1, "Squat", 1), row(2, "Squat", 2), row(3, "Row", 1), row(4, "Squat", 1), row(5, "Squat", 2), row(6, "Squat", 3)];
    expect(projection(sets)).toEqual([[[1, "1a"], [3, "1b"], [4, "1c"]], [[2, "2a"], [5, "2c"]], [[6, "3c"]]]);
  });

  it("does not fabricate rounds for aggregate batches, a single appearance, or ordinary lifts", () => {
    expect(buildSupersetRounds(group([row(1, "Squat", 1, { sets: 3 }), row(2, "Row", 1)]))).toBeNull();
    expect(buildSupersetRounds(group([row(1, "Squat", 1), row(2, "Squat", 2)]))).toBeNull();
    expect(buildSupersetRounds({ ...group([row(1, "Squat", 1), row(2, "Row", 1)]), supersetGroup: null })).toBeNull();
  });
});
