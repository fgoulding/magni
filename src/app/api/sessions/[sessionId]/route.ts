import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { numberParam } from "@/lib/api";
import { readWorkoutBody, workoutApi } from "@/features/workouts/api";
import { finishQuickSession, getWorkout, updateQuickStructure, WorkoutError } from "@/features/workouts/history-service";
type Context = { params: Promise<{ sessionId: string }> };
export async function GET(request: Request, context: Context) {
  return workoutApi(request, false, async (userId) => {
    const session = getWorkout(userId, numberParam((await context.params).sessionId));
    if (!session) throw new WorkoutError(404, "Workout not found.");
    return NextResponse.json(session);
  });
}
export async function PUT(request: Request, context: Context) {
  return workoutApi(request, true, async (userId) => {
    const body = await readWorkoutBody<Omit<Parameters<typeof updateQuickStructure>[0], "userId" | "sessionId">>(request);
    return NextResponse.json(updateQuickStructure({ ...body, userId, sessionId: numberParam((await context.params).sessionId) }));
  });
}
export async function PATCH(request: Request, context: Context) {
  return workoutApi(request, true, async (userId) => NextResponse.json(finishQuickSession(userId, numberParam((await context.params).sessionId))));
}
export async function DELETE(request: Request, context: Context) {
  return workoutApi(request, true, async (userId) => {
    const id = numberParam((await context.params).sessionId);
    const session = getWorkout(userId, id);
    if (!session) throw new WorkoutError(404, "Workout not found.");
    if (session.status !== "in_progress") throw new WorkoutError(400, "Only an in-progress workout can be discarded.");
    db.prepare("DELETE FROM sessions WHERE id=? AND user_id=?").run(id, userId);
    return NextResponse.json({ success: true });
  });
}
