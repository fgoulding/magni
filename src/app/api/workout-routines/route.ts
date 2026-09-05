import { NextResponse } from "next/server";
import { readWorkoutBody, workoutApi } from "@/features/workouts/api";
import { listRoutines, saveRoutine } from "@/features/workouts/history-service";
export async function GET(request: Request) { return workoutApi(request, false, (userId) => NextResponse.json(listRoutines(userId))); }
export async function POST(request: Request) {
  return workoutApi(request, true, async (userId) => {
    const body = await readWorkoutBody<Omit<Parameters<typeof saveRoutine>[0], "userId">>(request);
    return NextResponse.json(saveRoutine({ ...body, userId }), { status: 201 });
  });
}
