import { describe, expect, it } from "vitest";
import {
  getTemplateWeeks,
  getTrainingTemplate,
  isTrainingTemplateId,
  listTrainingTemplates,
} from "@/features/training-templates/registry";
import { btmTemplate } from "@/features/training-templates/templates/btm";
import { customTemplate } from "@/features/training-templates/templates/custom";
import { madcowTemplate } from "@/features/training-templates/templates/madcow";
import { sbsTemplate } from "@/features/training-templates/templates/sbs";
import type { TemplateWeek, TrainingTemplate } from "@/features/training-templates/types";

type Assert<T extends true> = T;
type IsReadonlyArray<T> = T extends readonly unknown[] ? (T extends unknown[] ? false : true) : false;

type DirectTemplateWeekArraysAreReadonly = [
  Assert<IsReadonlyArray<typeof customTemplate.weeksByCategory.main>>,
  Assert<IsReadonlyArray<typeof sbsTemplate.weeksByCategory.main>>,
  Assert<IsReadonlyArray<typeof sbsTemplate.weeksByCategory.aux>>,
  Assert<IsReadonlyArray<typeof madcowTemplate.weeksByCategory.main>>,
  Assert<IsReadonlyArray<typeof btmTemplate.weeksByCategory.main>>,
];

describe("training template registry", () => {
  it("types direct built-in template week arrays as readonly", () => {
    const directTemplateWeekArraysAreReadonly: DirectTemplateWeekArraysAreReadonly = [
      true, true, true, true, true,
    ];
    expect(directTemplateWeekArraysAreReadonly).toHaveLength(5);
  });

  it("lists templates with unique ids and contributor-facing metadata", () => {
    const templates = listTrainingTemplates();
    expect(templates.map((template) => template.id)).toEqual([
      "custom",
      "linear",
      "double",
      "sbs",
      "madcow",
      "btm",
    ]);
    expect(new Set(templates.map((template) => template.id)).size).toBe(templates.length);
    expect(templates.every((template) => template.name && template.description)).toBe(true);
  });

  it("returns category-specific weeks and falls back to main weeks", () => {
    expect(getTemplateWeeks("sbs", "main")[0]).toMatchObject({ weekNumber: 1, ramp: expect.any(Array) });
    expect(getTemplateWeeks("sbs", "aux")[0]).toMatchObject({ weekNumber: 1, ramp: expect.any(Array) });
    expect(getTemplateWeeks("madcow", "aux")).toEqual(getTemplateWeeks("madcow", "main"));
  });

  it("uses ramp sets for built-in templates", () => {
    const sbsMain = getTemplateWeeks("sbs", "main");
    expect(sbsMain).toHaveLength(7);
    expect(sbsMain[0].ramp).toHaveLength(5);
    expect(sbsMain[0].ramp![0]).toEqual({ setNumber: 1, intensityPct: 0.7, reps: 5, repOutTarget: 10 });

    const madcowMain = getTemplateWeeks("madcow", "main");
    expect(madcowMain).toHaveLength(1);
    expect(madcowMain[0].ramp![4]).toEqual({ setNumber: 5, intensityPct: 1.0, reps: 5, repOutTarget: 5 });

    const btmMain = getTemplateWeeks("btm", "main");
    expect(btmMain[0].ramp![0]).toEqual({ setNumber: 1, intensityPct: 0.7, reps: 5, repOutTarget: 7 });

    const linearMain = getTemplateWeeks("linear", "main");
    expect(linearMain[0].ramp).toHaveLength(3);
    expect(linearMain[0].ramp![0]).toEqual({ setNumber: 1, intensityPct: 1.0, reps: 5, repOutTarget: 5 });
  });

  it("identifies valid template ids and rejects unknown ids clearly", () => {
    expect(isTrainingTemplateId("sbs")).toBe(true);
    expect(isTrainingTemplateId("unknown")).toBe(false);
    expect(() => getTrainingTemplate("unknown")).toThrow("Unknown training template: unknown");
  });

  it("keeps custom progression non-automatic with fallback weeks", () => {
    const template = getTrainingTemplate("custom");
    expect(template.autoProgression).toBe(false);
    expect(getTemplateWeeks("custom", "main")).toEqual([]);
  });

  it("protects registry and week arrays from runtime mutation", () => {
    const originalIds = listTrainingTemplates().map((template) => template.id);
    const templates = listTrainingTemplates();

    try {
      (templates as unknown as TrainingTemplate[]).push(getTrainingTemplate("custom"));
    } catch {
      // expected — readonly
    }

    expect(listTrainingTemplates().map((template) => template.id)).toEqual(originalIds);

    const originalSbsMainWeeks = getTemplateWeeks("sbs", "main").map((week) => JSON.parse(JSON.stringify(week)));
    const sbsMainWeeks = getTemplateWeeks("sbs", "main");

    try {
      (sbsMainWeeks as unknown as TemplateWeek[]).push({
        weekNumber: 99, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0,
      });
    } catch {
      // expected — readonly
    }

    expect(getTemplateWeeks("sbs", "main")).toEqual(originalSbsMainWeeks);
  });

  it("protects nested weeks returned from template metadata from runtime mutation", () => {
    const originalSbsMainWeeks = getTemplateWeeks("sbs", "main").map((week) => JSON.parse(JSON.stringify(week)));
    const template = getTrainingTemplate("sbs");

    try {
      (template.weeksByCategory.main as unknown as TemplateWeek[]).push({
        weekNumber: 99, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0,
      });
    } catch {
      // expected — readonly
    }

    expect(getTemplateWeeks("sbs", "main")).toEqual(originalSbsMainWeeks);
  });

  it("freezes direct built-in template exports at runtime", () => {
    expect(() => {
      (sbsTemplate.weeksByCategory.main as unknown as TemplateWeek[]).push({
        weekNumber: 99, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0,
      });
    }).toThrow(TypeError);

    expect(() => {
      (sbsTemplate.weeksByCategory.main[0] as unknown as { reps: number }).reps = 99;
    }).toThrow(TypeError);

    const sbsMainWeeks = getTemplateWeeks("sbs", "main");
    expect(sbsMainWeeks[0].ramp).toHaveLength(5);
  });
});
