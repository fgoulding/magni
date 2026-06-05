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

// SBS runs as three 7-week cycles. Each cycle adds +5% intensity to the working
// weeks over the previous one; reps, AMRAP targets, and the final deload week are
// unchanged. The training max still moves session-to-session off your AMRAPs.
function shiftIntensity(weeks: readonly TemplateWeek[], addPct: number): TemplateWeek[] {
  return weeks.map((week, index) => {
    // Final week is the deload — same load in every cycle.
    if (index === weeks.length - 1 || !week.ramp) return { ...week };
    return {
      ...week,
      ramp: week.ramp.map((set) => ({
        ...set,
        intensityPct: Math.round((set.intensityPct + addPct) * 1000) / 1000,
      })),
    };
  });
}

function sbsCycle(id: string, cycle: number) {
  const addPct = (cycle - 1) * 0.05;
  return defineTrainingTemplate({
    id,
    name: `SBS — Cycle ${cycle}`,
    description:
      cycle === 1
        ? "7-week SBS block (cycle 1 of 3). Last set is AMRAP; your training max adjusts to how far you beat the rep target."
        : `7-week SBS block (cycle ${cycle} of 3) — +${(cycle - 1) * 5}% intensity over cycle 1. Run after cycle ${cycle - 1} on the training max you earned.`,
    supportedCategories: ["main", "aux"],
    autoProgression: true,
    weeksByCategory: {
      main: shiftIntensity(SBS_MAIN_C1, addPct),
      aux: shiftIntensity(SBS_AUX_C1, addPct),
    },
  });
}

// id "sbs" stays cycle 1 for backward compatibility with existing programs/defaults.
export const sbsTemplate = sbsCycle("sbs", 1);
export const sbsCycle2Template = sbsCycle("sbs-c2", 2);
export const sbsCycle3Template = sbsCycle("sbs-c3", 3);
