import { NextResponse } from "next/server";
import { assertSameOrigin, jsonError, isUnauthorized, numberParam } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

type RouteContext = {
  params: Promise<{ exerciseId: string }>;
};

type SupersetBody = {
  linkExerciseId?: unknown;
};

export async function PUT(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { exerciseId } = await context.params;
    const id = numberParam(exerciseId);

    const exercise = db
      .prepare(
        `SELECT e.*, p.program_definition_id
         FROM exercises e
         JOIN days d ON d.id = e.day_id
         JOIN programs p ON p.id = d.program_id
         WHERE e.id = ? AND e.archived_at IS NULL AND d.archived_at IS NULL AND p.user_id = ?`,
      )
      .get(id, user.id) as
      | {
          id: number;
          day_id: number;
          sort_order: number;
          shared_exercise_key: string | null;
          program_definition_id: number | null;
        }
      | undefined;
    if (!exercise) return jsonError("Exercise not found", 404);

    const body = (await request.json()) as SupersetBody;
    const linkExerciseId =
      body.linkExerciseId === undefined || body.linkExerciseId === null
        ? null
        : Number(body.linkExerciseId);

    if (linkExerciseId !== null && (!Number.isInteger(linkExerciseId) || linkExerciseId <= 0)) {
      return jsonError("linkExerciseId must be a positive integer or null", 400);
    }

    if (linkExerciseId === null) {
      db.transaction(() => {
        db.prepare("UPDATE exercises SET superset_group = NULL WHERE id = ?").run(id);
        if (exercise.program_definition_id && exercise.shared_exercise_key) {
          db.prepare(
            `
              UPDATE program_definition_exercises
              SET superset_group = NULL
              WHERE stable_key = ?
                AND program_definition_day_id IN (
                  SELECT id
                  FROM program_definition_days
                  WHERE program_definition_id = ?
                )
            `,
          ).run(exercise.shared_exercise_key, exercise.program_definition_id);
        }
      })();
      return NextResponse.json({ success: true });
    }

    const target = db
      .prepare(
        `SELECT e.id, e.day_id, e.sort_order, e.superset_group, e.shared_exercise_key
         FROM exercises e
         JOIN days d ON d.id = e.day_id
         JOIN programs p ON p.id = d.program_id
         WHERE e.id = ? AND e.archived_at IS NULL AND d.archived_at IS NULL AND p.user_id = ?`,
      )
      .get(linkExerciseId, user.id) as
      | { id: number; day_id: number; sort_order: number; superset_group: string | null; shared_exercise_key: string | null }
      | undefined;
    if (!target) return jsonError("Target exercise not found", 404);

    if (target.day_id !== exercise.day_id) {
      return jsonError("Exercises must be on the same day to form a superset", 400);
    }

    const group = target.superset_group ?? crypto.randomUUID();

    db.transaction(() => {
      db.prepare("UPDATE exercises SET superset_group = ? WHERE id = ?").run(group, id);
      if (exercise.program_definition_id && exercise.shared_exercise_key) {
        db.prepare(
          `
            UPDATE program_definition_exercises
            SET superset_group = ?
            WHERE stable_key = ?
              AND program_definition_day_id IN (
                SELECT id
                FROM program_definition_days
                WHERE program_definition_id = ?
              )
          `,
        ).run(group, exercise.shared_exercise_key, exercise.program_definition_id);
      }
      if (!target.superset_group) {
        db.prepare("UPDATE exercises SET superset_group = ? WHERE id = ?").run(group, linkExerciseId);
        if (exercise.program_definition_id && target.shared_exercise_key) {
          db.prepare(
            `
              UPDATE program_definition_exercises
              SET superset_group = ?
              WHERE stable_key = ?
                AND program_definition_day_id IN (
                  SELECT id
                  FROM program_definition_days
                  WHERE program_definition_id = ?
                )
            `,
          ).run(group, target.shared_exercise_key, exercise.program_definition_id);
        }
      }
    })();

    return NextResponse.json({ success: true, supersetGroup: group });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to update superset", 500);
  }
}
