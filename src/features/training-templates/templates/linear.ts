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

export const linearTemplate = defineTrainingTemplate({
  id: "linear",
  name: "Linear",
  description: "Add a fixed amount each time you complete all your reps.",
  supportedCategories: ["main", "aux", "accessory"],
  autoProgression: true,
  weeksByCategory: {
    main: [
      { weekNumber: 1, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(3, 5, 1.0, 5) },
    ],
    aux: [
      { weekNumber: 1, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(3, 8, 1.0, 8) },
    ],
    accessory: [
      { weekNumber: 1, intensityPct: 0, reps: 0, sets: 0, repOutTarget: 0, ramp: flatRamp(3, 12, 1.0, 12) },
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
