import { NextResponse } from "next/server";
import { numberParam } from "@/lib/api";
import { readWorkoutBody, workoutApi } from "@/features/workouts/api";
import { addQuickExercise, saveActualSet, WorkoutError } from "@/features/workouts/history-service";
type Context = { params: Promise<{ sessionId: string }> };
type AddBody = { name: string; sets?: number; reps?: number; weight?: number | string; prescription?: { reps: number; weight: number }[]; requestKey?: string; appendToSetId?: number };
export async function POST(request: Request, context: Context) {
  return workoutApi(request, true, async (userId) => {
    const body = await readWorkoutBody<AddBody>(request);
    const count = Number(body.sets);
    if (body.prescription === undefined && (!Number.isInteger(count) || count < 1 || count > 20)) throw new WorkoutError(400, "sets must be between 1 and 20");
    const prescription = body.prescription ?? Array.from({ length: count }, () => ({ reps: Number(body.reps), weight: body.weight === undefined || body.weight === "" ? 0 : Number(body.weight) }));
    const result = addQuickExercise({ userId, sessionId: numberParam((await context.params).sessionId), name: body.name, sets: prescription, requestKey: body.requestKey, appendToSetId: body.appendToSetId });
    return NextResponse.json({ sets: result.sets.filter((set) => result.addedSetIds.includes(set.id)), sessionRevision: result.revision }, { status: 201 });
  });
}
export async function PUT(request: Request, context: Context) {
  return workoutApi(request, true, async (userId) => {
    const body = await readWorkoutBody<{ setId: number; actualReps?: number | null; actualWeight?: number | null; notes?: string; expectedActual?: { reps: number | null; weight: number | null } }>(request);
    const setId = Number(body.setId);
    if (!Number.isInteger(setId) || setId < 1) throw new WorkoutError(400, "setId is required");
    return NextResponse.json(saveActualSet({ userId, sessionId: numberParam((await context.params).sessionId), setId,
      actualReps: body.actualReps == null ? null : Number(body.actualReps), actualWeight: body.actualWeight == null ? null : Number(body.actualWeight), notes: body.notes, expectedActual: body.expectedActual }));
  });
}
