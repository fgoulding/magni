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

    const existing = findQuickWorkout(user.id, today);
    if (existing) {
      return NextResponse.json({ id: existing, sets: loadSets(existing) });
    }

    let id: number;
    try {
      const result = db
        .prepare(
          `INSERT INTO sessions (user_id, program_name, day_name, week_number, date)
           VALUES (?, 'Quick Workout', 'Quick Workout', 1, ?)`,
        )
        .run(user.id, today);
      id = Number(result.lastInsertRowid);
    } catch (error) {
      // Defense-in-depth: the partial unique index (one in-progress quick workout
      // per user/day) lost a race — return whoever won instead of erroring.
      if (isUniqueConstraint(error)) {
        const won = findQuickWorkout(user.id, today);
        if (won) return NextResponse.json({ id: won, sets: loadSets(won) });
      }
      throw error;
    }

    return NextResponse.json({ id, sets: loadSets(id) }, { status: 201 });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (error instanceof Error && error.message === "Forbidden cross-origin request") {
      return jsonError(error.message, 403);
    }
    return jsonError("Could not start quick workout", 500);
  }
}

/** Newest in-progress program-less session for the user on `date`, if any. */
function findQuickWorkout(userId: number, date: string): number | null {
  const row = db
    .prepare(
      `SELECT id FROM sessions
       WHERE user_id = ? AND program_id IS NULL AND status = 'in_progress' AND date = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(userId, date) as { id: number } | undefined;
  return row?.id ?? null;
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
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
