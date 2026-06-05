import { defineTrainingTemplate } from "@/features/training-templates/define";
import type { TrainingTemplate } from "@/features/training-templates/types";

export const customTemplate = defineTrainingTemplate({
  id: "custom",
  name: "Custom",
  description: "Manual — you set the weights yourself; nothing auto-adjusts.",
  supportedCategories: ["main", "aux", "accessory"],
  autoProgression: false,
  weeksByCategory: {
    main: [],
    aux: [],
    accessory: [],
  },
} as const satisfies TrainingTemplate);
