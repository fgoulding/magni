import { describe, expect, it } from "vitest";
import { calculateTemplateTrainingMaxDelta } from "@/features/training-templates/progression";

describe("template progression rules", () => {
  it("uses template progression for main lifts", () => {
    expect(
      calculateTemplateTrainingMaxDelta({
        templateId: "sbs",
        actualReps: 12,
        repOutTarget: 10,
        category: "main",
        currentTrainingMax: 300,
      }),
    ).toBe(5);
  });

  it("uses smaller progression changes for aux lifts", () => {
    expect(
      calculateTemplateTrainingMaxDelta({
        templateId: "sbs",
        actualReps: 12,
        repOutTarget: 10,
        category: "aux",
        currentTrainingMax: 200,
      }),
    ).toBe(2.5);
  });

  it("does not change training maxes for custom progression", () => {
    expect(
      calculateTemplateTrainingMaxDelta({
        templateId: "custom",
        actualReps: 20,
        repOutTarget: 10,
        category: "main",
        currentTrainingMax: 300,
      }),
    ).toBe(0);
  });

  it("bumps double progression only when the top of the rep range is reached", () => {
    expect(
      calculateTemplateTrainingMaxDelta({
        templateId: "double",
        actualReps: 12,
        repOutTarget: 12,
        category: "accessory",
        currentTrainingMax: 100,
      }),
    ).toBe(2.5);
    expect(
      calculateTemplateTrainingMaxDelta({
        templateId: "double",
        actualReps: 11,
        repOutTarget: 12,
        category: "accessory",
        currentTrainingMax: 100,
      }),
    ).toBe(0);
    expect(
      calculateTemplateTrainingMaxDelta({
        templateId: "double",
        actualReps: 8,
        repOutTarget: 8,
        category: "main",
        currentTrainingMax: 225,
      }),
    ).toBe(5);
  });

  it("advances madcow only on hitting reps and never drops on a miss", () => {
    expect(
      calculateTemplateTrainingMaxDelta({
        templateId: "madcow",
        actualReps: 5,
        repOutTarget: 5,
        category: "main",
        currentTrainingMax: 300,
      }),
    ).toBe(5);
    expect(
      calculateTemplateTrainingMaxDelta({
        templateId: "madcow",
        actualReps: 3,
        repOutTarget: 5,
        category: "main",
        currentTrainingMax: 300,
      }),
    ).toBe(0);
  });

  it("falls back to category progression for unknown stored template ids", () => {
    expect(
      calculateTemplateTrainingMaxDelta({
        templateId: "legacy-import",
        actualReps: 12,
        repOutTarget: 10,
        category: "main",
        currentTrainingMax: 300,
      }),
    ).toBe(5);
  });
});
