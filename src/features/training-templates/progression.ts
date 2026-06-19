import { calculateTmDelta, getAdjustmentPerRep } from "@/lib/calculator";
import { getTrainingTemplate, isTrainingTemplateId } from "@/features/training-templates/registry";
import { resolveTrainingTemplate } from "@/features/training-templates/user-templates";
import type { ExerciseCategory, TrainingTemplate } from "@/features/training-templates/types";

export type TemplateTrainingMaxDeltaInput = {
  readonly templateId: string;
  readonly actualReps: number;
  readonly repOutTarget: number;
  readonly category: ExerciseCategory;
  readonly currentTrainingMax: number;
  /** Owner — required to resolve a user-defined ("custom:…") progression. */
  readonly userId?: number;
};

export function calculateTemplateTrainingMaxDelta(input: TemplateTrainingMaxDeltaInput): number {
  const templateId = input.templateId.trim();
  const fallback = () => calculateTmDelta(input.actualReps, input.repOutTarget, getAdjustmentPerRep(input.category));

  let template: TrainingTemplate | null = null;
  try {
    if (input.userId != null) {
      template = resolveTrainingTemplate(templateId, input.userId);
    } else if (isTrainingTemplateId(templateId.toLowerCase())) {
      template = getTrainingTemplate(templateId.toLowerCase());
    }
  } catch {
    template = null; // a deleted/unresolvable template degrades to the default math
  }

  if (!template) return fallback();
  if (!template.autoProgression) return 0;
  if (template.progression) {
    return template.progression.calculateTrainingMaxDelta({
      actualReps: input.actualReps,
      repOutTarget: input.repOutTarget,
      category: input.category,
      currentTrainingMax: input.currentTrainingMax,
    });
  }
  return fallback();
}
