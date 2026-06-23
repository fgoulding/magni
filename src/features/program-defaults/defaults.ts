import type {
  SharedProgramDaySnapshot,
  SharedProgramExerciseSlotSnapshot,
  SharedProgramSnapshot,
} from "@/features/shared-programs/types";
import { getTemplateWeeks } from "@/features/training-templates/registry";
import type { ExerciseCategory, TemplateWeek } from "@/features/training-templates/types";
import type { ProgramDefault } from "./types";

/** SBS progression ids by cycle number, and the set of all of them. */
const SBS_CYCLE_ID: Readonly<Record<number, string>> = { 1: "sbs", 2: "sbs-c2", 3: "sbs-c3" };
const SBS_CYCLE_IDS = new Set(Object.values(SBS_CYCLE_ID));

/** Flatten a template's weeks into the snapshot week shape (ramp-aware). */
function snapshotWeeksFromTemplate(progressionType: string, category: ExerciseCategory): TemplateWeek[] {
  return getTemplateWeeks(progressionType, category).map((tw) => ({
    weekNumber: tw.weekNumber,
    intensityPct: tw.ramp && tw.ramp.length > 0 ? tw.ramp[tw.ramp.length - 1].intensityPct : tw.intensityPct,
    reps: tw.ramp && tw.ramp.length > 0 ? tw.ramp[0].reps : tw.reps,
    sets: tw.ramp ? tw.ramp.length : tw.sets,
    repOutTarget: tw.ramp && tw.ramp.length > 0 ? tw.ramp[tw.ramp.length - 1].repOutTarget : tw.repOutTarget,
    ramp: tw.ramp,
  }));
}

/** True when a snapshot contains any SBS-loaded lift (so a cycle choice applies). */
export function snapshotUsesSbs(snapshot: SharedProgramSnapshot): boolean {
  return snapshot.days.some((day) => day.exercises.some((exercise) => SBS_CYCLE_IDS.has(exercise.progressionType)));
}

/** Remap every SBS-loaded lift in a snapshot to the chosen SBS cycle (1-3) and
 *  re-plan its weeks. Non-SBS lifts (custom/bodyweight/linear/…) are untouched. */
export function applySbsCycleToSnapshot(snapshot: SharedProgramSnapshot, cycle: number): SharedProgramSnapshot {
  const targetId = SBS_CYCLE_ID[cycle] ?? "sbs";
  return {
    ...snapshot,
    days: snapshot.days.map((day) => ({
      ...day,
      exercises: day.exercises.map((exercise) =>
        SBS_CYCLE_IDS.has(exercise.progressionType)
          ? {
              ...exercise,
              progressionType: targetId,
              weeks: snapshotWeeksFromTemplate(targetId, exercise.category),
            }
          : exercise,
      ),
    })),
  };
}

type ExerciseDefinition = Readonly<{
  slug: string;
  name: string;
  category: ExerciseCategory;
  progressionType?: string;
  /** Exercises with the same token in a day are linked as a superset. */
  superset?: string;
  /** Fixed per-week prescription (overrides the template's loading), e.g. accessory 3x12. */
  prescription?: Readonly<{ sets: number; reps: number; intensityPct?: number }>;
}>;

type DayDefinition = Readonly<{
  slug: string;
  name: string;
  exercises: readonly ExerciseDefinition[];
}>;

type DefaultDefinition = Readonly<{
  id: string;
  label: string;
  description: string;
  snapshotName: string;
  snapshotDescription: string;
  numWeeks: number;
  days: readonly DayDefinition[];
}>;

const DEFAULT_DEFINITIONS = [
  {
    id: "basic-strength-3-day",
    label: "Basic Strength 3-Day",
    description: "A simple lower, upper, and full body setup using common compound lifts.",
    snapshotName: "Basic Strength 3-Day",
    snapshotDescription: "Lower, upper, and full body training days with SBS loading for the main lifts.",
    numWeeks: 7,
    days: [
      {
        slug: "lower",
        name: "Lower",
        exercises: [
          { slug: "squat", name: "Squat", category: "main" },
          { slug: "deadlift", name: "Deadlift", category: "main" },
          { slug: "leg-press", name: "Leg Press", category: "aux" },
        ],
      },
      {
        slug: "upper",
        name: "Upper",
        exercises: [
          { slug: "bench-press", name: "Bench Press", category: "main" },
          { slug: "barbell-row", name: "Barbell Row", category: "aux" },
          { slug: "overhead-press", name: "Overhead Press", category: "aux" },
        ],
      },
      {
        slug: "full-body",
        name: "Full Body",
        exercises: [
          { slug: "front-squat", name: "Front Squat", category: "aux" },
          { slug: "incline-bench", name: "Incline Bench", category: "aux" },
          { slug: "romanian-deadlift", name: "Romanian Deadlift", category: "aux" },
        ],
      },
    ],
  },
  {
    id: "sbs-hypertrophy-4-day",
    label: "SBS Hypertrophy 4-Day",
    description: "A four day SBS-style hypertrophy split with squat, bench, deadlift, and press emphasis.",
    snapshotName: "SBS Hypertrophy 4-Day",
    snapshotDescription: "Four SBS training days organized around squat, bench, deadlift, and overhead press.",
    numWeeks: 7,
    days: [
      {
        slug: "squat",
        name: "Squat",
        exercises: [
          { slug: "squat", name: "Squat", category: "main" },
          { slug: "bench-variation", name: "Bench Variation", category: "aux" },
          { slug: "row", name: "Row", category: "aux" },
        ],
      },
      {
        slug: "bench",
        name: "Bench",
        exercises: [
          { slug: "bench-press", name: "Bench Press", category: "main" },
          { slug: "deadlift-variation", name: "Deadlift Variation", category: "aux" },
          { slug: "pulldown", name: "Pulldown", category: "aux" },
        ],
      },
      {
        slug: "deadlift",
        name: "Deadlift",
        exercises: [
          { slug: "deadlift", name: "Deadlift", category: "main" },
          { slug: "overhead-press-variation", name: "Overhead Press Variation", category: "aux" },
          { slug: "leg-press", name: "Leg Press", category: "aux" },
        ],
      },
      {
        slug: "press",
        name: "Press",
        exercises: [
          { slug: "overhead-press", name: "Overhead Press", category: "main" },
          { slug: "squat-variation", name: "Squat Variation", category: "aux" },
          { slug: "incline-bench", name: "Incline Bench", category: "aux" },
        ],
      },
    ],
  },
  {
    id: "starting-strength-3-day",
    label: "Starting Strength 3-Day",
    description: "Classic ABA full-body linear progression. Squat every session, bench/OHP alternating.",
    snapshotName: "Starting Strength 3-Day",
    snapshotDescription: "Alternating A/B full-body workouts with 3x5 compound lifts and fixed weight increases.",
    numWeeks: 7,
    days: [
      {
        slug: "workout-a",
        name: "Workout A",
        exercises: [
          { slug: "squat", name: "Squat", category: "main", progressionType: "linear" },
          { slug: "bench-press", name: "Bench Press", category: "main", progressionType: "linear" },
          { slug: "deadlift", name: "Deadlift", category: "main", progressionType: "linear" },
        ],
      },
      {
        slug: "workout-b",
        name: "Workout B",
        exercises: [
          { slug: "squat", name: "Squat", category: "main", progressionType: "linear" },
          { slug: "overhead-press", name: "Overhead Press", category: "main", progressionType: "linear" },
          { slug: "deadlift", name: "Deadlift", category: "main", progressionType: "linear" },
        ],
      },
    ],
  },
  {
    id: "stronglifts-5x5",
    label: "StrongLifts 5x5",
    description: "ABA linear progression with 5x5 compound lifts. Squat every session.",
    snapshotName: "StrongLifts 5x5",
    snapshotDescription: "Alternating A/B full-body workouts with 5x5 compound lifts and fixed weight increases.",
    numWeeks: 7,
    days: [
      {
        slug: "workout-a",
        name: "Workout A",
        exercises: [
          { slug: "squat", name: "Squat", category: "main", progressionType: "linear" },
          { slug: "bench-press", name: "Bench Press", category: "main", progressionType: "linear" },
          { slug: "barbell-row", name: "Barbell Row", category: "aux", progressionType: "linear" },
        ],
      },
      {
        slug: "workout-b",
        name: "Workout B",
        exercises: [
          { slug: "squat", name: "Squat", category: "main", progressionType: "linear" },
          { slug: "overhead-press", name: "Overhead Press", category: "main", progressionType: "linear" },
          { slug: "deadlift", name: "Deadlift", category: "main", progressionType: "linear" },
        ],
      },
    ],
  },
  {
    id: "phul-4-day",
    label: "PHUL 4-Day",
    description: "Power Hypertrophy Upper Lower. Upper/lower split alternating power and hypertrophy days.",
    snapshotName: "PHUL 4-Day",
    snapshotDescription: "Four-day upper/lower split with SBS loading for main lifts and accessory work.",
    numWeeks: 7,
    days: [
      {
        slug: "upper-power",
        name: "Upper Power",
        exercises: [
          { slug: "bench-press", name: "Bench Press", category: "main" },
          { slug: "barbell-row", name: "Barbell Row", category: "main" },
          { slug: "overhead-press", name: "Overhead Press", category: "aux" },
          { slug: "pulldown", name: "Pulldown", category: "aux" },
          { slug: "barbell-curl", name: "Barbell Curl", category: "accessory", progressionType: "custom" },
          { slug: "tricep-extension", name: "Tricep Extension", category: "accessory", progressionType: "custom" },
        ],
      },
      {
        slug: "lower-power",
        name: "Lower Power",
        exercises: [
          { slug: "squat", name: "Squat", category: "main" },
          { slug: "deadlift", name: "Deadlift", category: "main" },
          { slug: "leg-press", name: "Leg Press", category: "aux" },
          { slug: "standing-calf-raise", name: "Standing Calf Raise", category: "accessory", progressionType: "custom" },
        ],
      },
      {
        slug: "upper-hypertrophy",
        name: "Upper Hypertrophy",
        exercises: [
          { slug: "incline-bench", name: "Incline Bench", category: "aux" },
          { slug: "barbell-row", name: "Barbell Row", category: "aux" },
          { slug: "dumbbell-fly", name: "Dumbbell Fly", category: "accessory", progressionType: "custom" },
          { slug: "lateral-raise", name: "Lateral Raise", category: "accessory", progressionType: "custom" },
          { slug: "barbell-curl", name: "Barbell Curl", category: "accessory", progressionType: "custom" },
          { slug: "tricep-extension", name: "Tricep Extension", category: "accessory", progressionType: "custom" },
        ],
      },
      {
        slug: "lower-hypertrophy",
        name: "Lower Hypertrophy",
        exercises: [
          { slug: "front-squat", name: "Front Squat", category: "aux" },
          { slug: "romanian-deadlift", name: "Romanian Deadlift", category: "aux" },
          { slug: "leg-extension", name: "Leg Extension", category: "accessory", progressionType: "custom" },
          { slug: "leg-curl", name: "Leg Curl", category: "accessory", progressionType: "custom" },
          { slug: "seated-calf-raise", name: "Seated Calf Raise", category: "accessory", progressionType: "custom" },
        ],
      },
    ],
  },
  {
    id: "superset-hypertrophy-3-day",
    label: "Superset Hypertrophy 3-Day",
    description: "Squat, bench, and deadlift days. Each opens with the main lift, then two accessory supersets.",
    snapshotName: "Superset Hypertrophy 3-Day",
    snapshotDescription:
      "Three-day split. Each day starts with an SBS-loaded main lift, followed by two supersets of accessory work (3x12, log your own weight).",
    numWeeks: 7,
    days: [
      {
        slug: "squat",
        name: "Squat",
        exercises: [
          { slug: "squat", name: "Squat", category: "main" },
          { slug: "db-incline-bench", name: "DB Incline Bench Press", category: "accessory", progressionType: "custom", superset: "a", prescription: { sets: 3, reps: 12 } },
          { slug: "rear-delt-face-pull", name: "Rear Delt / Face Pull", category: "accessory", progressionType: "bodyweight", superset: "a", prescription: { sets: 3, reps: 15 } },
          { slug: "single-leg-rdl", name: "Single-Leg RDL", category: "accessory", progressionType: "custom", superset: "b", prescription: { sets: 3, reps: 12 } },
          { slug: "pull-up", name: "Pull-Up", category: "accessory", progressionType: "bodyweight", superset: "b", prescription: { sets: 3, reps: 10 } },
        ],
      },
      {
        slug: "bench",
        name: "Bench",
        exercises: [
          { slug: "bench-press", name: "Bench Press", category: "main" },
          { slug: "split-squat", name: "Split Squat", category: "accessory", progressionType: "custom", superset: "a", prescription: { sets: 3, reps: 12 } },
          { slug: "lateral-raise", name: "Lateral Raise", category: "accessory", progressionType: "custom", superset: "a", prescription: { sets: 3, reps: 15 } },
          { slug: "db-row", name: "DB Row", category: "accessory", progressionType: "custom", superset: "b", prescription: { sets: 3, reps: 12 } },
          { slug: "dip", name: "Dip", category: "accessory", progressionType: "bodyweight", superset: "b", prescription: { sets: 3, reps: 12 } },
        ],
      },
      {
        slug: "deadlift",
        name: "Deadlift",
        exercises: [
          { slug: "deadlift", name: "Deadlift", category: "main" },
          { slug: "front-squat", name: "Front Squat", category: "accessory", progressionType: "custom", superset: "a", prescription: { sets: 3, reps: 10 } },
          { slug: "db-ohp", name: "DB Overhead Press", category: "accessory", progressionType: "custom", superset: "a", prescription: { sets: 3, reps: 12 } },
          { slug: "close-grip-spoto", name: "Close-Grip / Spoto Press", category: "accessory", progressionType: "custom", superset: "b", prescription: { sets: 3, reps: 10 } },
          { slug: "biceps-curl", name: "Biceps Curl", category: "accessory", progressionType: "custom", superset: "b", prescription: { sets: 3, reps: 12 } },
        ],
      },
    ],
  },
] as const satisfies readonly DefaultDefinition[];

export function listProgramDefaults(): readonly ProgramDefault[] {
  return DEFAULT_DEFINITIONS.map(createProgramDefault);
}

export function getProgramDefault(id: string): ProgramDefault | undefined {
  const definition = DEFAULT_DEFINITIONS.find((programDefault) => programDefault.id === id);

  return definition ? createProgramDefault(definition) : undefined;
}

function createProgramDefault(definition: DefaultDefinition): ProgramDefault {
  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    snapshot: {
      schemaVersion: 1,
      name: definition.snapshotName,
      description: definition.snapshotDescription,
      numWeeks: definition.numWeeks,
      days: definition.days.map((day) => createDaySnapshot(definition.id, day)),
    },
  };
}

function createDaySnapshot(defaultId: string, day: DayDefinition): SharedProgramDaySnapshot {
  const daySlug = day.slug;

  return {
    key: `${defaultId}:day:${daySlug}`,
    name: day.name,
    exercises: day.exercises.map((exercise) => createExerciseSnapshot(defaultId, daySlug, exercise)),
  };
}

function createExerciseSnapshot(
  defaultId: string,
  daySlug: string,
  exercise: ExerciseDefinition,
): SharedProgramExerciseSlotSnapshot {
  const progressionType = exercise.progressionType ?? "sbs";

  const prescription = exercise.prescription;
  const weeks = prescription
    ? progressionType === "bodyweight"
      ? // Bodyweight: materialise N individual sets (a ramp) so each logs its own
        // reps + optional added weight, instead of one collapsed row.
        [
          {
            weekNumber: 1,
            intensityPct: 0,
            reps: 0,
            sets: prescription.sets,
            repOutTarget: 0,
            ramp: Array.from({ length: prescription.sets }, (_, index) => ({
              setNumber: index + 1,
              intensityPct: 0,
              reps: prescription.reps,
              repOutTarget: prescription.reps,
            })),
          },
        ]
      : [
          {
            weekNumber: 1,
            intensityPct: prescription.intensityPct ?? 1,
            reps: prescription.reps,
            sets: prescription.sets,
            repOutTarget: prescription.reps,
          },
        ]
    : snapshotWeeksFromTemplate(progressionType, exercise.category);

  const supersetGroup = exercise.superset
    ? `${defaultId}:${daySlug}:ss:${exercise.superset}`
    : undefined;

  return {
    key: `${defaultId}:${daySlug}:exercise:${exercise.slug}`,
    name: exercise.name,
    category: exercise.category,
    progressionType,
    ...(supersetGroup ? { supersetGroup } : {}),
    weeks,
  };
}
