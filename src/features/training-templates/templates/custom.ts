import { defineTrainingTemplate } from "@/features/training-templates/define";
import type { TrainingTemplate } from "@/features/training-templates/types";

export const customTemplate = defineTrainingTemplate({
  id: "custom",
  name: "Custom",
  description: "Manual progression without automatic week loading.",
  supportedCategories: ["main", "aux", "accessory"],
  autoProgression: false,
  weeksByCategory: {
    main: [],
    aux: [],
    accessory: [],
  },
} as const satisfies TrainingTemplate);
