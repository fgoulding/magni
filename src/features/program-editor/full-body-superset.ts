import { createBlankDocument, createDay, createExercise, createSet, type ProgramDocumentV1 } from "./document";

export const FULL_BODY_SUPERSET_PRESET = {
  id: "full-body-supersets-3-day",
  title: "Full Body Supersets 3-Day",
  description: "Squat, bench and deadlift days. Three pairs per day: five rounds of A/B, three of C. Choose your working loads.",
} as const;

type ExerciseDefinition = {
  name: string;
  reps: readonly [number, number];
  notes?: string;
  editorNotes?: string;
  tempo?: string;
  bodyweight?: boolean;
};

const rowNotes = "Complete the reps on each side. Support your free hand on a bench; keep your chest free.";
const pullUpNotes = "For weighted pull-ups, change each set's Load basis to Bodyweight + load in the editor and enter the added load. For a chin-up alternative, rename the Pull-up slots before activation and use that variation consistently.";
const days: readonly { name: string; exercises: readonly ExerciseDefinition[] }[] = [
  {
    name: "Squat",
    exercises: [
      { name: "Barbell back squat", reps: [4, 6] },
      { name: "One-arm dumbbell row", reps: [8, 12], notes: rowNotes },
      { name: "Dumbbell Romanian deadlift", reps: [8, 12] },
      { name: "Barbell Spoto press", reps: [6, 8], tempo: "1-second hover pause", notes: "Pause for 1 second with the bar just above your chest, then press." },
      { name: "Pull-up", reps: [5, 10], bodyweight: true, editorNotes: pullUpNotes },
      { name: "Dumbbell lateral raise", reps: [12, 20] },
    ],
  },
  {
    name: "Bench",
    exercises: [
      { name: "Barbell bench press", reps: [4, 6] },
      { name: "B-stance dumbbell RDL", reps: [8, 10], notes: "Complete the reps on each side. The rear foot provides balance; the front leg does most of the work." },
      { name: "Kettlebell Bulgarian split squat", reps: [8, 10], notes: "Complete the reps on each leg, holding a kettlebell." },
      { name: "Standing dumbbell overhead press", reps: [8, 12] },
      { name: "One-arm dumbbell row", reps: [10, 12], notes: rowNotes },
      { name: "Dumbbell lateral raise", reps: [12, 20] },
    ],
  },
  {
    name: "Deadlift",
    exercises: [
      { name: "Barbell deadlift", reps: [3, 5] },
      { name: "Incline dumbbell bench press", reps: [8, 12] },
      { name: "Kettlebell goblet squat", reps: [10, 15], notes: "Keep the load moderate after the heavier deadlifts." },
      { name: "Pull-up", reps: [5, 10], bodyweight: true, editorNotes: pullUpNotes },
      { name: "One-arm dumbbell row", reps: [10, 15], notes: rowNotes },
      { name: "Single-leg dumbbell calf raise", reps: [12, 20], notes: "Complete the reps on each leg, holding a dumbbell." },
    ],
  },
];

/** Each application is a new draft. Only repeated lift names within this draft
 * share history; loads and progression remain independent for each day. */
export function makeFullBodySupersetProgram(startDate: string): ProgramDocumentV1 {
  const document = createBlankDocument();
  document.name = FULL_BODY_SUPERSET_PRESET.title;
  document.startDate = startDate;
  document.cycles = 4;
  document.description = [
    "Three full-body days on nonconsecutive weekdays. Complete five rounds of A, five of B and three of C: 26 working sets per session. Abs are separate.",
    "Choose your working loads in the editor before training; the initial 0 values are placeholders, not recommended weights. Pull-ups use bodyweight.",
    "Keep about two good reps in reserve, or three for the exercise paired with the main lift in A. Warm-up sets are additional to the listed work sets.",
    "Allow 3–4 minutes between sets of the main lift in A, including its partner exercise; extend the rest as needed. For B/C, rest 90–120 seconds after each pair. Complete both sides of unilateral exercises before moving on.",
    "Progress manually: when all sets reach the top of their rep range with clean technique and the intended effort, raise the working load by the smallest practical increment. Logged weights do not change future targets automatically.",
    "The three-day week repeats for four cycles. Edit Repeat cycles and training weekdays before activation to choose your schedule.",
  ].join("\n\n");

  const historyKeys = new Map<string, string>();
  document.weeks[0].days = days.map(definition => ({
    ...createDay(definition.name),
    exercises: definition.exercises.map((item, index) => {
      const exercise = createExercise(item.name);
      exercise.baseLoad = 0;
      exercise.trainingMax = 0;
      exercise.rule = null;
      exercise.supersetGroup = ["A", "B", "C"][Math.floor(index / 2)];
      exercise.historyKey = historyKeys.get(item.name) ?? exercise.id;
      historyKeys.set(item.name, exercise.historyKey);
      const notes = [
        item.notes,
        index === 0 ? "Allow 3–4 minutes between sets of the main lift, including its partner." : undefined,
      ].filter(Boolean).join(" ");
      exercise.notes = [notes, item.editorNotes].filter(Boolean).join(" ");
      exercise.sets = Array.from({ length: index < 4 ? 5 : 3 }, () => ({
        ...createSet(),
        repMin: item.reps[0],
        repMax: item.reps[1],
        loadMode: item.bodyweight ? "bodyweight" : "working",
        effortKind: "rir",
        effort: index === 1 ? 3 : 2,
        restSeconds: index % 2 === 0 ? 45 : 120,
        tempo: item.tempo ?? "",
        notes,
      }));
      return exercise;
    }),
  }));
  return document;
}
