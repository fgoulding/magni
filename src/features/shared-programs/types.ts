import type { ExerciseCategory, TemplateWeek } from "@/features/training-templates/types";

export type SharedProgramExerciseSlotSnapshot = Readonly<{
  key: string;
  name: string;
  category: ExerciseCategory;
  progressionType: string;
  /** Exercises sharing this token (and adjacent within a day) form a superset. */
  supersetGroup?: string;
  weeks: readonly TemplateWeek[];
}>;

export type SharedProgramDaySnapshot = Readonly<{
  key: string;
  name: string;
  exercises: readonly SharedProgramExerciseSlotSnapshot[];
}>;

export type SharedProgramSnapshot = Readonly<{
  schemaVersion: 1;
  name: string;
  description: string;
  numWeeks: number;
  days: readonly SharedProgramDaySnapshot[];
}>;

export type SharedProgramDayChange =
  | Readonly<{ type: "added"; key: string; name: string; index: number }>
  | Readonly<{ type: "removed"; key: string; name: string; index: number }>
  | Readonly<{ type: "renamed"; key: string; from: string; to: string }>
  | Readonly<{ type: "reordered"; key: string; fromIndex: number; toIndex: number }>;

export type SharedProgramExerciseChange =
  | Readonly<{ type: "added"; dayKey: string; key: string; name: string; index: number }>
  | Readonly<{ type: "removed"; dayKey: string; key: string; name: string; index: number }>
  | Readonly<{ type: "renamed"; dayKey: string; key: string; from: string; to: string }>
  | Readonly<{ type: "reordered"; dayKey: string; key: string; fromIndex: number; toIndex: number }>
  | Readonly<{
      type: "moved";
      key: string;
      name: string;
      fromDayKey: string;
      toDayKey: string;
      fromIndex: number;
      toIndex: number;
    }>;

export type SharedProgramTemplateChange =
  | Readonly<{ type: "numWeeksChanged"; from: number; to: number }>
  | Readonly<{ type: "categoryChanged"; dayKey: string; key: string; from: ExerciseCategory; to: ExerciseCategory }>
  | Readonly<{ type: "progressionTypeChanged"; dayKey: string; key: string; from: string; to: string }>
  | Readonly<{ type: "weeksChanged"; dayKey: string; key: string }>;

export type SharedProgramSnapshotDiff = Readonly<{
  dayChanges: readonly SharedProgramDayChange[];
  exerciseChanges: readonly SharedProgramExerciseChange[];
  templateChanges: readonly SharedProgramTemplateChange[];
}>;
