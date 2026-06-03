import { NextResponse } from "next/server";
import { assertSameOrigin, jsonError, isUnauthorized, numberParam } from "@/lib/api";
import { getSettingNumber, requireUser } from "@/lib/auth";
import { calculateWeight } from "@/lib/calculator";
import { db } from "@/lib/db";

type RouteContext = {
  params: Promise<{ exerciseId: string }>;
};

type ExerciseUpdateBody = {
  name?: unknown;
  trainingMax?: unknown;
  move?: unknown;
};

type ExerciseRow = {
  id: number;
  day_id: number;
  name: string;
  training_max: number;
  sort_order: number;
  shared_exercise_key: string | null;
  program_definition_id: number | null;
  program_run_id: number | null;
};

export async function PUT(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { exerciseId } = await context.params;
    const id = numberParam(exerciseId);
    const body = (await request.json()) as ExerciseUpdateBody;

    const exercise = db
      .prepare(
        `SELECT e.*, p.program_definition_id, p.program_run_id
         FROM exercises e
         JOIN days d ON d.id = e.day_id
         JOIN programs p ON p.id = d.program_id
         WHERE e.id = ?
           AND e.archived_at IS NULL
           AND d.archived_at IS NULL
           AND p.user_id = ?
           AND p.archived_at IS NULL`,
      )
      .get(id, user.id) as ExerciseRow | undefined;
    if (!exercise) return jsonError("Exercise not found", 404);

    if (body.move === "up" || body.move === "down") {
      db.transaction(() => {
        const direction = body.move;
        const sibling = db
          .prepare(
            `
              SELECT id, sort_order, shared_exercise_key
              FROM exercises
              WHERE day_id = ?
                AND archived_at IS NULL
                AND sort_order ${direction === "up" ? "<" : ">"} ?
              ORDER BY sort_order ${direction === "up" ? "DESC" : "ASC"}, id ${direction === "up" ? "DESC" : "ASC"}
              LIMIT 1
            `,
          )
          .get(exercise.day_id, exercise.sort_order) as
          | { id: number; sort_order: number; shared_exercise_key: string | null }
          | undefined;
        if (!sibling) return;

        db.prepare("UPDATE exercises SET sort_order = ? WHERE id = ?").run(sibling.sort_order, exercise.id);
        db.prepare("UPDATE exercises SET sort_order = ? WHERE id = ?").run(exercise.sort_order, sibling.id);
        if (exercise.program_definition_id && exercise.shared_exercise_key && sibling.shared_exercise_key) {
          db.prepare(
            `
              UPDATE program_definition_exercises
              SET sort_order = ?
              WHERE stable_key = ?
                AND program_definition_day_id IN (
                  SELECT id
                  FROM program_definition_days
                  WHERE program_definition_id = ?
                )
            `,
          ).run(sibling.sort_order, exercise.shared_exercise_key, exercise.program_definition_id);
          db.prepare(
            `
              UPDATE program_definition_exercises
              SET sort_order = ?
              WHERE stable_key = ?
                AND program_definition_day_id IN (
                  SELECT id
                  FROM program_definition_days
                  WHERE program_definition_id = ?
                )
            `,
          ).run(exercise.sort_order, sibling.shared_exercise_key, exercise.program_definition_id);
        }
      })();

      return NextResponse.json({ success: true });
    }

    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : exercise.name;
    const trainingMax = body.trainingMax === undefined ? exercise.training_max : Number(body.trainingMax);
    if (!Number.isFinite(trainingMax) || trainingMax <= 0) {
      return jsonError("trainingMax must be positive", 400);
    }

    db.transaction(() => {
      db.prepare("UPDATE exercises SET name = ?, training_max = ? WHERE id = ?").run(name, trainingMax, id);
      if (exercise.program_definition_id && exercise.shared_exercise_key) {
        db.prepare(
          `
            UPDATE program_definition_exercises
            SET name = ?
            WHERE stable_key = ?
              AND program_definition_day_id IN (
                SELECT id
                FROM program_definition_days
                WHERE program_definition_id = ?
              )
          `,
        ).run(name, exercise.shared_exercise_key, exercise.program_definition_id);
      }

      if (body.trainingMax !== undefined) {
        if (exercise.program_run_id && exercise.shared_exercise_key) {
          db.prepare(
            `
              INSERT INTO program_run_expected_maxes (program_run_id, shared_exercise_key, expected_max)
              VALUES (?, ?, ?)
              ON CONFLICT(program_run_id, shared_exercise_key)
              DO UPDATE SET expected_max = excluded.expected_max, updated_at = datetime('now')
            `,
          ).run(exercise.program_run_id, exercise.shared_exercise_key, trainingMax);
        }
        const rounding = getSettingNumber(user.id, "rounding", 2.5);
        const settings = db
          .prepare("SELECT id, intensity_pct FROM week_settings WHERE exercise_id = ?")
          .all(id) as { id: number; intensity_pct: number }[];

        const update = db.prepare("UPDATE week_settings SET calculated_weight = ? WHERE id = ?");
        for (const setting of settings) {
          update.run(calculateWeight(trainingMax, setting.intensity_pct, rounding), setting.id);
        }
      }
    })();

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to update exercise", 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { exerciseId } = await context.params;
    const id = numberParam(exerciseId);

    const exercise = db
      .prepare(
        `SELECT e.id, e.shared_exercise_key, p.program_definition_id
         FROM exercises e
         JOIN days d ON d.id = e.day_id
         JOIN programs p ON p.id = d.program_id
         WHERE e.id = ?
           AND e.archived_at IS NULL
           AND d.archived_at IS NULL
           AND p.user_id = ?
           AND p.archived_at IS NULL`,
      )
      .get(id, user.id) as
      | { id: number; shared_exercise_key: string | null; program_definition_id: number | null }
      | undefined;
    if (!exercise) return jsonError("Exercise not found", 404);

    db.transaction(() => {
      db.prepare("UPDATE exercises SET archived_at = datetime('now') WHERE id = ?").run(id);
      if (exercise.program_definition_id && exercise.shared_exercise_key) {
        db.prepare(
          `
            UPDATE program_definition_exercises
            SET archived_at = datetime('now')
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
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to delete exercise", 500);
  }
}
