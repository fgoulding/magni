import { NextResponse } from "next/server";
import { assertSameOrigin, clampText, jsonError, isUnauthorized, numberParam } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { todayLocalDateKey } from "@/lib/date-key";
import { db } from "@/lib/db";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type SkipWorkoutBody = {
  dayId?: unknown;
  definitionDayId?: unknown;
  reason?: unknown;
};

type ProgramRow = {
  id: number;
  current_week: number;
  program_definition_id: number | null;
  program_run_id: number | null;
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
    const body = (await request.json()) as SkipWorkoutBody;
    const dayId = Number(body.dayId);
    const definitionDayId = Number(body.definitionDayId);
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

      const today = todayLocalDateKey();
      const existing = getSkippedSession({
        programId,
        userId: user.id,
        dayId: day.legacy_day_id,
        definitionDayId: day.definition_day_id,
        weekNumber: program.current_week,
        date: today,
      });

      if (existing) {
        if (existing.status === "skipped") {
          return { response: NextResponse.json(existing) };
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
              skip_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'skipped', datetime('now'), ?)
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
          program.current_week,
          today,
          reason,
        );
      const session = getSessionById(Number(result.lastInsertRowid));

      return { response: NextResponse.json(session, { status: 201 }) };
    });

    return skip().response;
  } catch (error) {
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
