import { NextResponse } from "next/server";
import { numberParam } from "@/lib/api";
import { readWorkoutBody, workoutApi } from "@/features/workouts/api";
import { createQuickSession } from "@/features/workouts/history-service";
export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  return workoutApi(request, true, async (userId) => {
    const body = await readWorkoutBody<{ requestKey?: string; date?: string; name?: string }>(request);
    const result = createQuickSession({ requestKey: body.requestKey, date: body.date, name: body.name, userId, sourceSessionId: numberParam((await context.params).sessionId) });
    return NextResponse.json(result.session, { status: 201 });
  });
}
