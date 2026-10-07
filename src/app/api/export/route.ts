import { isUnauthorized, jsonError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { epleyE1rm } from "@/features/programs/training-stats";

export const dynamic = "force-dynamic";

type ExportRow = {
  session_id: number;
  set_id: number;
  date: string;
  program: string;
  workout: string;
  unit: string;
  week: number;
  exercise: string;
  category: string;
  set_number: number;
  set_count: number;
  actual_reps: number | null;
  actual_weight: number | null;
  prescribed_reps: number;
  prescribed_weight: number | null;
};

const COLUMNS = ["date", "program", "workout", "week", "exercise", "category", "set", "set_count", "unit", "actual_reps", "actual_weight", "e1rm", "is_recorded", "prescribed_reps", "prescribed_weight", "session_id", "set_id"] as const;

/** RFC-4180 CSV field: quote when it contains a comma, quote, or newline. */
function csvField(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * One row per stored set in the user's completed workouts. Missing actuals
 * stay blank; prescriptions and legacy set multiplicity remain explicit.
 */
export async function GET() {
  try {
    const user = await requireUser();

    const rows = db
      .prepare(
        `
          SELECT
            s.id AS session_id,
            ss.id AS set_id,
            s.date AS date,
            s.program_name AS program,
            s.day_name AS workout,
            s.unit AS unit,
            ss.week_number AS week,
            ss.exercise_name AS exercise,
            ss.category AS category,
            ss.set_number AS set_number,
            ss.sets AS set_count,
            ss.actual_reps,
            ss.actual_weight,
            ss.reps AS prescribed_reps,
            ss.calculated_weight AS prescribed_weight
          FROM session_sets ss
          JOIN sessions s ON s.id = ss.session_id
          WHERE s.user_id = ? AND s.status = 'completed'
          ORDER BY s.date ASC, s.id ASC, ss.sort_order ASC, ss.id ASC
        `,
      )
      .all(user.id) as ExportRow[];

    const lines = [COLUMNS.join(",")];
    for (const row of rows) {
      const e1rm = row.actual_weight !== null && row.actual_weight > 0 && row.actual_reps !== null && row.actual_reps > 0
        ? Math.round(epleyE1rm(row.actual_weight, row.actual_reps)) : null;
      lines.push(
        [
          row.date,
          row.program,
          row.workout,
          row.week,
          row.exercise,
          row.category,
          row.set_number,
          row.set_count,
          row.unit,
          row.actual_reps,
          row.actual_weight,
          e1rm,
          row.actual_reps === null ? 0 : 1,
          row.prescribed_reps,
          row.prescribed_weight,
          row.session_id,
          row.set_id,
        ]
          .map(csvField)
          .join(","),
      );
    }

    const csv = `${lines.join("\n")}\n`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="magni-history.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to export history", 500);
  }
}
