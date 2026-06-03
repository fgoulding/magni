import { defineTrainingTemplate } from "@/features/training-templates/define";
import type { TrainingTemplate } from "@/features/training-templates/types";

export const madcowTemplate = defineTrainingTemplate({
  id: "madcow",
  name: "Madcow",
  description: "Ramp sets with heavy-light-medium progression. Top set increases weekly.",
  supportedCategories: ["main"],
  autoProgression: true,
  weeksByCategory: {
    main: [
      {
        weekNumber: 1,
        intensityPct: 0,
        reps: 0,
        sets: 0,
        repOutTarget: 5,
        ramp: [
          { setNumber: 1, intensityPct: 0.50, reps: 5, repOutTarget: 5 },
          { setNumber: 2, intensityPct: 0.64, reps: 5, repOutTarget: 5 },
          { setNumber: 3, intensityPct: 0.75, reps: 5, repOutTarget: 5 },
          { setNumber: 4, intensityPct: 0.89, reps: 5, repOutTarget: 5 },
          { setNumber: 5, intensityPct: 1.00, reps: 5, repOutTarget: 5 },
        ],
      },
    ],
  },
} as const satisfies TrainingTemplate);
