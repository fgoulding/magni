import { NextResponse } from "next/server";
import { assertSameOrigin, jsonError, isUnauthorized, numberParam } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { applyTmDelta } from "@/lib/calculator";
import { db } from "@/lib/db";
import { calculateTemplateTrainingMaxDelta } from "@/features/training-templates/progression";
import type { ExerciseCategory } from "@/features/training-templates/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type CompletionBody = {
  sessionId?: unknown;
};

type ProgramRow = {
  id: number;
  definition_id: number | null;
  run_id: number | null;
  current_week: number;
  current_day: number;
  num_weeks: number;
};

type SessionRow = {
  id: number;
  completed: number;
  week_number: number;
  day_number: number;
  scheduled_date: string | null;
};

type CompletionSetRow = {
  set_id: number;
  actual_reps: number | null;
  week_number: number;
  set_number: number;
  rep_out_target: number;
  exercise_id: number;
  shared_exercise_key: string | null;
  training_max: number;
  category: ExerciseCategory;
  progression_type: string;
  auto_progression_enabled: number;
};

function nextProgramPosition(program: ProgramRow, completedDayNumber = program.current_day): { currentWeek: number; currentDay: number } {
  const maxDay = program.definition_id
    ? (db
        .prepare(
          "SELECT COALESCE(MAX(day_number), 1) AS value FROM program_definition_days WHERE program_definition_id = ? AND archived_at IS NULL",
        )
        .get(program.definition_id) as { value: number })
    : (db
        .prepare("SELECT COALESCE(MAX(day_number), 1) AS value FROM days WHERE program_id = ? AND archived_at IS NULL")
        .get(program.id) as { value: number });

  let currentWeek = program.current_week;
  let currentDay = completedDayNumber + 1;

  if (currentDay > maxDay.value) {
    currentDay = 1;
    currentWeek += 1;
  }

  if (currentWeek > program.num_weeks) {
    currentWeek = 1;
    currentDay = 1;
  }

  return { currentWeek, currentDay };
}

function shouldAdvanceRun(program: ProgramRow, session: SessionRow): boolean {
  if (!session.scheduled_date) return true;
  return session.week_number === program.current_week && session.day_number === program.current_day;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const programId = numberParam(id);
    const body = (await request.json()) as CompletionBody;
    const sessionId = Number(body.sessionId);

    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return jsonError("sessionId is required", 400);
    }

    const complete = db.transaction(() => {
      const program = db
        .prepare(
          `
            SELECT
              p.id,
              p.program_definition_id AS definition_id,
              p.program_run_id AS run_id,
              COALESCE(pr.current_week, p.current_week) AS current_week,
              COALESCE(pr.current_day, p.current_day) AS current_day,
              COALESCE(pd.num_weeks, p.num_weeks) AS num_weeks
            FROM programs p
            LEFT JOIN program_definitions pd ON pd.id = p.program_definition_id
            LEFT JOIN program_runs pr ON pr.id = p.program_run_id
            WHERE p.id = ?
              AND p.user_id = ?
              AND COALESCE(pr.archived_at, p.archived_at) IS NULL
              AND COALESCE(pr.status, 'active') != 'archived'
          `,
        )
        .get(programId, user.id) as ProgramRow | undefined;
      if (!program) return { response: jsonError("Program not found", 404) };

      const session = db
        .prepare(
          `
            SELECT s.*, COALESCE(pdd.day_number, d.day_number) AS day_number
            FROM sessions s
            LEFT JOIN days d ON d.id = s.day_id
            LEFT JOIN program_definition_days pdd ON pdd.id = s.program_definition_day_id
            WHERE s.id = ?
              AND s.program_id = ?
              AND s.user_id = ?
          `,
        )
        .get(sessionId, programId, user.id) as SessionRow | undefined;
      if (!session) return { response: jsonError("Session not found", 404) };

      const shouldAdvance = shouldAdvanceRun(program, session);
      const next = shouldAdvance
        ? nextProgramPosition(program, session.day_number)
        : { currentWeek: program.current_week, currentDay: program.current_day };

      if (session.completed) {
        return {
          response: NextResponse.json({
            success: true,
            alreadyCompleted: true,
            ...next,
          }),
        };
      }

      const rows = db
        .prepare(
          `SELECT
             ss.id AS set_id,
             ss.actual_reps,
             ss.week_number,
             ss.set_number,
             ss.rep_out_target,
             ss.program_definition_exercise_id AS exercise_id,
             ss.shared_exercise_key,
             ss.training_max,
             ss.category,
             ss.progression_type,
             ss.auto_progression_enabled
           FROM session_sets ss
           WHERE ss.session_id = ?`,
        )
        .all(sessionId) as CompletionSetRow[];

      if (rows.length === 0) {
        return { response: jsonError("Session has no sets to complete", 400) };
      }

      const exercisedRows = new Map<number, CompletionSetRow>();

      for (const row of rows) {
        const existing = exercisedRows.get(row.exercise_id);
        if (!existing || (row.set_number > existing.set_number && row.actual_reps !== null)) {
          exercisedRows.set(row.exercise_id, row);
        } else if (existing && existing.actual_reps === null && row.actual_reps !== null) {
          exercisedRows.set(row.exercise_id, row);
        }
      }

      const missingAutoProgressionReps = Array.from(exercisedRows.values()).some(
        (row) => row.auto_progression_enabled && row.actual_reps === null,
      );
      if (missingAutoProgressionReps) {
        return { response: jsonError("Log AMRAP reps before completing this workout", 400) };
      }

      for (const row of exercisedRows.values()) {
        if (!row.auto_progression_enabled || row.actual_reps === null) {
          continue;
        }

        const delta = calculateTemplateTrainingMaxDelta({
          templateId: row.progression_type,
          actualReps: row.actual_reps,
          repOutTarget: row.rep_out_target,
          category: row.category,
          currentTrainingMax: row.training_max,
          userId: user.id,
        });
        const newTrainingMax = applyTmDelta(row.training_max, delta);

        db.prepare("UPDATE session_sets SET tm_delta_applied = ? WHERE id = ?").run(delta, row.set_id);
        if (program.run_id && row.shared_exercise_key) {
          db.prepare(
            `
              INSERT INTO program_run_expected_maxes (program_run_id, shared_exercise_key, expected_max)
              VALUES (?, ?, ?)
              ON CONFLICT(program_run_id, shared_exercise_key)
              DO UPDATE SET expected_max = excluded.expected_max, updated_at = datetime('now')
            `,
          ).run(program.run_id, row.shared_exercise_key, newTrainingMax);
        }
      }

      db.prepare("UPDATE sessions SET completed = 1, completed_at = datetime('now') WHERE id = ?").run(sessionId);
      if (shouldAdvance) {
        db.prepare("UPDATE programs SET current_week = ?, current_day = ? WHERE id = ?").run(
          next.currentWeek,
          next.currentDay,
          programId,
        );
      }
      if (shouldAdvance && program.run_id) {
        db.prepare("UPDATE program_runs SET current_week = ?, current_day = ? WHERE id = ?").run(
          next.currentWeek,
          next.currentDay,
          program.run_id,
        );
      }

      return {
        response: NextResponse.json({
          success: true,
          alreadyCompleted: false,
          ...next,
        }),
      };
    });

    return complete().response;
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to complete session", 500);
  }
}
