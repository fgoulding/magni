import { describe, expect, it } from "vitest";
import { createBlankDocument, createExercise, validateDocument } from "@/features/program-editor/document";
import { makePreset } from "@/features/program-editor/operations";
import { copyBuilderExercise, addBuilderSuperset, compactPrescription, resizeBuilderSets, moveBuilderGroup, builderGroups, updateBuilderLoad, previewBuilderSchedule } from "./program-builder-operations";

describe("human program builder operations", () => {
  it("adds two independent paired exercises with no guessed working weight", () => {
    const document = createBlankDocument();
    addBuilderSuperset(document.weeks[0].days[0]);
    const [first, second] = document.weeks[0].days[0].exercises;
    expect(first.supersetGroup).toBe(second.supersetGroup);
    expect(first.supersetGroup).not.toBe("");
    expect(first.progressionKey).not.toBe(second.progressionKey);
    expect(first.baseLoad).toBe(0);
    expect(second.sets).toHaveLength(3);
  });
  it("compacts equal sets but never mixed roles, notes, loading or designated sets", () => {
    const exercise = createExercise("Squat");
    expect(compactPrescription(exercise)).not.toBeNull();
    exercise.sets[1].notes = "Pause";
    expect(compactPrescription(exercise)).toBeNull();
    const advanced = makePreset("top-backoff", "2026-10-13").weeks[0].days[0].exercises[0];
    expect(compactPrescription(advanced)).toBeNull();
  });
  it("resizes equal sets preserving existing identities and prescription details", () => {
    const exercise = createExercise("Row");
    exercise.sets.forEach(set => { set.tempo = "3-1-1"; set.notes = "Pause"; });
    const before = structuredClone(exercise.sets);
    resizeBuilderSets(exercise, 5);
    expect(exercise.sets.slice(0, 3)).toEqual(before);
    expect(exercise.sets[4]).toMatchObject({ tempo: "3-1-1", notes: "Pause" });
    expect(new Set(exercise.sets.map(set => set.id)).size).toBe(5);
    exercise.sets[0].role = "top";
    expect(() => resizeBuilderSets(exercise, 1)).toThrow(/individual/i);
    expect(exercise.sets).toHaveLength(5);
  });
  it("moves supersets together without changing their members", () => {
    const day = createBlankDocument().weeks[0].days[0];
    addBuilderSuperset(day); addBuilderSuperset(day);
    const before = structuredClone(day.exercises);
    moveBuilderGroup(day, 0, 1);
    expect(day.exercises).toEqual([...before.slice(2), ...before.slice(0, 2)]);
    expect(builderGroups(day)[0].exercises).toHaveLength(2);
  });
  it("copies a superset member after its pair without splitting the original group", () => {
    const day = createBlankDocument().weeks[0].days[0]; addBuilderSuperset(day);
    const original = structuredClone(day.exercises);
    copyBuilderExercise(day, original[0].id);
    expect(day.exercises.slice(0, 2)).toEqual(original);
    expect(builderGroups(day).map(group => group.exercises.length)).toEqual([2, 1]);
    expect(day.exercises[2].progressionKey).not.toBe(original[0].progressionKey);
  });
  it("makes shared load behavior explicit while retaining unrelated loads", () => {
    const document = makePreset("double", "2026-10-13");
    const first = document.weeks[0].days[0].exercises[0];
    updateBuilderLoad(document, first.id, 42.5);
    for (const exercise of document.weeks.flatMap(w => w.days.flatMap(d => d.exercises))) {
      if (exercise.progressionKey === first.progressionKey) expect(exercise.baseLoad).toBe(42.5);
    }
    expect(validateDocument(document)).toEqual([]);
  });
  it("previews real selected weekday slots across repeated days", () => {
    const document = makePreset("manual-ab", "2026-10-13");
    document.weekdays = [1, 3, 5]; document.cycles = 2;
    const slots = previewBuilderSchedule(document);
    expect(slots[0].date).toBe("2026-10-14");
    expect(slots[1].date).toBe("2026-10-16");
    expect(slots).toHaveLength(document.weeks.reduce((n, w) => n + w.days.length, 0) * 2);
  });
});
