import { NextResponse } from "next/server";
import { assertSameOrigin, isBadRequest, isUnauthorized, jsonError, numberParam, readJson } from "@/lib/api";
import { getSettingNumber, requireUser } from "@/lib/auth";
import { calculateWeight } from "@/lib/calculator";
import { db } from "@/lib/db";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

type SetRow = {
  id: number;
  intensity_pct: number;
  actual_reps: number | null;
  shared_exercise_key: string | null;
};

/**
 * Override an exercise's training max for THIS workout. It recomputes the
 * remaining (unlogged) sets' weights now, AND upserts the run's canonical
 * expected max (program_run_expected_maxes) so the override carries forward to
 * "start next cycle" / Duplicate even if you never complete this workout (which
 * reads the run TM by most-recent updated_at). If the lift later auto-progresses
 * on completion, complete-and-advance overwrites this with override+delta — the
 * desired result. Logged sets keep their weights.
 */
export async function PUT(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { sessionId } = await context.params;
    const id = numberParam(sessionId);

    const body = await readJson<{ exerciseName?: unknown; trainingMax?: unknown }>(request);
    const exerciseName = typeof body.exerciseName === "string" ? body.exerciseName.trim() : "";
    const parsed = Number(body.trainingMax);
    if (!exerciseName) return jsonError("exerciseName is required", 400);
    if (!Number.isFinite(parsed) || parsed <= 0) return jsonError("trainingMax must be positive", 400);
    const trainingMax = Math.round(parsed * 10) / 10; // 1 decimal place

    const session = db
      .prepare("SELECT id, program_run_id FROM sessions WHERE id = ? AND user_id = ? AND completed = 0")
      .get(id, user.id) as { id: number; program_run_id: number | null } | undefined;
    if (!session) return jsonError("Workout not found", 404);

    const rows = db
      .prepare(
        "SELECT id, intensity_pct, actual_reps, shared_exercise_key FROM session_sets WHERE session_id = ? AND exercise_name = ?",
      )
      .all(id, exerciseName) as SetRow[];
    if (rows.length === 0) return jsonError("Exercise not found in this workout", 404);

    const sharedExerciseKey = rows.find((row) => row.shared_exercise_key)?.shared_exercise_key ?? null;
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
      // Persist to the run's canonical TM so the override survives without a
      // completion and is picked up by Duplicate / start-next-cycle. Skipped for
      // ad-hoc/quick lifts (no run or stable key).
      if (session.program_run_id && sharedExerciseKey) {
        db.prepare(
          `
            INSERT INTO program_run_expected_maxes (program_run_id, shared_exercise_key, expected_max)
            VALUES (?, ?, ?)
            ON CONFLICT(program_run_id, shared_exercise_key)
            DO UPDATE SET expected_max = excluded.expected_max, updated_at = datetime('now')
          `,
        ).run(session.program_run_id, sharedExerciseKey, trainingMax);
      }
    })();

    const updated = db
      .prepare(
        "SELECT id, training_max, calculated_weight FROM session_sets WHERE session_id = ? AND exercise_name = ?",
      )
      .all(id, exerciseName) as { id: number; training_max: number; calculated_weight: number }[];

    return NextResponse.json({ sets: updated });
  } catch (error) {
    if (isBadRequest(error)) return jsonError(error.message, 400);
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (error instanceof Error && error.message === "Forbidden cross-origin request") {
      return jsonError(error.message, 403);
    }
    return jsonError("Failed to update training max", 500);
  }
}
