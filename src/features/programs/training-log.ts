import { db } from "@/lib/db";

export type UserTrainingHistoryRow = Readonly<{
  id: number;
  date: string;
  status: "completed" | "skipped";
  program_name: string;
  day_name: string;
  week_number: number;
  set_count: number;
  total_reps: number;
  tonnage: number;
}>;

export function getUserTrainingHistory(
  userId: number,
  { limit = 100 }: { limit?: number } = {},
): UserTrainingHistoryRow[] {
  return db
    .prepare(
      `
        SELECT
          s.id,
          s.date,
          s.status,
          COALESCE(NULLIF(s.program_name, ''), p.name, '') AS program_name,
          COALESCE(NULLIF(s.day_name, ''), d.name, '') AS day_name,
          s.week_number,
          COUNT(ss.id) AS set_count,
          COALESCE(SUM(COALESCE(ss.actual_reps, 0)), 0) AS total_reps,
          COALESCE(SUM(COALESCE(ss.actual_reps, 0) * COALESCE(ss.actual_weight, ss.calculated_weight, 0)), 0) AS tonnage
        FROM sessions s
        LEFT JOIN session_sets ss ON ss.session_id = s.id
        LEFT JOIN programs p ON p.id = s.program_id
        LEFT JOIN days d ON d.id = s.day_id
        WHERE s.user_id = ?
          AND s.status IN ('completed', 'skipped')
        GROUP BY s.id
        ORDER BY s.date DESC, s.id DESC
        LIMIT ?
      `,
    )
    .all(userId, limit) as UserTrainingHistoryRow[];
}

export type LatestTrainingMax = Readonly<{ name: string; trainingMax: number }>;

/**
 * Latest training max per exercise name across all of a user's runs. Lifts are
 * matched across programs by name (the per-exercise stable key is randomized per
 * program), so variant/renamed lifts are tracked separately. Powers the Training
 * Maxes view and the carry-over of maxes into a newly created program.
 */
export function getLatestTrainingMaxes(userId: number): LatestTrainingMax[] {
  return db
    .prepare(
      `
        SELECT name, training_max AS trainingMax
        FROM (
          SELECT
            pde.name AS name,
            prx.expected_max AS training_max,
            ROW_NUMBER() OVER (
              PARTITION BY LOWER(TRIM(pde.name))
              ORDER BY prx.updated_at DESC, prx.program_run_id DESC
            ) AS rn
          FROM program_run_expected_maxes prx
          JOIN program_runs pr ON pr.id = prx.program_run_id
          JOIN program_definition_exercises pde ON pde.stable_key = prx.shared_exercise_key
          WHERE pr.user_id = ? AND pde.archived_at IS NULL
        )
        WHERE rn = 1
        ORDER BY name COLLATE NOCASE
      `,
    )
    .all(userId) as LatestTrainingMax[];
}
