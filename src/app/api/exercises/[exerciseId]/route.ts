import { NextResponse } from "next/server";
import { updateDefinitionExerciseType } from "@/features/programs/program-service";
import type { ExerciseCategory } from "@/features/training-templates/types";
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
  category?: unknown;
  progressionType?: unknown;
};

type ExerciseRow = {
  id: number;
  day_id: number;
  name: string;
  training_max: number;
  category: string;
  progression_type: string;
  sort_order: number;
  shared_exercise_key: string | null;
  program_definition_id: number | null;
  program_run_id: number | null;
};

function validCategory(value: unknown, fallback: string): ExerciseCategory | null {
  const category = value === undefined ? fallback : value;
  if (category === "main" || category === "aux" || category === "accessory") return category;
  return null;
}

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

    if (body.category !== undefined || body.progressionType !== undefined) {
      const category = validCategory(body.category, exercise.category);
      if (!category) return jsonError("invalid category", 400);
      const progressionType =
        typeof body.progressionType === "string" && body.progressionType.trim()
          ? body.progressionType.trim()
          : exercise.progression_type;
      try {
        updateDefinitionExerciseType({ userId: user.id, legacyExerciseId: id, category, progressionType });
      } catch (error) {
        if (error instanceof Error && error.message.includes("does not support")) {
          return jsonError(error.message, 400);
        }
        if (error instanceof Error && error.message.startsWith("Unknown training template")) {
          return jsonError(error.message, 400);
        }
        throw error;
      }
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
        `SELECT e.id, e.superset_group, e.shared_exercise_key, p.program_definition_id
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
      | {
          id: number;
          superset_group: string | null;
          shared_exercise_key: string | null;
          program_definition_id: number | null;
        }
      | undefined;
    if (!exercise) return jsonError("Exercise not found", 404);

    const clearMembership = (memberId: number, sharedKey: string | null) => {
      db.prepare("UPDATE exercises SET superset_group = NULL WHERE id = ?").run(memberId);
      if (exercise.program_definition_id && sharedKey) {
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
        ).run(sharedKey, exercise.program_definition_id);
      }
    };

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
      // Deleting a member can strand the partner alone — a superset of one has no
      // UI to dissolve it, so clear the lone survivor's group too.
      if (exercise.superset_group) {
        const remaining = db
          .prepare(
            "SELECT id, shared_exercise_key FROM exercises WHERE superset_group = ? AND archived_at IS NULL",
          )
          .all(exercise.superset_group) as { id: number; shared_exercise_key: string | null }[];
        if (remaining.length === 1) {
          clearMembership(remaining[0].id, remaining[0].shared_exercise_key);
        }
      }
    })();
    return NextResponse.json({ success: true });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to delete exercise", 500);
  }
}
