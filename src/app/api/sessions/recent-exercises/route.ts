import { NextResponse } from "next/server";
import { workoutApi } from "@/features/workouts/api";
import { recentExercises } from "@/features/workouts/history-service";
export async function GET(request: Request) {
  return workoutApi(request, false, (userId) => NextResponse.json(recentExercises(userId, new URL(request.url).searchParams.get("q") ?? "", new URL(request.url).searchParams.get("unit") === "kg" ? "kg" : "lb")));
}
