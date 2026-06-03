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

/**
 * Double progression: keep the weight fixed and work within a rep range
 * (floor `reps` → ceiling `repOutTarget`). Once you hit the top of the range,
 * the training max (working weight) bumps. Weight is 100% of the training max,
 * so set each lift's training max to your starting working weight.
 */
export const doubleTemplate = defineTrainingTemplate({
  id: "double",
  name: "Double Progression",
  description: "Fixed weight within a rep range; add load once you hit the top of the range.",
  supportedCategories: ["main", "aux", "accessory"],
  autoProgression: true,
  weeksByCategory: {
    main: [
      { weekNumber: 1, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(3, 5, 1.0, 8) },
    ],
    aux: [
      { weekNumber: 1, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(3, 8, 1.0, 12) },
    ],
    accessory: [
      { weekNumber: 1, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(3, 10, 1.0, 15) },
    ],
  },
  progression: {
    calculateTrainingMaxDelta: (context) => {
      if (context.actualReps >= context.repOutTarget) {
        return context.category === "main" ? 5 : 2.5;
      }
      return 0;
    },
  },
} as const satisfies TrainingTemplate);
