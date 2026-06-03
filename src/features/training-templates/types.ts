export type ExerciseCategory = "main" | "aux" | "accessory";

export type SetDefinition = {
  readonly setNumber: number;
  readonly intensityPct: number;
  readonly reps: number;
  readonly repOutTarget: number;
};

export type TemplateWeek = {
  readonly weekNumber: number;
  readonly intensityPct: number;
  readonly reps: number;
  readonly sets: number;
  readonly repOutTarget: number;
  readonly ramp?: readonly SetDefinition[];
};

export type TrainingMaxContext = {
  readonly actualReps: number;
  readonly repOutTarget: number;
  readonly category: ExerciseCategory;
  readonly currentTrainingMax: number;
};

export type ProgressionRule = {
  readonly calculateTrainingMaxDelta: (context: TrainingMaxContext) => number;
};

export type TrainingTemplate = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly supportedCategories: readonly ExerciseCategory[];
  readonly autoProgression: boolean;
  readonly weeksByCategory: Readonly<Partial<Record<ExerciseCategory, readonly TemplateWeek[]>>>;
  readonly progression?: ProgressionRule;
};
