import { bodyweightTemplate } from "@/features/training-templates/templates/bodyweight";
import { customTemplate } from "@/features/training-templates/templates/custom";
import { doubleTemplate } from "@/features/training-templates/templates/double";
import { linearTemplate } from "@/features/training-templates/templates/linear";
import { madcowTemplate } from "@/features/training-templates/templates/madcow";
import {
  sbsCycle2Template,
  sbsCycle3Template,
  sbsTemplate,
} from "@/features/training-templates/templates/sbs";
import type { ExerciseCategory, TemplateWeek, TrainingTemplate } from "@/features/training-templates/types";

const EXERCISE_CATEGORIES = ["main", "aux", "accessory"] as const satisfies readonly ExerciseCategory[];

const TRAINING_TEMPLATES = [
  customTemplate,
  bodyweightTemplate,
  linearTemplate,
  doubleTemplate,
  sbsTemplate,
  sbsCycle2Template,
  sbsCycle3Template,
  madcowTemplate,
] as const satisfies readonly TrainingTemplate[];

function copyWeeks(weeks: readonly TemplateWeek[] | undefined): readonly TemplateWeek[] {
  return weeks?.map((week) => ({ ...week })) ?? [];
}

function copyTemplate(template: TrainingTemplate): TrainingTemplate {
  const weeksByCategory: Partial<Record<ExerciseCategory, readonly TemplateWeek[]>> = {};

  for (const category of EXERCISE_CATEGORIES) {
    const weeks = template.weeksByCategory[category];

    if (weeks) {
      weeksByCategory[category] = copyWeeks(weeks);
    }
  }

  return {
    ...template,
    supportedCategories: [...template.supportedCategories],
    weeksByCategory,
  };
}

function findTrainingTemplate(id: string): TrainingTemplate | undefined {
  return TRAINING_TEMPLATES.find((item) => item.id === id);
}

function getInternalTrainingTemplate(id: string): TrainingTemplate {
  const template = findTrainingTemplate(id);

  if (!template) {
    throw new Error(`Unknown training template: ${id}`);
  }

  return template;
}

export function listTrainingTemplates(): readonly TrainingTemplate[] {
  return TRAINING_TEMPLATES.map(copyTemplate);
}

export function isTrainingTemplateId(id: string): boolean {
  return findTrainingTemplate(id) !== undefined;
}

export function getTrainingTemplate(id: string): TrainingTemplate {
  return copyTemplate(getInternalTrainingTemplate(id));
}

export function getTemplateWeeks(templateId: string, category: ExerciseCategory): readonly TemplateWeek[] {
  const template = getInternalTrainingTemplate(templateId);
  const weeks = template.weeksByCategory[category] ?? template.weeksByCategory.main;

  return copyWeeks(weeks);
}
