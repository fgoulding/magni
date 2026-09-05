import type { WorkoutSet } from "@/components/workout-card-utils";
import type { SessionRecap } from "@/features/programs/training-stats";

export type HistorySet = WorkoutSet & { exercise_key: string | null; sort_order: number; notes: string; editor_json: string | null };
export type WorkoutHistoryItem = { id: number; name: string; date: string; unit: "lb" | "kg"; status: "in_progress" | "completed" | "skipped"; program_id: number | null; program_name: string; day_name: string; revision: number; volume: number; loggedSets: number; totalSets: number };
export type WorkoutSession = WorkoutHistoryItem & { sets: HistorySet[]; recap: SessionRecap | null; corrections: { id: number; reason: string; created_at: string }[] };
export type ExerciseSuggestion = { name: string; date: string; sets: { reps: number; weight: number }[] };
export type WorkoutRoutine = { id: number; name: string; exerciseCount: number; setCount: number };
export type ActualChange = { setId: number; actualReps: number | null; actualWeight: number | null };
export type CorrectionPreview = { progressionEffect: string; comparisons: { exercise: string; previous: string; corrected: string; hypothetical: true }[] };
