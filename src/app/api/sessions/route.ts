import { NextResponse } from "next/server";
import { assertSameOrigin, jsonError, isUnauthorized } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { todayLocalDateKey } from "@/lib/date-key";

/** Start a Quick Workout: a program-less session for today that the user fills
 *  with ad-hoc exercises on the fly. program_* stay NULL so it never shows up as
 *  a program; the after-insert context trigger keeps the names we pass because
 *  the `programs.id = NULL` lookups resolve to NULL. Idempotent per day — a
 *  second start returns the existing in-progress quick session. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const today = todayLocalDateKey();

    const existing = db
      .prepare(
        `SELECT id FROM sessions
         WHERE user_id = ? AND program_id IS NULL AND status = 'in_progress' AND date = ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(user.id, today) as { id: number } | undefined;
    if (existing) {
      return NextResponse.json({ id: existing.id, sets: loadSets(existing.id) });
    }

    const result = db
      .prepare(
        `INSERT INTO sessions (user_id, program_name, day_name, week_number, date)
         VALUES (?, 'Quick Workout', 'Quick Workout', 1, ?)`,
      )
      .run(user.id, today);
    const id = Number(result.lastInsertRowid);

    return NextResponse.json({ id, sets: loadSets(id) }, { status: 201 });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (error instanceof Error && error.message === "Forbidden cross-origin request") {
      return jsonError(error.message, 403);
    }
    return jsonError("Could not start quick workout", 500);
  }
}

/** Session sets in the SessionResponse shape WorkoutCard/QuickWorkout expect. */
function loadSets(sessionId: number) {
  return db
    .prepare(
      `SELECT id, exercise_name, reps, sets, set_number, rep_out_target, calculated_weight,
              actual_reps, actual_weight, superset_group, training_max, intensity_pct, progression_type
       FROM session_sets WHERE session_id = ? ORDER BY id`,
    )
    .all(sessionId);
}

export async function GET() {
  try {
    const user = await requireUser();
    const sessions = db
      .prepare(
        `SELECT
           s.*,
           COALESCE(NULLIF(s.program_name, ''), p.name, '') AS program_name,
           COALESCE(NULLIF(s.day_name, ''), d.name, '') AS day_name
         FROM sessions s
         LEFT JOIN programs p ON p.id = s.program_id
         LEFT JOIN days d ON d.id = s.day_id
         WHERE s.user_id = ?
         ORDER BY s.date DESC, s.id DESC
         LIMIT 100`,
      )
      .all(user.id);

    return NextResponse.json(sessions);
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to fetch sessions", 500);
  }
}
