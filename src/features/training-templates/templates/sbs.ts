import { defineTrainingTemplate } from "@/features/training-templates/define";
import type { TemplateWeek } from "@/features/training-templates/types";

function flatRamp(sets: number, reps: number, intensityPct: number, repOutTarget: number) {
  return Array.from({ length: sets }, (_, i) => ({
    setNumber: i + 1,
    intensityPct,
    reps,
    repOutTarget,
  }));
}

// Cycle 1 (base) — one 7-week SBS block. Two undulating waves (5s/4s/3s) then a
// deload. The last set each week is taken to failure (AMRAP) against repOutTarget.
const SBS_MAIN_C1: TemplateWeek[] = [
  { weekNumber: 1, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 5, 0.7, 10) },
  { weekNumber: 2, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 4, 0.75, 8) },
  { weekNumber: 3, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 3, 0.8, 6) },
  { weekNumber: 4, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 5, 0.725, 9) },
  { weekNumber: 5, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 4, 0.775, 7) },
  { weekNumber: 6, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 3, 0.825, 5) },
  { weekNumber: 7, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 7, 0.6, 14) },
];

const SBS_AUX_C1: TemplateWeek[] = [
  { weekNumber: 1, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 7, 0.6, 14) },
  { weekNumber: 2, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 6, 0.65, 12) },
  { weekNumber: 3, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 5, 0.7, 10) },
  { weekNumber: 4, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 7, 0.625, 13) },
  { weekNumber: 5, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 6, 0.675, 11) },
  { weekNumber: 6, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 5, 0.725, 9) },
  { weekNumber: 7, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 8, 0.5, 18) },
];

// Cycle 3 Main — taken verbatim from the official SBS sheet (weeks 15-21). Its
// second wave (weeks 4-6) is heavier than a uniform +5%/cycle shift would give,
// so it can't be derived from cycle 1 by formula and is listed explicitly.
const SBS_MAIN_C3: TemplateWeek[] = [
  { weekNumber: 1, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 3, 0.8, 6) },
  { weekNumber: 2, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 2, 0.85, 4) },
  { weekNumber: 3, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 1, 0.9, 2) },
  { weekNumber: 4, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 2, 0.85, 4) },
  { weekNumber: 5, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 1, 0.9, 2) },
  { weekNumber: 6, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 1, 0.95, 1) },
  { weekNumber: 7, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 7, 0.6, 14) },
];

// Cycle 1→2 is a uniform shift vs cycle 1: +5% intensity, -1 rep, -2 AMRAP target
// per working week (deload unchanged). Cycle 1 (delta 0) and cycle 2 use this.
function shiftCycle(weeks: readonly TemplateWeek[], cycle: number): TemplateWeek[] {
  const addPct = (cycle - 1) * 0.05;
  const repDelta = cycle - 1;
  const targetDelta = 2 * (cycle - 1);
  return weeks.map((week, index) => {
    if (index === weeks.length - 1 || !week.ramp) return { ...week };
    return {
      ...week,
      ramp: week.ramp.map((set) => ({
        ...set,
        intensityPct: Math.round((set.intensityPct + addPct) * 1000) / 1000,
        reps: Math.max(1, set.reps - repDelta),
        repOutTarget: Math.max(1, set.repOutTarget - targetDelta),
      })),
    };
  });
}

// Main lifts follow the sheet directly; cycle 3 is explicit, others are the
// uniform shift (which equals the sheet for cycle 2).
function sbsMainWeeks(cycle: number): TemplateWeek[] {
  return cycle === 3 ? SBS_MAIN_C3.map((week) => ({ ...week })) : shiftCycle(SBS_MAIN_C1, cycle);
}

// No sheet was provided for the aux lifts past cycle 1, so each cycle's aux is
// shifted by the SAME per-week (intensity/reps/target) delta the Main lifts take
// that cycle — keeping aux structurally in step with the authoritative main plan.
function sbsAuxWeeks(cycle: number): TemplateWeek[] {
  const mainNow = sbsMainWeeks(cycle);
  return SBS_AUX_C1.map((week, index) => {
    if (index === SBS_AUX_C1.length - 1 || !week.ramp) return { ...week };
    const base = SBS_MAIN_C1[index].ramp![0];
    const shifted = mainNow[index].ramp![0];
    const dInt = shifted.intensityPct - base.intensityPct;
    const dReps = shifted.reps - base.reps;
    const dTarget = shifted.repOutTarget - base.repOutTarget;
    return {
      ...week,
      ramp: week.ramp.map((set) => ({
        ...set,
        intensityPct: Math.round((set.intensityPct + dInt) * 1000) / 1000,
        reps: Math.max(1, set.reps + dReps),
        repOutTarget: Math.max(1, set.repOutTarget + dTarget),
      })),
    };
  });
}

function sbsCycle(id: string, cycle: number) {
  return defineTrainingTemplate({
    id,
    name: `SBS — Cycle ${cycle}`,
    description:
      cycle === 1
        ? "7-week SBS block (cycle 1 of 3). Last set is AMRAP; your training max adjusts to how far you beat the rep target."
        : `7-week SBS block (cycle ${cycle} of 3) — heavier loads at lower reps than cycle ${cycle - 1}. Run on the training max you earned in the previous cycle.`,
    supportedCategories: ["main", "aux"],
    autoProgression: true,
    weeksByCategory: {
      main: sbsMainWeeks(cycle),
      aux: sbsAuxWeeks(cycle),
    },
  });
}

// id "sbs" stays cycle 1 for backward compatibility with existing programs/defaults.
export const sbsTemplate = sbsCycle("sbs", 1);
export const sbsCycle2Template = sbsCycle("sbs-c2", 2);
export const sbsCycle3Template = sbsCycle("sbs-c3", 3);
