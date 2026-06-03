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

export const btmTemplate = defineTrainingTemplate({
  id: "btm",
  name: "BTM",
  description: "High-volume strength progression using main lift loading.",
  supportedCategories: ["main"],
  autoProgression: true,
  weeksByCategory: {
    main: [
      { weekNumber: 1, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 5, 0.70, 7) },
      { weekNumber: 2, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 4, 0.75, 6) },
      { weekNumber: 3, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 3, 0.80, 5) },
      { weekNumber: 4, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 5, 0.725, 6) },
      { weekNumber: 5, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 4, 0.775, 5) },
      { weekNumber: 6, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 3, 0.825, 4) },
      { weekNumber: 7, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(5, 7, 0.60, 9) },
    ],
  },
} as const satisfies TrainingTemplate);
