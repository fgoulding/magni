import { NextResponse } from "next/server";
import { isUnauthorized, jsonError, numberParam } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Resume support: return the in-progress session for a given day + week (with its
 * sets, including any already-logged actual_reps) so the workout card can restore
 * state when you navigate back. Read-only — never creates a session.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const programId = numberParam(id);

    const url = new URL(request.url);
    const dayId = Number(url.searchParams.get("dayId"));
    const definitionDayId = Number(url.searchParams.get("definitionDayId"));
    const week = Number(url.searchParams.get("week"));

    const program = db
      .prepare("SELECT id FROM programs WHERE id = ? AND user_id = ? AND archived_at IS NULL")
      .get(programId, user.id);
    if (!program) return jsonError("Program not found", 404);

    const session = db
      .prepare(
        `
          SELECT * FROM sessions
          WHERE program_id = ?
            AND user_id = ?
            AND completed = 0
            AND status = 'in_progress'
            ${Number.isInteger(week) && week > 0 ? "AND week_number = ?" : ""}
            AND (
              (program_definition_day_id IS NOT NULL AND program_definition_day_id = ?)
              OR (program_definition_day_id IS NULL AND day_id = ?)
            )
          ORDER BY date DESC, id DESC
          LIMIT 1
        `,
      )
      .get(
        ...(Number.isInteger(week) && week > 0
          ? [programId, user.id, week, definitionDayId, dayId]
          : [programId, user.id, definitionDayId, dayId]),
      ) as Record<string, unknown> | undefined;

    if (!session) return NextResponse.json(null);

    const sets = db
      .prepare(
        `SELECT ss.* FROM session_sets ss
         WHERE ss.session_id = ?
         ORDER BY ss.program_definition_exercise_id, ss.set_number, ss.id`,
      )
      .all(Number(session.id));

    return NextResponse.json({ ...session, sets });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to load workout", 500);
  }
}
