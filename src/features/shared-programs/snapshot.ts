import { isRecord } from "@/lib/guards";
import type { ExerciseCategory, SetDefinition, TemplateWeek } from "@/features/training-templates/types";
import type {
  SharedProgramDayChange,
  SharedProgramDaySnapshot,
  SharedProgramExerciseChange,
  SharedProgramExerciseSlotSnapshot,
  SharedProgramSnapshot,
  SharedProgramSnapshotDiff,
  SharedProgramTemplateChange,
} from "@/features/shared-programs/types";

const EXERCISE_CATEGORIES = new Set<ExerciseCategory>(["main", "aux", "accessory"]);

type ExerciseLocation = Readonly<{
  dayKey: string;
  index: number;
  exercise: SharedProgramExerciseSlotSnapshot;
}>;

export function parseSharedProgramSnapshot(json: string): SharedProgramSnapshot {
  return validateSnapshot(JSON.parse(json));
}

export function serializeSharedProgramSnapshot(snapshot: SharedProgramSnapshot): string {
  return JSON.stringify(validateSnapshot(snapshot));
}

export function diffSharedProgramSnapshots(
  before: SharedProgramSnapshot,
  after: SharedProgramSnapshot,
): SharedProgramSnapshotDiff {
  const beforeDaysByKey = mapByKey(before.days);
  const afterDaysByKey = mapByKey(after.days);

  return {
    dayChanges: diffDays(before.days, after.days, beforeDaysByKey, afterDaysByKey),
    exerciseChanges: diffExercises(beforeDaysByKey, afterDaysByKey),
    templateChanges: diffTemplateChanges(before, after, beforeDaysByKey, afterDaysByKey),
  };
}

function validateSnapshot(value: unknown): SharedProgramSnapshot {
  if (!isRecord(value)) {
    throw new Error("Shared program snapshot must be an object");
  }

  if (value.schemaVersion !== 1) {
    throw new Error("Unsupported shared program snapshot schema version");
  }

  const name = assertString(value.name, "Snapshot name is required");
  const description = assertString(value.description, "Snapshot description is required");
  const numWeeks = assertPositiveInteger(value.numWeeks, "Snapshot numWeeks");

  if (!Array.isArray(value.days)) {
    throw new Error("Snapshot days are required");
  }

  if (value.days.length === 0) {
    throw new Error("At least one day is required");
  }

  const dayKeys = new Set<string>();
  const exerciseKeys = new Set<string>();
  const days = value.days.map((day) => validateDay(day, dayKeys, exerciseKeys));

  return {
    schemaVersion: 1,
    name,
    description,
    numWeeks,
    days,
  };
}

function validateDay(
  value: unknown,
  dayKeys: Set<string>,
  exerciseKeys: Set<string>,
): SharedProgramDaySnapshot {
  if (!isRecord(value)) {
    throw new Error("Day must be an object");
  }

  const key = assertString(value.key, "Day key is required");

  if (dayKeys.has(key)) {
    throw new Error(`Duplicate day key: ${key}`);
  }

  dayKeys.add(key);
  const name = assertString(value.name, "Day name is required");

  if (!Array.isArray(value.exercises)) {
    throw new Error("Day exercises are required");
  }

  return {
    key,
    name,
    exercises: value.exercises.map((exercise) => validateExercise(exercise, exerciseKeys)),
  };
}

function validateExercise(
  value: unknown,
  exerciseKeys: Set<string>,
): SharedProgramExerciseSlotSnapshot {
  if (!isRecord(value)) {
    throw new Error("Exercise must be an object");
  }

  const key = assertString(value.key, "Exercise key is required");

  if (exerciseKeys.has(key)) {
    throw new Error(`Duplicate exercise key: ${key}`);
  }

  exerciseKeys.add(key);
  const name = assertString(value.name, "Exercise name is required");

  if (!EXERCISE_CATEGORIES.has(value.category as ExerciseCategory)) {
    throw new Error(`Unsupported exercise category: ${String(value.category)}`);
  }

  const category = value.category as ExerciseCategory;
  const progressionType = assertString(value.progressionType, "Exercise progression type is required");
  const supersetGroup =
    value.supersetGroup === undefined || value.supersetGroup === null
      ? undefined
      : assertString(value.supersetGroup, "Exercise superset group must be a non-empty string");

  if (!Array.isArray(value.weeks)) {
    throw new Error("Exercise weeks are required");
  }

  return {
    key,
    name,
    category,
    progressionType,
    ...(supersetGroup ? { supersetGroup } : {}),
    weeks: value.weeks.map(validateWeek),
  };
}

function validateWeek(value: unknown): TemplateWeek {
  if (!isRecord(value)) {
    throw new Error("Template week must be an object");
  }

  const ramp = validateOptionalRamp(value.ramp);

  return {
    weekNumber: assertPositiveInteger(value.weekNumber, "Week number"),
    intensityPct: assertIntensityPct(value.intensityPct),
    // When a ramp is present the week-level reps are an unused placeholder (the
    // per-set ramp carries the real values), so allow 0; otherwise require >= 1.
    reps: ramp
      ? assertNonNegativeInteger(value.reps, "Week reps")
      : assertPositiveInteger(value.reps, "Week reps"),
    sets: assertPositiveInteger(value.sets, "Week sets"),
    repOutTarget: assertNonNegativeInteger(value.repOutTarget, "Week rep-out target"),
    ramp,
  };
}

function validateOptionalRamp(value: unknown): readonly SetDefinition[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error("Ramp must be an array");
  return value.map(validateSetDefinition);
}

function validateSetDefinition(value: unknown): SetDefinition {
  if (!isRecord(value)) throw new Error("Ramp set must be an object");
  return {
    setNumber: assertPositiveInteger(value.setNumber, "Ramp set number"),
    intensityPct: assertIntensityPct(value.intensityPct),
    reps: assertPositiveInteger(value.reps, "Ramp set reps"),
    repOutTarget: assertNonNegativeInteger(value.repOutTarget, "Ramp set rep-out target"),
  };
}

function diffDays(
  beforeDays: readonly SharedProgramDaySnapshot[],
  afterDays: readonly SharedProgramDaySnapshot[],
  beforeDaysByKey: ReadonlyMap<string, SharedProgramDaySnapshot>,
  afterDaysByKey: ReadonlyMap<string, SharedProgramDaySnapshot>,
): readonly SharedProgramDayChange[] {
  const changes: SharedProgramDayChange[] = [];

  afterDays.forEach((day, index) => {
    if (!beforeDaysByKey.has(day.key)) {
      changes.push({ type: "added", key: day.key, name: day.name, index });
    }
  });

  beforeDays.forEach((day, index) => {
    if (!afterDaysByKey.has(day.key)) {
      changes.push({ type: "removed", key: day.key, name: day.name, index });
    }
  });

  afterDays.forEach((day) => {
    const beforeDay = beforeDaysByKey.get(day.key);

    if (beforeDay && beforeDay.name !== day.name) {
      changes.push({ type: "renamed", key: day.key, from: beforeDay.name, to: day.name });
    }
  });

  afterDays.forEach((day, toIndex) => {
    const fromIndex = beforeDays.findIndex((beforeDay) => beforeDay.key === day.key);

    if (fromIndex !== -1 && fromIndex !== toIndex) {
      changes.push({ type: "reordered", key: day.key, fromIndex, toIndex });
    }
  });

  return changes;
}

function diffExercises(
  beforeDaysByKey: ReadonlyMap<string, SharedProgramDaySnapshot>,
  afterDaysByKey: ReadonlyMap<string, SharedProgramDaySnapshot>,
): readonly SharedProgramExerciseChange[] {
  const changes: SharedProgramExerciseChange[] = [];
  const beforeExercisesByKey = collectExerciseLocations(beforeDaysByKey);
  const afterExercisesByKey = collectExerciseLocations(afterDaysByKey);

  for (const afterLocation of afterExercisesByKey.values()) {
    const beforeLocation = beforeExercisesByKey.get(afterLocation.exercise.key);
    const { exercise } = afterLocation;

    if (!beforeLocation) {
      changes.push({
        type: "added",
        dayKey: afterLocation.dayKey,
        key: exercise.key,
        name: exercise.name,
        index: afterLocation.index,
      });
    }
  }

  for (const beforeLocation of beforeExercisesByKey.values()) {
    const afterLocation = afterExercisesByKey.get(beforeLocation.exercise.key);
    const { exercise } = beforeLocation;

    if (!afterLocation) {
      changes.push({
        type: "removed",
        dayKey: beforeLocation.dayKey,
        key: exercise.key,
        name: exercise.name,
        index: beforeLocation.index,
      });
    }
  }

  for (const afterLocation of afterExercisesByKey.values()) {
    const beforeLocation = beforeExercisesByKey.get(afterLocation.exercise.key);

    if (!beforeLocation) {
      continue;
    }

    if (beforeLocation.exercise.name !== afterLocation.exercise.name) {
      changes.push({
        type: "renamed",
        dayKey: afterLocation.dayKey,
        key: afterLocation.exercise.key,
        from: beforeLocation.exercise.name,
        to: afterLocation.exercise.name,
      });
    }

    if (beforeLocation.dayKey !== afterLocation.dayKey) {
      changes.push({
        type: "moved",
        key: afterLocation.exercise.key,
        name: afterLocation.exercise.name,
        fromDayKey: beforeLocation.dayKey,
        toDayKey: afterLocation.dayKey,
        fromIndex: beforeLocation.index,
        toIndex: afterLocation.index,
      });
    } else if (beforeLocation.index !== afterLocation.index) {
      changes.push({
        type: "reordered",
        dayKey: afterLocation.dayKey,
        key: afterLocation.exercise.key,
        fromIndex: beforeLocation.index,
        toIndex: afterLocation.index,
      });
    }
  }

  return changes;
}

function diffTemplateChanges(
  before: SharedProgramSnapshot,
  after: SharedProgramSnapshot,
  beforeDaysByKey: ReadonlyMap<string, SharedProgramDaySnapshot>,
  afterDaysByKey: ReadonlyMap<string, SharedProgramDaySnapshot>,
): readonly SharedProgramTemplateChange[] {
  const changes: SharedProgramTemplateChange[] = [];

  if (before.numWeeks !== after.numWeeks) {
    changes.push({ type: "numWeeksChanged", from: before.numWeeks, to: after.numWeeks });
  }

  const beforeExercisesByKey = collectExerciseLocations(beforeDaysByKey);
  const afterExercisesByKey = collectExerciseLocations(afterDaysByKey);

  for (const afterLocation of afterExercisesByKey.values()) {
    const beforeLocation = beforeExercisesByKey.get(afterLocation.exercise.key);

    if (!beforeLocation) {
      continue;
    }

    if (beforeLocation.exercise.category !== afterLocation.exercise.category) {
      changes.push({
        type: "categoryChanged",
        dayKey: afterLocation.dayKey,
        key: afterLocation.exercise.key,
        from: beforeLocation.exercise.category,
        to: afterLocation.exercise.category,
      });
    }

    if (beforeLocation.exercise.progressionType !== afterLocation.exercise.progressionType) {
      changes.push({
        type: "progressionTypeChanged",
        dayKey: afterLocation.dayKey,
        key: afterLocation.exercise.key,
        from: beforeLocation.exercise.progressionType,
        to: afterLocation.exercise.progressionType,
      });
    }

    if (!weeksEqual(beforeLocation.exercise.weeks, afterLocation.exercise.weeks)) {
      changes.push({ type: "weeksChanged", dayKey: afterLocation.dayKey, key: afterLocation.exercise.key });
    }
  }

  return changes;
}

function collectExerciseLocations(
  daysByKey: ReadonlyMap<string, SharedProgramDaySnapshot>,
): ReadonlyMap<string, ExerciseLocation> {
  const exercisesByKey = new Map<string, ExerciseLocation>();

  for (const [dayKey, day] of daysByKey) {
    day.exercises.forEach((exercise, index) => {
      exercisesByKey.set(exercise.key, { dayKey, index, exercise });
    });
  }

  return exercisesByKey;
}

function mapByKey<T extends { readonly key: string }>(items: readonly T[]): ReadonlyMap<string, T> {
  return new Map(items.map((item) => [item.key, item]));
}

function weeksEqual(before: readonly TemplateWeek[], after: readonly TemplateWeek[]): boolean {
  return (
    before.length === after.length &&
    before.every((week, index) => {
      const afterWeek = after[index];

      return (
        afterWeek !== undefined &&
        week.weekNumber === afterWeek.weekNumber &&
        week.intensityPct === afterWeek.intensityPct &&
        week.reps === afterWeek.reps &&
        week.sets === afterWeek.sets &&
        week.repOutTarget === afterWeek.repOutTarget
      );
    })
  );
}

function assertString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(message);
  }

  return value;
}

function assertNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(message);
  }

  return value;
}

function assertPositiveInteger(value: unknown, label: string): number {
  const numberValue = assertNumber(value, `${label} is required`);

  if (!Number.isInteger(numberValue) || numberValue < 1) {
    throw new Error(`${label} must be a positive integer`);
  }

  return numberValue;
}

function assertNonNegativeInteger(value: unknown, label: string): number {
  const numberValue = assertNumber(value, `${label} is required`);

  if (!Number.isInteger(numberValue) || numberValue < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }

  return numberValue;
}

function assertIntensityPct(value: unknown): number {
  const numberValue = assertNumber(value, "Week intensity percent is required");

  if (numberValue < 0 || numberValue > 1) {
    throw new Error("Week intensity percent must be between 0 and 1");
  }

  return numberValue;
}
