import { NextResponse } from "next/server";
import { assertSameOrigin, isUnauthorized, jsonError, numberParam } from "@/lib/api";
import { getSettingNumber, requireUser } from "@/lib/auth";
import { calculateWeight } from "@/lib/calculator";
import { db } from "@/lib/db";

type RouteContext = { params: Promise<{ exerciseId: string }> };

type ResolvedExercise = {
  pdeId: number;
  legacyId: number;
  numWeeks: number;
  progressionType: string;
  expectedMax: number;
};

/** Resolve a legacy exercise id to its definition exercise, scoped to the owner. */
function resolveOwnedExercise(legacyExerciseId: number, userId: number): ResolvedExercise | undefined {
  return db
    .prepare(
      `
        SELECT
          pde.id AS pdeId,
          e.id AS legacyId,
          pd.num_weeks AS numWeeks,
          pde.progression_type AS progressionType,
          COALESCE(prx.expected_max, e.training_max, 100) AS expectedMax
        FROM exercises e
        JOIN days d ON d.id = e.day_id
        JOIN programs p ON p.id = d.program_id
        JOIN program_definitions pd ON pd.id = p.program_definition_id
        JOIN program_runs pr ON pr.id = p.program_run_id
        JOIN program_definition_days pdd
          ON pdd.program_definition_id = pd.id
         AND pdd.stable_key = d.shared_day_key
         AND pdd.archived_at IS NULL
        JOIN program_definition_exercises pde
          ON pde.program_definition_day_id = pdd.id
         AND pde.stable_key = e.shared_exercise_key
         AND pde.archived_at IS NULL
        LEFT JOIN program_run_expected_maxes prx
          ON prx.program_run_id = pr.id
         AND prx.shared_exercise_key = pde.stable_key
        WHERE e.id = ?
          AND e.archived_at IS NULL
          AND d.archived_at IS NULL
          AND p.user_id = ?
          AND p.archived_at IS NULL
      `,
    )
    .get(legacyExerciseId, userId) as ResolvedExercise | undefined;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { exerciseId } = await context.params;
    const exercise = resolveOwnedExercise(numberParam(exerciseId), user.id);
    if (!exercise) return jsonError("Exercise not found", 404);

    const rounding = getSettingNumber(user.id, "rounding", 2.5);
    const rows = db
      .prepare(
        `
          SELECT week_number, MAX(weight) AS weight, MAX(intensity_pct) AS intensity_pct
          FROM program_definition_week_settings
          WHERE program_definition_exercise_id = ?
          GROUP BY week_number
          ORDER BY week_number
        `,
      )
      .all(exercise.pdeId) as { week_number: number; weight: number | null; intensity_pct: number }[];

    const weights = rows.map(
      (row) => row.weight ?? calculateWeight(exercise.expectedMax, row.intensity_pct, rounding),
    );

    return NextResponse.json({ numWeeks: exercise.numWeeks, weights });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to load weekly weights", 500);
  }
}

const saveWeeklyWeights = db.transaction((pdeId: number, weights: number[]) => {
  const update = db.prepare(
    "UPDATE program_definition_week_settings SET weight = ? WHERE program_definition_exercise_id = ? AND week_number = ?",
  );
  weights.forEach((weight, index) => {
    update.run(weight, pdeId, index + 1);
  });
});

export async function PUT(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { exerciseId } = await context.params;
    const exercise = resolveOwnedExercise(numberParam(exerciseId), user.id);
    if (!exercise) return jsonError("Exercise not found", 404);

    if (exercise.progressionType !== "custom") {
      return jsonError("Per-week weights are only editable on manual exercises", 400);
    }

    const body = (await request.json()) as { weights?: unknown };
    if (!Array.isArray(body.weights)) {
      return jsonError("weights must be an array", 400);
    }
    const weights = body.weights.map((value) => Number(value));
    if (weights.some((value) => !Number.isFinite(value) || value < 0)) {
      return jsonError("weights must be non-negative numbers", 400);
    }
    if (weights.length !== exercise.numWeeks) {
      return jsonError(`weights must have ${exercise.numWeeks} entries`, 400);
    }

    saveWeeklyWeights(exercise.pdeId, weights);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to save weekly weights", 500);
  }
}
