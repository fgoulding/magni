import { calculateTmDelta, getAdjustmentPerRep } from "@/lib/calculator";
import { getTrainingTemplate, isTrainingTemplateId } from "@/features/training-templates/registry";
import type { ExerciseCategory } from "@/features/training-templates/types";

export type TemplateTrainingMaxDeltaInput = {
  readonly templateId: string;
  readonly actualReps: number;
  readonly repOutTarget: number;
  readonly category: ExerciseCategory;
  readonly currentTrainingMax: number;
};

export function calculateTemplateTrainingMaxDelta(input: TemplateTrainingMaxDeltaInput): number {
  const templateId = input.templateId.trim().toLowerCase();
  if (!isTrainingTemplateId(templateId)) {
    return calculateTmDelta(input.actualReps, input.repOutTarget, getAdjustmentPerRep(input.category));
  }

  const template = getTrainingTemplate(templateId);

  if (!template.autoProgression) {
    return 0;
  }

  if (template.progression) {
    return template.progression.calculateTrainingMaxDelta({
      actualReps: input.actualReps,
      repOutTarget: input.repOutTarget,
      category: input.category,
      currentTrainingMax: input.currentTrainingMax,
    });
  }

  return calculateTmDelta(input.actualReps, input.repOutTarget, getAdjustmentPerRep(input.category));
}
