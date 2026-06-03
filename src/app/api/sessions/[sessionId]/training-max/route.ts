import { NextResponse } from "next/server";
import { assertSameOrigin, isUnauthorized, jsonError, numberParam } from "@/lib/api";
import { getSettingNumber, requireUser } from "@/lib/auth";
import { calculateWeight } from "@/lib/calculator";
import { db } from "@/lib/db";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

type SetRow = { id: number; intensity_pct: number; actual_reps: number | null };

/**
 * Override an exercise's training max for THIS workout only. The change is
 * session-scoped: it recomputes the remaining (unlogged) sets' weights now, and
 * because complete-and-advance derives the next run TM from session_sets, it
 * carries forward when you finish — but if you never complete the workout, the
 * run's stored TM is untouched, so it reverts. Logged sets keep their weights.
 */
export async function PUT(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { sessionId } = await context.params;
    const id = numberParam(sessionId);

    const body = (await request.json()) as { exerciseName?: unknown; trainingMax?: unknown };
    const exerciseName = typeof body.exerciseName === "string" ? body.exerciseName.trim() : "";
    const parsed = Number(body.trainingMax);
    if (!exerciseName) return jsonError("exerciseName is required", 400);
    if (!Number.isFinite(parsed) || parsed <= 0) return jsonError("trainingMax must be positive", 400);
    const trainingMax = Math.round(parsed * 10) / 10; // 1 decimal place

    const session = db
      .prepare("SELECT id FROM sessions WHERE id = ? AND user_id = ? AND completed = 0")
      .get(id, user.id) as { id: number } | undefined;
    if (!session) return jsonError("Workout not found", 404);

    const rows = db
      .prepare(
        "SELECT id, intensity_pct, actual_reps FROM session_sets WHERE session_id = ? AND exercise_name = ?",
      )
      .all(id, exerciseName) as SetRow[];
    if (rows.length === 0) return jsonError("Exercise not found in this workout", 404);

    const rounding = getSettingNumber(user.id, "rounding", 2.5);

    db.transaction(() => {
      const setTm = db.prepare("UPDATE session_sets SET training_max = ? WHERE id = ?");
      const setWeight = db.prepare("UPDATE session_sets SET calculated_weight = ? WHERE id = ?");
      for (const row of rows) {
        setTm.run(trainingMax, row.id);
        // Only re-price sets you haven't logged yet — keep completed sets as-is.
        if (row.actual_reps === null) {
          setWeight.run(calculateWeight(trainingMax, row.intensity_pct, rounding), row.id);
        }
      }
    })();

    const updated = db
      .prepare(
        "SELECT id, training_max, calculated_weight FROM session_sets WHERE session_id = ? AND exercise_name = ?",
      )
      .all(id, exerciseName) as { id: number; training_max: number; calculated_weight: number }[];

    return NextResponse.json({ sets: updated });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (error instanceof Error && error.message === "Forbidden cross-origin request") {
      return jsonError(error.message, 403);
    }
    return jsonError("Failed to update training max", 500);
  }
}
