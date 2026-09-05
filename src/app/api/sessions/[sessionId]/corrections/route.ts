import { NextResponse } from "next/server";
import { numberParam } from "@/lib/api";
import { readWorkoutBody, workoutApi } from "@/features/workouts/api";
import { correctWorkout, previewCorrection } from "@/features/workouts/history-service";
export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  return workoutApi(request, true, async (userId) => {
    const body = await readWorkoutBody<Omit<Parameters<typeof correctWorkout>[0], "userId" | "sessionId"> & { preview?: boolean }>(request);
    const sessionId = numberParam((await context.params).sessionId);
    return NextResponse.json(body.preview ? previewCorrection(userId, sessionId, body.sets) : correctWorkout({ ...body, userId, sessionId, reason: body.reason || "Updated training log" }));
  });
}
