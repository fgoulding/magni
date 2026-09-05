import { ensureScheduledOccurrences, getOccurrence, syncOccurrencePosition } from "@/features/programs/occurrences";
import { NextResponse } from "next/server";
import { assertSameOrigin, clampText, isBadRequest, jsonError, isUnauthorized, numberParam, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { userDateKey } from "@/lib/user-date";
import { db } from "@/lib/db";
import { applyEditorCompletion } from "@/features/program-editor/execution";
import { EditorRepositoryError } from "@/features/program-editor/repository";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type SkipWorkoutBody = {
  occurrenceId?: unknown;
  dayId?: unknown;
  definitionDayId?: unknown;
  reason?: unknown;
};

type ProgramRow = {
  id: number;
  current_week: number;
  program_definition_id: number | null;
  program_run_id: number | null;
  editor_version_id: number | null;
  name: string;
};

type SessionRow = {
  id: number;
  status: string;
};

type ResolvedDay = {
  legacy_day_id: number | null;
  definition_day_id: number;
  name: string;
  shared_day_key: string | null;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const programId = numberParam(id);
    const body = await readJson<SkipWorkoutBody>(request);
    ensureScheduledOccurrences.immediate(user.id);
    const occurrence = body.occurrenceId != null ? getOccurrence(user.id, Number(body.occurrenceId)) : undefined;
    if (body.occurrenceId != null && (!occurrence || occurrence.program_id !== programId)) return jsonError("Workout not found", 404);
    const dayId = occurrence?.legacy_day_id ?? Number(body.dayId);
    const definitionDayId = occurrence?.definition_day_id ?? Number(body.definitionDayId);
    const reason = clampText(body.reason, 1000).trim();

    if (!Number.isInteger(programId) || programId <= 0) {
      return jsonError("Program not found", 404);
    }

    if (
      (!Number.isInteger(dayId) || dayId <= 0) &&
      (!Number.isInteger(definitionDayId) || definitionDayId <= 0)
    ) {
      return jsonError("dayId is required", 400);
    }

    const skip = db.transaction(() => {
      const program = db
        .prepare(
          `
            SELECT
              p.id,
              COALESCE(pr.current_week, p.current_week) AS current_week,
              p.program_definition_id,
              p.program_run_id,
              pr.editor_version_id,
              COALESCE(pr.name, p.name) AS name
            FROM programs p
            LEFT JOIN program_runs pr ON pr.id = p.program_run_id
            WHERE p.id = ?
              AND p.user_id = ?
              AND COALESCE(pr.archived_at, p.archived_at) IS NULL
              AND COALESCE(pr.status, 'active') != 'archived'
          `,
        )
        .get(programId, user.id) as ProgramRow | undefined;
      if (!program) {
        return { response: jsonError("Program not found", 404) };
      }
      if (program.editor_version_id && !occurrence) return { response: jsonError("Choose a scheduled workout occurrence to skip this editor program", 400) };

      if (!program.program_definition_id) {
        return { response: jsonError("Program is missing definition/run context", 400) };
      }

      const day = Number.isInteger(definitionDayId) && definitionDayId > 0
        ? (db
            .prepare(
              `
                SELECT
                  d.id AS legacy_day_id,
                  pdd.id AS definition_day_id,
                  pdd.name,
                  pdd.stable_key AS shared_day_key
                FROM program_definition_days pdd
                LEFT JOIN days d
                  ON d.program_id = ?
                 AND d.shared_day_key = pdd.stable_key
                 AND d.archived_at IS NULL
                WHERE pdd.id = ?
                  AND pdd.program_definition_id = ?
                  AND pdd.archived_at IS NULL
              `,
            )
            .get(programId, definitionDayId, program.program_definition_id) as ResolvedDay | undefined)
        : (db
            .prepare(
              `
                SELECT
                  d.id AS legacy_day_id,
                  pdd.id AS definition_day_id,
                  COALESCE(pdd.name, d.name) AS name,
                  d.shared_day_key
                FROM days d
                JOIN program_definition_days pdd
                  ON pdd.program_definition_id = ?
                 AND pdd.stable_key = d.shared_day_key
                 AND pdd.archived_at IS NULL
                WHERE d.id = ?
                  AND d.program_id = ?
                  AND d.archived_at IS NULL
              `,
            )
            .get(program.program_definition_id, dayId, programId) as ResolvedDay | undefined);
      if (!day) {
        return { response: jsonError("Day not found", 404) };
      }

      const today = userDateKey(user.id);
      const existing = occurrence ? db.prepare("SELECT * FROM sessions WHERE occurrence_id = ? AND user_id = ?").get(occurrence.id, user.id) as SessionRow | undefined : getSkippedSession({
        programId,
        userId: user.id,
        dayId: day.legacy_day_id,
        definitionDayId: day.definition_day_id,
        weekNumber: program.current_week,
        date: today,
      });

      if (existing) {
        if (existing.status === "skipped") {
          const progressionDecisions = applyEditorCompletion({ userId: user.id, sessionId: existing.id });
          return { response: NextResponse.json({ ...existing, ...(progressionDecisions.length ? { progressionDecisions } : {}) }) };
        }

        return { response: jsonError("Workout already started for this day", 409) };
      }

      const result = db
        .prepare(
          `
            INSERT INTO sessions (
              program_id,
              user_id,
              day_id,
              program_definition_id,
              program_definition_day_id,
              program_run_id,
              program_name,
              day_name,
              week_number,
              date,
              status,
              skipped_at,
              skip_reason,
              scheduled_date,
              occurrence_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'skipped', datetime('now'), ?, ?, ?)
          `,
        )
        .run(
          programId,
          user.id,
          day.legacy_day_id,
          program.program_definition_id,
          day.definition_day_id,
          program.program_run_id,
          program.name,
          day.name,
          occurrence?.week_number ?? program.current_week,
          today,
          reason,
          occurrence?.scheduled_date ?? null,
          occurrence?.id ?? null,
        );
      const session = getSessionById(Number(result.lastInsertRowid));
      const progressionDecisions = applyEditorCompletion({ userId: user.id, sessionId: session.id });
      if (occurrence) syncOccurrencePosition(user.id, programId);

      return { response: NextResponse.json({ ...session, ...(progressionDecisions.length ? { progressionDecisions } : {}) }, { status: 201 }) };
    });

    return skip.immediate().response;
  } catch (error) {
    if (error instanceof EditorRepositoryError) return jsonError(error.message, error.status);
    if (isBadRequest(error)) return jsonError(error.message, 400);
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (error instanceof Error && error.message === "Forbidden cross-origin request") {
      return jsonError(error.message, 403);
    }
    return jsonError("Failed to skip workout", 500);
  }
}

function getSkippedSession({
  programId,
  userId,
  dayId,
  definitionDayId,
  weekNumber,
  date,
}: {
  programId: number;
  userId: number;
  dayId: number | null;
  definitionDayId: number;
  weekNumber: number;
  date: string;
}): SessionRow | undefined {
  return db
    .prepare(
      `
        SELECT *
        FROM sessions
        WHERE program_id = ?
          AND user_id = ?
          AND week_number = ?
          AND date = ?
          AND (
            program_definition_day_id = ?
            OR (program_definition_day_id IS NULL AND day_id = ?)
          )
      `,
    )
    .get(programId, userId, weekNumber, date, definitionDayId, dayId) as SessionRow | undefined;
}

function getSessionById(sessionId: number): SessionRow {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;

  if (!session) {
    throw new Error("Skipped session was not created");
  }

  return session;
}
