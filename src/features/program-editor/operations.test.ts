import { describe, expect, it } from "vitest";
import { createBlankDocument, createExercise, createSet, validateDocument } from "./document";
import { cloneDay, cloneWeek, copyBlock, getBlockRange, fillSelectedPrescriptions, prescriptionMatches, applySharedConfiguration, makePreset, PRESETS } from "./operations";

describe("editor authoring operations", () => {
  it("copies the contiguous block with fresh identities, separate name and shared progression", () => {
    const document = makePreset("percentage", "2026-09-05");
    const before = structuredClone(document.weeks);
    expect(getBlockRange(document.weeks, 1)).toEqual({ start: 0, end: 3 });
    expect(copyBlock(document, 1)).toBe(3);
    expect(document.weeks).toHaveLength(7);
    expect(document.weeks.slice(0, 3)).toEqual(before.slice(0, 3));
    expect(document.weeks[6]).toEqual(before[3]);
    expect(document.weeks.slice(3, 6).map(week => week.block)).toEqual(["Build copy", "Build copy", "Build copy"]);
    expect(document.weeks[3].days[0].exercises[0].progressionKey).toBe(before[0].days[0].exercises[0].progressionKey);
    expect(document.weeks[3].days[0].exercises[0].id).not.toBe(before[0].days[0].exercises[0].id);
    expect(validateDocument(document)).toEqual([]);
  });
  it("treats blank and separated block names as distinct groups and respects the week limit", () => {
    const document = makePreset("percentage", "2026-09-05");
    document.weeks[1].block = "";
    expect(getBlockRange(document.weeks, 0)).toEqual({ start: 0, end: 1 });
    expect(getBlockRange(document.weeks, 1)).toEqual({ start: 1, end: 2 });
    document.weeks = Array.from({ length: 52 }, () => cloneWeek(document.weeks[1]));
    const original = structuredClone(document);
    expect(() => copyBlock(document, 0)).toThrow(/52 weeks/);
    expect(document).toEqual(original);
  });
  it("gives repeated copies of a maximum-length block name distinct valid names", () => {
    const document = makePreset("linear", "2026-09-05");
    document.weeks[0].block = "A".repeat(140);
    document.weeks[0].name = "B".repeat(140);
    copyBlock(document, 0);
    copyBlock(document, 0);
    expect(new Set(document.weeks.map(week => week.block)).size).toBe(3);
    expect(validateDocument(document)).toEqual([]);
  });
  it("fills selected shared lift appearances, retaining local identity and other weeks/lifts", () => {
    const document = makePreset("top-backoff", "2026-09-05");
    document.weeks.push(cloneWeek(document.weeks[0]), cloneWeek(document.weeks[0]));
    const source = document.weeks[0].days[0].exercises[0];
    const target = document.weeks[2].days[0].exercises[0];
    const original = structuredClone(document);
    const independent = createExercise("Independent squat");
    document.weeks[2].days[0].exercises.push(independent);
    source.sets.unshift({ ...createSet(), role: "warmup", loadMode: "fixed", load: 45 });
    source.sets[1].restSeconds = 240;
    source.sets[1].notes = "Controlled pause";
    expect(prescriptionMatches(source, target)).toBe(false);
    expect(fillSelectedPrescriptions(document, source.id, [document.weeks[2].id])).toBe(1);
    expect(prescriptionMatches(source, target)).toBe(true);
    expect(document.weeks[1]).toEqual(original.weeks[1]);
    expect(document.weeks[2].days[0].exercises[1]).toEqual(independent);
    expect(target.id).toBe(original.weeks[2].days[0].exercises[0].id);
    expect(target.sets[1].id).toBe(original.weeks[2].days[0].exercises[0].sets[0].id);
    expect(target.rule?.condition).toMatchObject({ setId: target.sets[1].id });
    expect(validateDocument(document)).toEqual([]);
  });
  it("does not mutate any target when filling would remove its designated set", () => {
    const document = makePreset("top-backoff", "2026-09-05");
    document.weeks.push(cloneWeek(document.weeks[0]));
    const source = document.weeks[0].days[0].exercises[0];
    source.sets = source.sets.filter(set => set.role !== "top");
    const original = structuredClone(document);
    expect(() => fillSelectedPrescriptions(document, source.id, [document.weeks[1].id])).toThrow(/designated/);
    expect(document).toEqual(original);
  });
  it.each(PRESETS)("creates an activatable $title with unique structure and explicit rules", preset => {
    const document = makePreset(preset.id, "2026-09-05");
    expect(validateDocument(document)).toEqual([]);
    expect(document.weeks.flatMap(week => week.days).length).toBeGreaterThan(0);
  });
  it("copies a designated top set with fresh IDs and shared progression", () => {
    const document = makePreset("top-backoff", "2026-09-05");
    const original = document.weeks[0].days[0];
    const copied = cloneDay(original);
    const exercise = copied.exercises[0];
    expect(exercise.id).not.toBe(original.exercises[0].id);
    expect(exercise.progressionKey).toBe(original.exercises[0].progressionKey);
    expect(exercise.rule?.condition).toMatchObject({ setId: exercise.sets[0].id });
    document.weeks.push({ ...cloneWeek(document.weeks[0]), days: [copied] });
    expect(validateDocument(document)).toEqual([]);
  });
  it("updates shared rules with each appearance's designated set ID", () => {
    const document = makePreset("top-backoff", "2026-09-05");
    document.weeks.push(cloneWeek(document.weeks[0]));
    const first = document.weeks[0].days[0].exercises[0];
    first.baseLoad = 155;
    first.rule!.action.amount = 5;
    applySharedConfiguration(document, first);
    const second = document.weeks[1].days[0].exercises[0];
    expect(second.baseLoad).toBe(155);
    expect(second.rule?.condition).toMatchObject({ setId: second.sets[0].id });
    expect(validateDocument(document)).toEqual([]);
  });
  it("preserves the designated top set through a copied week's warm-up override and shared edits", () => {
    const document = makePreset("top-backoff", "2026-09-05");
    document.weeks.push(cloneWeek(document.weeks[0]));
    const first = document.weeks[0].days[0].exercises[0];
    const second = document.weeks[1].days[0].exercises[0];
    const designatedTopId = second.sets[0].id;
    const warmup = { ...createSet(), role: "warmup" as const, loadMode: "fixed" as const, load: 45 };
    second.sets.unshift(warmup);
    expect(validateDocument(document)).toEqual([]);

    first.baseLoad = 155;
    first.rule!.action.amount = 5;
    applySharedConfiguration(document, first);

    expect(second.baseLoad).toBe(155);
    expect(second.rule?.condition).toMatchObject({ setId: designatedTopId });
    expect(second.sets[0]).toEqual(warmup);
    expect(validateDocument(document)).toEqual([]);
  });
  it("keeps separate progressions and weekly set overrides intact", () => {
    const document = createBlankDocument();
    const first = createExercise("Row");
    document.weeks[0].days[0].exercises.push(first, createExercise("Separate row"));
    document.weeks.push(cloneWeek(document.weeks[0]));
    document.weeks[1].days[0].exercises[0].sets[0].repMin = 9;
    first.baseLoad = 65;
    applySharedConfiguration(document, first);
    expect(document.weeks[1].days[0].exercises[0].sets[0].repMin).toBe(9);
    expect(document.weeks[0].days[0].exercises[1].baseLoad).toBe(40);
  });
});
