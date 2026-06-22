import { NextResponse } from "next/server";
import { parseSharedProgramSnapshot } from "@/features/shared-programs/snapshot";
import type { SharedProgramExerciseSlotSnapshot, SharedProgramSnapshot } from "@/features/shared-programs/types";
import { getSnapshotWeek } from "@/features/shared-programs/week-utils";
import { getTrainingTemplate } from "@/features/training-templates/registry";
import { jsonError, isBadRequest, isUnauthorized, assertSameOrigin, readJson } from "@/lib/api";
import { getSettingNumber, requireUser } from "@/lib/auth";
import { calculateWeight } from "@/lib/calculator";
import { db } from "@/lib/db";

type ProgramCreateBody = {
  name?: unknown;
  numWeeks?: unknown;
  snapshot?: unknown;
  expectedMaxes?: unknown;
};

type InsertExerciseStatement = Readonly<{
  run: (...params: unknown[]) => { lastInsertRowid: number | bigint };
}>;

const DEFAULT_SNAPSHOT_TRAINING_MAX = 100;

function parseExpectedMaxes(
  value: unknown,
): Record<string, number> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expectedMaxes must be an object");
  }
  const record = value as Record<string, unknown>;
  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(record)) {
    if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) {
      throw new Error(`expectedMaxes.${key} must be a positive number`);
    }
    result[key] = val;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export async function GET() {
  try {
    const user = await requireUser();
    const rows = db
      .prepare(
        `SELECT
           p.*,
           COALESCE(pr.name, p.name) AS name,
           COALESCE(pd.description, p.description) AS description,
           COALESCE(pd.num_weeks, p.num_weeks) AS num_weeks,
           COALESCE(pr.current_week, p.current_week) AS current_week,
           COALESCE(pr.current_day, p.current_day) AS current_day,
           COALESCE(pr.schedule_weekdays, p.schedule_weekdays) AS schedule_weekdays,
           COALESCE(pr.schedule_mode, p.schedule_mode) AS schedule_mode,
           CASE
             WHEN pr.status IS NULL THEN p.is_active
             WHEN pr.status = 'active' THEN 1
             ELSE 0
           END AS is_active,
           (SELECT MAX(s.date) FROM sessions s WHERE s.program_run_id = pr.id OR s.program_id = p.id) AS last_session
         FROM programs p
         LEFT JOIN program_definitions pd ON pd.id = p.program_definition_id
         LEFT JOIN program_runs pr ON pr.id = p.program_run_id
         WHERE p.user_id = ? AND p.archived_at IS NULL
           AND COALESCE(pr.archived_at, p.archived_at) IS NULL
           AND COALESCE(pr.status, 'active') != 'archived'
         ORDER BY p.created_at DESC`,
      )
      .all(user.id);

    return NextResponse.json(rows);
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to fetch programs", 500);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await readJson<ProgramCreateBody>(request);

    if (typeof body.name !== "string" || body.name.trim() === "") {
      return jsonError("name is required", 400);
    }

    const numWeeks = body.numWeeks === undefined ? 7 : Number(body.numWeeks);
    if (!Number.isInteger(numWeeks) || numWeeks <= 0 || numWeeks > 104) {
      return jsonError("numWeeks must be a positive integer", 400);
    }

    const snapshot =
      body.snapshot === undefined ? undefined : parseSharedProgramSnapshot(JSON.stringify(body.snapshot));

    const expectedMaxes = parseExpectedMaxes(body.expectedMaxes);

    const result = createProgram({
      userId: user.id,
      name: body.name.trim(),
      numWeeks,
      snapshot,
      expectedMaxes,
    });

    return NextResponse.json(
      { id: result.id, name: body.name.trim(), num_weeks: numWeeks },
      { status: 201 },
    );
  } catch (error) {
    if (isBadRequest(error)) return jsonError(error.message, 400);
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (error instanceof Error && error.message.startsWith("Unknown training template")) {
      return jsonError(error.message, 400);
    }
    if (error instanceof Error && error.message.includes("does not support")) {
      return jsonError(error.message, 400);
    }
    if (error instanceof Error && error.message.startsWith("Snapshot")) {
      return jsonError(error.message, 400);
    }
    if (error instanceof Error && error.message.startsWith("Shared program snapshot")) {
      return jsonError(error.message, 400);
    }
    if (error instanceof Error && error.message.startsWith("Unsupported shared program snapshot")) {
      return jsonError(error.message, 400);
    }
    if (error instanceof Error && error.message.includes("key is required")) {
      return jsonError(error.message, 400);
    }
    if (error instanceof Error && error.message.startsWith("expectedMaxes")) {
      return jsonError(error.message, 400);
    }
    return jsonError("Failed to create program", 500);
  }
}

const createProgram = db.transaction(
  ({
    userId,
    name,
    numWeeks,
    snapshot,
    expectedMaxes,
  }: {
    userId: number;
    name: string;
    numWeeks: number;
    snapshot?: SharedProgramSnapshot;
    expectedMaxes?: Record<string, number>;
  }): Readonly<{ id: number }> => {
    const context = createProgramContext({
      userId,
      name,
      description: snapshot?.description ?? "",
      numWeeks,
    });
    const result = db
      .prepare(
        `
          INSERT INTO programs (
            user_id,
            name,
            description,
            num_weeks,
            program_definition_id,
            program_run_id
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(userId, name, snapshot?.description ?? "", numWeeks, context.definitionId, context.runId);
    const programId = Number(result.lastInsertRowid);

    if (snapshot) {
      materializeSnapshot({
        programId,
        definitionId: context.definitionId,
        runId: context.runId,
        userId,
        numWeeks,
        snapshot,
        expectedMaxes,
      });
    }

    return { id: programId };
  },
);

function createProgramContext({
  userId,
  name,
  description,
  numWeeks,
}: {
  userId: number;
  name: string;
  description: string;
  numWeeks: number;
}): { definitionId: number; runId: number } {
  const definition = db
    .prepare(
      `
        INSERT INTO program_definitions (
          owner_user_id,
          name,
          description,
          num_weeks,
          source_type,
          visibility
        ) VALUES (?, ?, ?, ?, 'custom', 'private')
      `,
    )
    .run(userId, name, description, numWeeks);
  const definitionId = Number(definition.lastInsertRowid);
  const run = db
    .prepare(
      `
        INSERT INTO program_runs (
          user_id,
          program_definition_id,
          name
        ) VALUES (?, ?, ?)
      `,
    )
    .run(userId, definitionId, name);

  return { definitionId, runId: Number(run.lastInsertRowid) };
}

function materializeSnapshot({
  programId,
  definitionId,
  runId,
  userId,
  numWeeks,
  snapshot,
  expectedMaxes,
}: {
  programId: number;
  definitionId: number;
  runId: number;
  userId: number;
  numWeeks: number;
  snapshot: SharedProgramSnapshot;
  expectedMaxes?: Record<string, number>;
}): void {
  const rounding = getSettingNumber(userId, "rounding", 2.5);
  const insertDay = db.prepare(
    "INSERT INTO days (program_id, name, day_number, sort_order, shared_day_key) VALUES (?, ?, ?, ?, ?)",
  );
  const insertDefinitionDay = db.prepare(
    "INSERT INTO program_definition_days (program_definition_id, name, day_number, sort_order, stable_key) VALUES (?, ?, ?, ?, ?)",
  );
  const insertExercise = db.prepare(
    `
      INSERT INTO exercises (
        day_id,
        name,
        training_max,
        category,
        progression_type,
        auto_progression_enabled,
        sort_order,
        shared_exercise_key,
        superset_group
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );
  const insertDefinitionExercise = db.prepare(
    `
      INSERT INTO program_definition_exercises (
        program_definition_day_id,
        name,
        category,
        progression_type,
        sort_order,
        stable_key,
        superset_group
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  );
  const insertWeek = db.prepare(
    `
      INSERT INTO week_settings (
        exercise_id,
        week_number,
        set_number,
        intensity_pct,
        reps,
        sets,
        rep_out_target,
        calculated_weight
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );
  const insertDefinitionWeek = db.prepare(
    `
      INSERT INTO program_definition_week_settings (
        program_definition_exercise_id,
        week_number,
        set_number,
        intensity_pct,
        reps,
        sets,
        rep_out_target
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  );
  const upsertRunMax = db.prepare(
    `
      INSERT INTO program_run_expected_maxes (program_run_id, shared_exercise_key, expected_max)
      VALUES (?, ?, ?)
      ON CONFLICT(program_run_id, shared_exercise_key)
      DO UPDATE SET expected_max = excluded.expected_max, updated_at = datetime('now')
    `,
  );

  snapshot.days.forEach((day, dayIndex) => {
    const sortOrder = dayIndex + 1;
    const dayId = Number(insertDay.run(programId, day.name, sortOrder, sortOrder, day.key).lastInsertRowid);
    const definitionDayId = Number(
      insertDefinitionDay.run(definitionId, day.name, sortOrder, sortOrder, day.key).lastInsertRowid,
    );

    day.exercises.forEach((exercise, exerciseIndex) => {
      const template = getTrainingTemplate(exercise.progressionType);
      if (!template.supportedCategories.includes(exercise.category)) {
        throw new Error(`${template.id} does not support ${exercise.category} exercises`);
      }
      const trainingMax = expectedMaxes?.[exercise.key] ?? DEFAULT_SNAPSHOT_TRAINING_MAX;
      const exerciseId = materializeExercise({
        dayId,
        exercise,
        sortOrder: exerciseIndex + 1,
        insertExercise,
        trainingMax,
      });
      const definitionExerciseId = Number(
        insertDefinitionExercise.run(
          definitionDayId,
          exercise.name,
          exercise.category,
          template.id,
          exerciseIndex + 1,
          exercise.key,
          exercise.supersetGroup ?? null,
        ).lastInsertRowid,
      );
      upsertRunMax.run(runId, exercise.key, trainingMax);

      for (let weekNumber = 1; weekNumber <= numWeeks; weekNumber++) {
        const weekDef = getSnapshotWeek(exercise.weeks, weekNumber);
        if (weekDef.ramp && weekDef.ramp.length > 0) {
          for (const rampSet of weekDef.ramp) {
            insertDefinitionWeek.run(
              definitionExerciseId,
              weekNumber,
              rampSet.setNumber,
              rampSet.intensityPct,
              rampSet.reps,
              1,
              rampSet.repOutTarget,
            );
            insertWeek.run(
              exerciseId,
              weekNumber,
              rampSet.setNumber,
              rampSet.intensityPct,
              rampSet.reps,
              1,
              rampSet.repOutTarget,
              calculateWeight(trainingMax, rampSet.intensityPct, rounding),
            );
          }
        } else {
          insertDefinitionWeek.run(
            definitionExerciseId,
            weekNumber,
            1,
            weekDef.intensityPct,
            weekDef.reps,
            weekDef.sets,
            weekDef.repOutTarget,
          );
          insertWeek.run(
            exerciseId,
            weekNumber,
            1,
            weekDef.intensityPct,
            weekDef.reps,
            weekDef.sets,
            weekDef.repOutTarget,
            calculateWeight(trainingMax, weekDef.intensityPct, rounding),
          );
        }
      }
    });
  });
}

function materializeExercise({
  dayId,
  exercise,
  sortOrder,
  insertExercise,
  trainingMax,
}: {
  dayId: number;
  exercise: SharedProgramExerciseSlotSnapshot;
  sortOrder: number;
  insertExercise: InsertExerciseStatement;
  trainingMax: number;
}): number {
  const template = getTrainingTemplate(exercise.progressionType);

  if (!template.supportedCategories.includes(exercise.category)) {
    throw new Error(`${template.id} does not support ${exercise.category} exercises`);
  }

  return Number(
    insertExercise.run(
      dayId,
      exercise.name,
      trainingMax,
      exercise.category,
      template.id,
      template.autoProgression ? 1 : 0,
      sortOrder,
      exercise.key,
      exercise.supersetGroup ?? null,
    ).lastInsertRowid,
  );
}
