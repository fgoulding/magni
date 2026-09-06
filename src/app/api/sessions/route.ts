import { NextResponse } from "next/server";
import { readWorkoutBody, workoutApi } from "@/features/workouts/api";
import { createQuickSession, listWorkouts } from "@/features/workouts/history-service";
import { userDateKey } from "@/lib/user-date";

export async function POST(request: Request) {
  return workoutApi(request, true, async (userId) => {
    const body = await readWorkoutBody<Omit<Parameters<typeof createQuickSession>[0], "userId">>(request);
    const result = createQuickSession({ ...body, userId });
    return NextResponse.json({ ...result.session, currentDate: userDateKey(userId) }, { status: result.created ? 201 : 200 });
  });
}
export async function GET(request: Request) {
  return workoutApi(request, false, (userId) => NextResponse.json(listWorkouts(userId, new URL(request.url).searchParams.get("before") ?? undefined)));
}
