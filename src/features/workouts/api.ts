import { NextResponse } from "next/server";
import { assertSameOrigin, BadRequestError, isBadRequest, isUnauthorized, jsonError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { WorkoutError } from "./history-service";

export async function readWorkoutBody<T>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text.trim()) return {} as T;
  if (text.length > 200_000) throw new BadRequestError("Workout changes are too large.");
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as T;
  } catch { throw new BadRequestError("Invalid request body"); }
}
export async function workoutApi(request: Request | undefined, write: boolean, operation: (userId: number) => Promise<NextResponse> | NextResponse): Promise<NextResponse> {
  try {
    if (write && request) assertSameOrigin(request);
    const user = await requireUser();
    return await operation(user.id);
  } catch (error) {
    if (error instanceof WorkoutError) return jsonError(error.message, error.status);
    if (isBadRequest(error)) return jsonError(error.message, 400);
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (error instanceof Error && error.message === "Forbidden cross-origin request") return jsonError(error.message, 403);
    console.error("[workouts] Request failed", error);
    return jsonError("Could not save this workout change. Your pending edits remain available to retry.", 500);
  }
}
