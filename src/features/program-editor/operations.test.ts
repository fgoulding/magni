import { describe, expect, it } from "vitest";
import { createBlankDocument, createExercise, createSet, validateDocument } from "./document";
import { cloneDay, cloneWeek, applySharedConfiguration, makePreset, PRESETS } from "./operations";

describe("editor authoring operations", () => {
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
