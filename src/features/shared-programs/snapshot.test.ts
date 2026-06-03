import { describe, expect, it } from "vitest";
import {
  diffSharedProgramSnapshots,
  parseSharedProgramSnapshot,
  serializeSharedProgramSnapshot,
} from "@/features/shared-programs/snapshot";
import type {
  SharedProgramDaySnapshot,
  SharedProgramExerciseSlotSnapshot,
  SharedProgramSnapshot,
} from "@/features/shared-programs/types";

type SnapshotInput = Partial<Omit<SharedProgramSnapshot, "days">> & {
  readonly days?: readonly SharedProgramDaySnapshot[];
  readonly exercises?: readonly (SharedProgramExerciseSlotSnapshot & { readonly dayKey?: string })[];
};

const defaultWeeks = [{ weekNumber: 1, intensityPct: 0.7, reps: 5, sets: 3, repOutTarget: 8 }] as const;

function makeExercise(
  overrides: Partial<SharedProgramExerciseSlotSnapshot> = {},
): SharedProgramExerciseSlotSnapshot {
  return {
    key: "squat",
    name: "Squat",
    category: "main",
    progressionType: "sbs",
    weeks: defaultWeeks,
    ...overrides,
  };
}

function makeDay(overrides: Partial<SharedProgramDaySnapshot> = {}): SharedProgramDaySnapshot {
  return {
    key: "lower",
    name: "Lower",
    exercises: [makeExercise()],
    ...overrides,
  };
}

function makeDayFromExercises(
  key: string,
  exercises: readonly SharedProgramExerciseSlotSnapshot[],
): SharedProgramDaySnapshot {
  return makeDay({
    key,
    name: key[0] ? `${key[0].toUpperCase()}${key.slice(1)}` : key,
    exercises,
  });
}

function makeSnapshot(input: SnapshotInput = {}): SharedProgramSnapshot {
  const { days: inputDays, exercises: inputExercises, ...snapshotOverrides } = input;
  const exercisesByDay = new Map<string, SharedProgramExerciseSlotSnapshot[]>();

  for (const exercise of inputExercises ?? []) {
    const dayKey = exercise.dayKey ?? "lower";
    const exercises = exercisesByDay.get(dayKey) ?? [];

    exercises.push({
      key: exercise.key,
      name: exercise.name,
      category: exercise.category,
      progressionType: exercise.progressionType,
      weeks: exercise.weeks,
    });
    exercisesByDay.set(dayKey, exercises);
  }

  const days =
    inputDays ??
    (exercisesByDay.size > 0
      ? [...exercisesByDay].map(([dayKey, exercises]) => makeDayFromExercises(dayKey, exercises))
      : [makeDay()]);

  return {
    schemaVersion: 1,
    name: "Shared Strength",
    description: "A synced program snapshot",
    numWeeks: 7,
    days,
    ...snapshotOverrides,
  };
}

describe("shared program snapshots", () => {
  it("round-trips valid snapshots through JSON", () => {
    const snapshot = makeSnapshot({
      days: [
        makeDay({
          key: "upper",
          name: "Upper",
          exercises: [
            makeExercise({
              key: "bench",
              name: "Bench Press",
              category: "aux",
              progressionType: "madcow",
            }),
          ],
        }),
      ],
    });

    expect(parseSharedProgramSnapshot(serializeSharedProgramSnapshot(snapshot))).toEqual(snapshot);
  });

  it("requires stable day and exercise keys", () => {
    expect(() =>
      parseSharedProgramSnapshot(
        JSON.stringify({
          ...makeSnapshot(),
          days: [{ name: "Lower", exercises: [makeExercise()] }],
        }),
      ),
    ).toThrow("Day key is required");

    expect(() =>
      parseSharedProgramSnapshot(
        JSON.stringify({
          ...makeSnapshot(),
          days: [makeDay({ exercises: [{ ...makeExercise(), key: "" }] })],
        }),
      ),
    ).toThrow("Exercise key is required");
  });

  it("rejects duplicate keys, missing days, and unsupported categories", () => {
    expect(() => parseSharedProgramSnapshot(JSON.stringify(makeSnapshot({ days: [] })))).toThrow(
      "At least one day is required",
    );

    expect(() =>
      parseSharedProgramSnapshot(
        JSON.stringify({
          ...makeSnapshot(),
          days: [makeDay(), makeDay({ name: "Lower B" })],
        }),
      ),
    ).toThrow("Duplicate day key: lower");

    expect(() =>
      parseSharedProgramSnapshot(
        JSON.stringify({
          ...makeSnapshot(),
          days: [
            makeDay({
              exercises: [makeExercise(), makeExercise({ name: "Paused Squat" })],
            }),
          ],
        }),
      ),
    ).toThrow("Duplicate exercise key: squat");

    expect(() =>
      parseSharedProgramSnapshot(
        JSON.stringify({
          ...makeSnapshot(),
          days: [
            makeDay({
              exercises: [makeExercise({ category: "conditioning" as "main" })],
            }),
          ],
        }),
      ),
    ).toThrow("Unsupported exercise category: conditioning");
  });

  it("diffs added, removed, renamed, and reordered days by stable key", () => {
    const before = makeSnapshot({
      days: [
        makeDay({ key: "lower", name: "Lower" }),
        makeDay({ key: "upper", name: "Upper" }),
        makeDay({ key: "arms", name: "Arms" }),
      ],
    });
    const after = makeSnapshot({
      days: [
        makeDay({ key: "conditioning", name: "Conditioning" }),
        makeDay({ key: "upper", name: "Upper Body" }),
        makeDay({ key: "lower", name: "Lower" }),
      ],
    });

    expect(diffSharedProgramSnapshots(before, after).dayChanges).toEqual([
      { type: "added", key: "conditioning", name: "Conditioning", index: 0 },
      { type: "removed", key: "arms", name: "Arms", index: 2 },
      { type: "renamed", key: "upper", from: "Upper", to: "Upper Body" },
      { type: "reordered", key: "lower", fromIndex: 0, toIndex: 2 },
    ]);
  });

  it("diffs added, removed, renamed, and reordered exercise slots by stable key", () => {
    const before = makeSnapshot({
      days: [
        makeDay({
          exercises: [
            makeExercise({ key: "squat", name: "Squat" }),
            makeExercise({ key: "rdl", name: "RDL", category: "aux" }),
            makeExercise({ key: "curl", name: "Curl", category: "accessory" }),
          ],
        }),
      ],
    });
    const after = makeSnapshot({
      days: [
        makeDay({
          exercises: [
            makeExercise({ key: "bench", name: "Bench Press", category: "aux" }),
            makeExercise({ key: "rdl", name: "Romanian Deadlift", category: "aux" }),
            makeExercise({ key: "squat", name: "Squat" }),
          ],
        }),
      ],
    });

    expect(diffSharedProgramSnapshots(before, after).exerciseChanges).toEqual([
      { type: "added", dayKey: "lower", key: "bench", name: "Bench Press", index: 0 },
      { type: "removed", dayKey: "lower", key: "curl", name: "Curl", index: 2 },
      { type: "renamed", dayKey: "lower", key: "rdl", from: "RDL", to: "Romanian Deadlift" },
      { type: "reordered", dayKey: "lower", key: "squat", fromIndex: 0, toIndex: 2 },
    ]);
  });

  it("diffs renamed exercise slots by stable key", () => {
    const before = makeSnapshot({
      exercises: [
        {
          ...makeExercise({ key: "squat", name: "Squat", category: "main", progressionType: "sbs" }),
          dayKey: "lower",
        },
      ],
    });
    const after = makeSnapshot({
      exercises: [
        {
          ...makeExercise({ key: "squat", name: "Comp Squat", category: "main", progressionType: "sbs" }),
          dayKey: "lower",
        },
      ],
    });

    expect(diffSharedProgramSnapshots(before, after).exerciseChanges).toContainEqual({
      type: "renamed",
      dayKey: "lower",
      key: "squat",
      from: "Squat",
      to: "Comp Squat",
    });
  });

  it("diffs exercise slots moved across days by stable key", () => {
    const before = makeSnapshot({
      exercises: [
        { ...makeExercise({ key: "squat", name: "Squat" }), dayKey: "lower" },
        { ...makeExercise({ key: "bench", name: "Bench Press", category: "aux" }), dayKey: "upper" },
      ],
    });
    const after = makeSnapshot({
      exercises: [
        { ...makeExercise({ key: "bench", name: "Bench Press", category: "aux" }), dayKey: "upper" },
        { ...makeExercise({ key: "squat", name: "Squat" }), dayKey: "upper" },
      ],
    });

    expect(diffSharedProgramSnapshots(before, after).exerciseChanges).toContainEqual({
      type: "moved",
      key: "squat",
      name: "Squat",
      fromDayKey: "lower",
      toDayKey: "upper",
      fromIndex: 0,
      toIndex: 1,
    });
  });

  it("diffs template and week-scheme changes", () => {
    const before = makeSnapshot({
      exercises: [
        {
          ...makeExercise({
            key: "squat",
            name: "Squat",
            progressionType: "sbs",
            weeks: [{ weekNumber: 1, intensityPct: 0.7, reps: 5, sets: 3, repOutTarget: 8 }],
          }),
          dayKey: "lower",
        },
      ],
    });
    const after = makeSnapshot({
      numWeeks: 8,
      exercises: [
        {
          ...makeExercise({
            key: "squat",
            name: "Squat",
            progressionType: "madcow",
            weeks: [{ weekNumber: 1, intensityPct: 0.75, reps: 5, sets: 5, repOutTarget: 5 }],
          }),
          dayKey: "lower",
        },
      ],
    });

    expect(diffSharedProgramSnapshots(before, after).templateChanges).toEqual([
      { type: "numWeeksChanged", from: 7, to: 8 },
      { type: "progressionTypeChanged", dayKey: "lower", key: "squat", from: "sbs", to: "madcow" },
      { type: "weeksChanged", dayKey: "lower", key: "squat" },
    ]);
  });

  it("diffs category changes by stable exercise key", () => {
    const before = makeSnapshot({
      exercises: [{ ...makeExercise({ key: "squat", name: "Squat", category: "main" }), dayKey: "lower" }],
    });
    const after = makeSnapshot({
      exercises: [{ ...makeExercise({ key: "squat", name: "Squat", category: "aux" }), dayKey: "lower" }],
    });

    expect(diffSharedProgramSnapshots(before, after).templateChanges).toContainEqual({
      type: "categoryChanged",
      dayKey: "lower",
      key: "squat",
      from: "main",
      to: "aux",
    });
  });

  it("rejects numeric values outside the persisted snapshot domain", () => {
    expect(() => parseSharedProgramSnapshot(JSON.stringify(makeSnapshot({ numWeeks: 0 })))).toThrow(
      "Snapshot numWeeks must be a positive integer",
    );

    expect(() =>
      parseSharedProgramSnapshot(
        JSON.stringify({
          ...makeSnapshot(),
          days: [
            makeDay({
              exercises: [
                makeExercise({
                  weeks: [{ weekNumber: 1.5, intensityPct: 0.7, reps: 5, sets: 3, repOutTarget: 8 }],
                }),
              ],
            }),
          ],
        }),
      ),
    ).toThrow("Week number must be a positive integer");

    expect(() =>
      parseSharedProgramSnapshot(
        JSON.stringify({
          ...makeSnapshot(),
          days: [
            makeDay({
              exercises: [
                makeExercise({
                  weeks: [{ weekNumber: 1, intensityPct: 1.1, reps: 5, sets: 3, repOutTarget: 8 }],
                }),
              ],
            }),
          ],
        }),
      ),
    ).toThrow("Week intensity percent must be between 0 and 1");

    expect(() =>
      parseSharedProgramSnapshot(
        JSON.stringify({
          ...makeSnapshot(),
          days: [
            makeDay({
              exercises: [
                makeExercise({
                  weeks: [{ weekNumber: 1, intensityPct: 0.7, reps: 0, sets: 3, repOutTarget: 8 }],
                }),
              ],
            }),
          ],
        }),
      ),
    ).toThrow("Week reps must be a positive integer");

    expect(() =>
      parseSharedProgramSnapshot(
        JSON.stringify({
          ...makeSnapshot(),
          days: [
            makeDay({
              exercises: [
                makeExercise({
                  weeks: [{ weekNumber: 1, intensityPct: 0.7, reps: 5, sets: 0, repOutTarget: 8 }],
                }),
              ],
            }),
          ],
        }),
      ),
    ).toThrow("Week sets must be a positive integer");

    expect(() =>
      parseSharedProgramSnapshot(
        JSON.stringify({
          ...makeSnapshot(),
          days: [
            makeDay({
              exercises: [
                makeExercise({
                  weeks: [{ weekNumber: 1, intensityPct: 0.7, reps: 5, sets: 3, repOutTarget: -1 }],
                }),
              ],
            }),
          ],
        }),
      ),
    ).toThrow("Week rep-out target must be a non-negative integer");
  });
});
