import { defineTrainingTemplate } from "@/features/training-templates/define";
import type { TrainingTemplate } from "@/features/training-templates/types";

function flatRamp(sets: number, reps: number, intensityPct: number, repOutTarget: number) {
  return Array.from({ length: sets }, (_, i) => ({
    setNumber: i + 1,
    intensityPct,
    reps,
    repOutTarget,
  }));
}

const SBS_MAIN_RAMP = [
  { weekNumber: 1, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 5, 0.70, 10) },
  { weekNumber: 2, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 4, 0.75, 8) },
  { weekNumber: 3, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 3, 0.80, 6) },
  { weekNumber: 4, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 5, 0.725, 9) },
  { weekNumber: 5, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 4, 0.775, 7) },
  { weekNumber: 6, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 3, 0.825, 5) },
  { weekNumber: 7, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 7, 0.60, 14) },
];

const SBS_AUX_RAMP = [
  { weekNumber: 1, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 7, 0.60, 14) },
  { weekNumber: 2, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 6, 0.65, 12) },
  { weekNumber: 3, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 5, 0.70, 10) },
  { weekNumber: 4, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 7, 0.625, 13) },
  { weekNumber: 5, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 6, 0.675, 11) },
  { weekNumber: 6, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 5, 0.725, 9) },
  { weekNumber: 7, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 8, 0.50, 18) },
];

export const sbsTemplate = defineTrainingTemplate({
  id: "sbs",
  name: "SBS",
  description: "AMRAP-based strength progression with main and auxiliary loading.",
  supportedCategories: ["main", "aux"],
  autoProgression: true,
  weeksByCategory: {
    main: SBS_MAIN_RAMP,
    aux: SBS_AUX_RAMP,
  },
} as const satisfies TrainingTemplate);
