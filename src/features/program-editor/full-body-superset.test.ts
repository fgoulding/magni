import { describe, expect, it } from "vitest";
import { validateDocument, type ProgramDocumentV1 } from "./document";
import { makePreset, PRESETS } from "./operations";

const presetId = "full-body-supersets-3-day";
const makeProgram = () => makePreset(presetId, "2026-10-13");
const allExercises = (document: ProgramDocumentV1) => document.weeks.flatMap(week => week.days.flatMap(day => day.exercises));
const identities = (document: ProgramDocumentV1) => document.weeks.flatMap(week => [week.id, ...week.days.flatMap(day => [day.id, ...day.exercises.flatMap(exercise => [exercise.id, exercise.progressionKey, ...exercise.sets.map(set => set.id)])])]);

describe("Full Body Supersets 3-Day default", () => {
  it("is discoverable and creates a valid repeating Monday, Wednesday, Friday program", () => {
    expect(PRESETS).toContainEqual(expect.objectContaining({ id: presetId, title: "Full Body Supersets 3-Day" }));
    const document = makeProgram();
    expect(document.name).toBe("Full Body Supersets 3-Day");
    expect(document.startDate).toBe("2026-10-13");
    expect(document.weekdays).toEqual([1, 3, 5]);
    expect(document.cycles).toBe(4);
    expect(document.weeks).toHaveLength(1);
    expect(validateDocument(document)).toEqual([]);
  });

  it("preserves all agreed exercise slots, rep ranges and five/five/three-round pairings", () => {
    const document = makeProgram();
    expect(document.weeks[0].days.map(day => ({
      name: day.name,
      exercises: day.exercises.map(exercise => [exercise.name, exercise.supersetGroup, exercise.sets.map(set => [set.repMin, set.repMax])]),
    }))).toEqual([
      { name: "Squat", exercises: [
        ["Barbell back squat", "A", Array(5).fill([4, 6])],
        ["One-arm dumbbell row", "A", Array(5).fill([8, 12])],
        ["Dumbbell Romanian deadlift", "B", Array(5).fill([8, 12])],
        ["Barbell Spoto press", "B", Array(5).fill([6, 8])],
        ["Pull-up", "C", Array(3).fill([5, 10])],
        ["Dumbbell lateral raise", "C", Array(3).fill([12, 20])],
      ] },
      { name: "Bench", exercises: [
        ["Barbell bench press", "A", Array(5).fill([4, 6])],
        ["B-stance dumbbell RDL", "A", Array(5).fill([8, 10])],
        ["Kettlebell Bulgarian split squat", "B", Array(5).fill([8, 10])],
        ["Standing dumbbell overhead press", "B", Array(5).fill([8, 12])],
        ["One-arm dumbbell row", "C", Array(3).fill([10, 12])],
        ["Dumbbell lateral raise", "C", Array(3).fill([12, 20])],
      ] },
      { name: "Deadlift", exercises: [
        ["Barbell deadlift", "A", Array(5).fill([3, 5])],
        ["Incline dumbbell bench press", "A", Array(5).fill([8, 12])],
        ["Kettlebell goblet squat", "B", Array(5).fill([10, 15])],
        ["Pull-up", "B", Array(5).fill([5, 10])],
        ["One-arm dumbbell row", "C", Array(3).fill([10, 15])],
        ["Single-leg dumbbell calf raise", "C", Array(3).fill([12, 20])],
      ] },
    ]);
    expect(allExercises(document)).toHaveLength(18);
    for (const day of document.weeks[0].days) {
      expect(day.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0)).toBe(26);
      for (const group of ["A", "B", "C"]) {
        const exercises = day.exercises.filter(exercise => exercise.supersetGroup === group);
        expect(exercises).toHaveLength(2);
        expect(exercises.filter(exercise => exercise.name.startsWith("Barbell"))).toHaveLength(group === "A" || (day.name === "Squat" && group === "B") ? 1 : 0);
      }
    }
    expect(allExercises(document).map(exercise => exercise.name).join(" ")).not.toMatch(/chest-supported|push-up|triceps|crunch|plank|dead bug/i);
  });

  it("requires user-selected loads and keeps each day's progression manual", () => {
    const document = makeProgram();
    for (const exercise of allExercises(document)) {
      expect(exercise).toMatchObject({ baseLoad: 0, trainingMax: 0, rule: null });
      expect(exercise.sets.every(set => set.role === "work" && set.load === 0 && set.loadMode === (exercise.name === "Pull-up" ? "bodyweight" : "working"))).toBe(true);
    }
    expect(document.description).toMatch(/choose.*working loads/i);
    expect(document.description).toMatch(/logged.*do not.*automatically/i);
    expect(document.description).toMatch(/all sets.*top.*range/i);
    expect(document.description).toMatch(/warm-up.*additional/i);
  });

  it("keeps effort, pair rest and technique instructions in frozen set metadata", () => {
    const document = makeProgram();
    for (const day of document.weeks[0].days) for (const [index, exercise] of day.exercises.entries()) {
      for (const set of exercise.sets) {
        expect(set.effortKind).toBe("rir");
        expect(set.effort).toBe(index === 1 ? 3 : 2);
        expect(set.restSeconds).toBe(index % 2 === 0 ? 45 : 120);
        expect(set.notes).not.toMatch(/placeholder|choose.*working load|editor|activation/i);
        if (index === 0) expect(set.notes).toMatch(/3–4 minutes between.*main lift/i);
        if (exercise.name === "One-arm dumbbell row") expect(set.notes).toMatch(/each side.*free hand.*bench/i);
        if (exercise.name === "B-stance dumbbell RDL") expect(set.notes).toMatch(/each side/);
        if (exercise.name === "Kettlebell Bulgarian split squat" || exercise.name === "Single-leg dumbbell calf raise") expect(set.notes).toMatch(/each leg/);
        if (exercise.name === "Barbell Spoto press") {
          expect(set.notes).toMatch(/1 second.*above.*chest/i);
          expect(set.tempo).toMatch(/1-second hover pause/);
        }
      }
      if (exercise.name === "Pull-up") {
        expect(exercise.notes).toMatch(/chin-up.*alternative/i);
        expect(exercise.notes).toMatch(/load basis.*bodyweight \+ load.*editor.*added load/i);
      }
    }
  });

  it("does not retain zero-load setup instructions in workout cues after choosing loads", () => {
    const document = makeProgram();
    for (const exercise of allExercises(document).filter(exercise => exercise.name !== "Pull-up")) {
      exercise.baseLoad = 135;
      expect(exercise.sets.every(set => !/placeholder|initial 0|choose.*load|editor|activation/i.test(set.notes))).toBe(true);
    }
    expect(document.description).toMatch(/initial 0 values are placeholders/);
  });

  it("creates fresh isolated identities while repeated lifts share only their history", () => {
    const first = makeProgram();
    const second = makeProgram();
    const firstIds = identities(first);
    expect(new Set(firstIds).size).toBe(firstIds.length);
    expect(identities(second).some(id => firstIds.includes(id))).toBe(false);
    for (const exercise of allExercises(first)) {
      const repeats = allExercises(first).filter(other => other.name === exercise.name);
      expect(new Set(repeats.map(other => other.historyKey)).size).toBe(1);
      expect(new Set(repeats.map(other => other.progressionKey)).size).toBe(repeats.length);
      expect(allExercises(second).some(other => other.historyKey === exercise.historyKey)).toBe(false);
    }
    first.weeks[0].days[0].exercises[0].sets[0].repMin = 99;
    expect(second.weeks[0].days[0].exercises[0].sets[0].repMin).toBe(4);
    expect(first.weeks[0].days[0].exercises[0].sets[1].repMin).toBe(4);
    expect(first.weeks[0].days[1].exercises[0].sets[0].repMin).toBe(4);
  });
});
