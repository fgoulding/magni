import { isUnauthorized, jsonError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { epleyE1rm } from "@/features/programs/training-stats";

export const dynamic = "force-dynamic";

type ExportRow = {
  date: string;
  program: string;
  week: number;
  exercise: string;
  category: string;
  set_number: number;
  reps: number;
  weight: number;
};

const COLUMNS = ["date", "program", "week", "exercise", "category", "set", "reps", "weight", "e1rm"] as const;

/** RFC-4180 CSV field: quote when it contains a comma, quote, or newline. */
function csvField(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Export the signed-in user's logged training history as CSV — one row per
 * completed set. Self-hosted users should be able to take their data with them.
 */
export async function GET() {
  try {
    const user = await requireUser();

    const rows = db
      .prepare(
        `
          SELECT
            s.date AS date,
            COALESCE(p.name, '') AS program,
            ss.week_number AS week,
            ss.exercise_name AS exercise,
            ss.category AS category,
            ss.set_number AS set_number,
            COALESCE(ss.actual_reps, ss.reps) AS reps,
            COALESCE(ss.actual_weight, ss.calculated_weight, 0) AS weight
          FROM session_sets ss
          JOIN sessions s ON s.id = ss.session_id
          LEFT JOIN programs p ON p.id = s.program_id
          WHERE s.user_id = ? AND s.status = 'completed'
          ORDER BY s.date ASC, ss.exercise_name ASC, ss.set_number ASC
        `,
      )
      .all(user.id) as ExportRow[];

    const lines = [COLUMNS.join(",")];
    for (const row of rows) {
      const e1rm = Math.round(epleyE1rm(row.weight, row.reps));
      lines.push(
        [
          row.date,
          row.program,
          row.week,
          row.exercise,
          row.category,
          row.set_number,
          row.reps,
          row.weight,
          e1rm,
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
