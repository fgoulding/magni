import { defineTrainingTemplate } from "@/features/training-templates/define";
import type { TrainingTemplate } from "@/features/training-templates/types";

/**
 * Bodyweight movements (pull-ups, dips, stretches): no training max, logged by
 * reps with an optional added-weight per set. Like `custom` it's manual with no
 * auto-progression; the UI renders "BW" / "BW +X" and stores any added load in
 * session_sets.actual_weight.
 */
export const bodyweightTemplate = defineTrainingTemplate({
  id: "bodyweight",
  name: "Bodyweight",
  description: "No training max — log reps, with optional added weight per set.",
  supportedCategories: ["main", "aux", "accessory"],
  autoProgression: false,
  weeksByCategory: {
    main: [],
    aux: [],
    accessory: [],
  },
} as const satisfies TrainingTemplate);
