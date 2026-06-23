import { describe, expect, it } from "vitest";
import {
  getTemplateWeeks,
  getTrainingTemplate,
  isTrainingTemplateId,
  listTrainingTemplates,
} from "@/features/training-templates/registry";
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
];

describe("training template registry", () => {
  it("types direct built-in template week arrays as readonly", () => {
    const directTemplateWeekArraysAreReadonly: DirectTemplateWeekArraysAreReadonly = [
      true, true, true, true,
    ];
    expect(directTemplateWeekArraysAreReadonly).toHaveLength(4);
  });

  it("lists templates with unique ids and contributor-facing metadata", () => {
    const templates = listTrainingTemplates();
    expect(templates.map((template) => template.id)).toEqual([
      "custom",
      "bodyweight",
      "linear",
      "double",
      "sbs",
      "sbs-c2",
      "sbs-c3",
      "madcow",
    ]);
    expect(new Set(templates.map((template) => template.id)).size).toBe(templates.length);
    expect(templates.every((template) => template.name && template.description)).toBe(true);
  });

  it("shifts each SBS cycle +5% intensity, -1 rep, -2 AMRAP target (deload unchanged)", () => {
    const c1 = getTemplateWeeks("sbs", "main");
    const c2 = getTemplateWeeks("sbs-c2", "main");
    const c3 = getTemplateWeeks("sbs-c3", "main");

    // Cycle 2 Main matches the official SBS sheet (weeks 8-14) exactly:
    // 75/5×4/t8 · 80/5×3/t6 · 85/5×2/t4 · 77.5/5×4/t7 · 82.5/5×3/t5 · 87.5/5×2/t3 · deload 60/5×7/t14.
    const c2Main = c2.map((week) => ({
      intensityPct: week.ramp![0].intensityPct,
      sets: week.ramp!.length,
      reps: week.ramp![0].reps,
      repOutTarget: week.ramp![0].repOutTarget,
    }));
    expect(c2Main).toEqual([
      { intensityPct: 0.75, sets: 5, reps: 4, repOutTarget: 8 },
      { intensityPct: 0.8, sets: 5, reps: 3, repOutTarget: 6 },
      { intensityPct: 0.85, sets: 5, reps: 2, repOutTarget: 4 },
      { intensityPct: 0.775, sets: 5, reps: 4, repOutTarget: 7 },
      { intensityPct: 0.825, sets: 5, reps: 3, repOutTarget: 5 },
      { intensityPct: 0.875, sets: 5, reps: 2, repOutTarget: 3 },
      { intensityPct: 0.6, sets: 5, reps: 7, repOutTarget: 14 },
    ]);

    // Cycle 3 reps/targets per the user's spec: reps 3·2·1·3·2·1, target 6·4·2·5·3·1.
    expect(c3.slice(0, 6).map((w) => w.ramp![0].reps)).toEqual([3, 2, 1, 3, 2, 1]);
    expect(c3.slice(0, 6).map((w) => w.ramp![0].repOutTarget)).toEqual([6, 4, 2, 5, 3, 1]);
    expect(c1[0].ramp![0]).toMatchObject({ intensityPct: 0.7, reps: 5, repOutTarget: 10 });
    expect(c3[0].ramp![0]).toMatchObject({ intensityPct: 0.8, reps: 3, repOutTarget: 6 });
    // The deload (week 7) is identical in every cycle.
    expect(c1[6].ramp![0]).toEqual(c2[6].ramp![0]);
    expect(c1[6].ramp![0]).toEqual(c3[6].ramp![0]);
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
