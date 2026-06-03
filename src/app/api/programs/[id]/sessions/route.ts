import { NextResponse } from "next/server";
import { assertSameOrigin, jsonError, isUnauthorized, numberParam } from "@/lib/api";
import { getSettingNumber, requireUser } from "@/lib/auth";
import { calculateWeight } from "@/lib/calculator";
import { todayLocalDateKey } from "@/lib/date-key";
import { db } from "@/lib/db";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type SessionCreateBody = {
  dayId?: unknown;
  definitionDayId?: unknown;
  weekNumber?: unknown;
  scheduledDate?: unknown;
};

type ResolvedDay = {
  legacy_day_id: number | null;
  definition_day_id: number;
  name: string;
  shared_day_key: string | null;
};

function parseOptionalWeekNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const weekNumber = Number(value);
  if (!Number.isInteger(weekNumber) || weekNumber <= 0) {
    throw new Error("weekNumber must be a positive integer");
  }
  return weekNumber;
}

function parseOptionalDateKey(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("scheduledDate must be YYYY-MM-DD");
  }
  return value;
}

function getSessionWithSets(sessionId: number) {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as Record<string, unknown>;
  const sets = db
    .prepare(
      `SELECT
         ss.*
       FROM session_sets ss
       WHERE ss.session_id = ?
       ORDER BY ss.program_definition_exercise_id, ss.set_number, ss.id`,
    )
    .all(sessionId);

  return { ...session, sets };
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const programId = numberParam(id);
    const program = db
      .prepare("SELECT id FROM programs WHERE id = ? AND user_id = ? AND archived_at IS NULL")
      .get(programId, user.id);
    if (!program) return jsonError("Program not found", 404);

    const sessions = db
      .prepare(
        `SELECT
           s.*,
           COALESCE(NULLIF(s.day_name, ''), pdd.name, d.name, '') AS day_name
         FROM sessions s
         LEFT JOIN days d ON d.id = s.day_id
         LEFT JOIN program_definition_days pdd ON pdd.id = s.program_definition_day_id
         WHERE s.program_id = ? AND s.user_id = ?
         ORDER BY s.date DESC, s.id DESC`,
      )
      .all(programId, user.id);

    return NextResponse.json(sessions);
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to fetch sessions", 500);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const programId = numberParam(id);
    const body = (await request.json()) as SessionCreateBody;
    const dayId = Number(body.dayId);
    const definitionDayId = Number(body.definitionDayId);

    if (
      (!Number.isInteger(dayId) || dayId <= 0) &&
      (!Number.isInteger(definitionDayId) || definitionDayId <= 0)
    ) {
      return jsonError("dayId is required", 400);
    }

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
      .get(programId, user.id) as
      | {
          current_week: number;
          program_definition_id: number | null;
          program_run_id: number | null;
          name: string;
        }
      | undefined;
    if (!program) return jsonError("Program not found", 404);

    if (!program.program_definition_id || !program.program_run_id) {
      return jsonError("Program is missing definition/run context", 400);
    }

    let selectedWeekNumber: number;
    let scheduledDate: string | null;
    try {
      selectedWeekNumber = parseOptionalWeekNumber(body.weekNumber, program.current_week);
      scheduledDate = parseOptionalDateKey(body.scheduledDate);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Invalid calendar workout", 400);
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
    if (!day) return jsonError("Day not found", 404);
    if (!day.shared_day_key) return jsonError("Day is missing definition context", 400);

    const today = todayLocalDateKey();
    const existing = db
      .prepare(
        `SELECT * FROM sessions
         WHERE program_id = ?
           AND user_id = ?
           AND week_number = ?
           AND date = ?
           AND (
             program_definition_day_id = ?
             OR (program_definition_day_id IS NULL AND day_id = ?)
           )`,
      )
      .get(programId, user.id, selectedWeekNumber, today, day.definition_day_id, day.legacy_day_id);
    if (existing && typeof existing === "object" && "id" in existing) {
      return NextResponse.json(getSessionWithSets(Number(existing.id)));
    }

    const create = db.transaction(() => {
      const weekSettings = db
        .prepare(
          `
            SELECT
              pdws.id AS week_setting_id,
              ws.id AS legacy_week_setting_id,
              pde.id AS exercise_id,
              pde.stable_key,
              pde.name AS exercise_name,
              pde.category,
              pde.progression_type,
              pde.superset_group,
              pde.sort_order,
              pdws.week_number,
              pdws.set_number,
              pdws.intensity_pct,
              pdws.reps,
              pdws.sets,
              pdws.rep_out_target,
              COALESCE(prx.expected_max, 100) AS training_max
            FROM program_definition_days pdd
            JOIN program_definition_exercises pde
              ON pde.program_definition_day_id = pdd.id
             AND pde.archived_at IS NULL
            JOIN program_definition_week_settings pdws
              ON pdws.program_definition_exercise_id = pde.id
             AND pdws.week_number = ?
            LEFT JOIN program_run_expected_maxes prx
              ON prx.program_run_id = ?
             AND prx.shared_exercise_key = pde.stable_key
            LEFT JOIN exercises e
              ON e.day_id = ?
             AND e.shared_exercise_key = pde.stable_key
             AND e.archived_at IS NULL
            LEFT JOIN week_settings ws
              ON ws.exercise_id = e.id
             AND ws.week_number = pdws.week_number
             AND ws.set_number = pdws.set_number
            WHERE pdd.program_definition_id = ?
              AND pdd.stable_key = ?
              AND pdd.archived_at IS NULL
            ORDER BY pde.sort_order, pde.id, pdws.set_number
          `,
        )
        .all(
          selectedWeekNumber,
          program.program_run_id,
          day.legacy_day_id ?? -1,
          program.program_definition_id,
          day.shared_day_key,
        ) as {
        week_setting_id: number;
        legacy_week_setting_id: number | null;
        exercise_id: number;
        stable_key: string | null;
        exercise_name: string;
        category: string;
        progression_type: string;
        superset_group: string | null;
        week_number: number;
        set_number: number;
        intensity_pct: number;
        reps: number;
        sets: number;
        rep_out_target: number;
        training_max: number;
      }[];
      if (weekSettings.length === 0) {
        return null;
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
              scheduled_date,
              date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          selectedWeekNumber,
          scheduledDate,
          today,
        );
      const sessionId = Number(result.lastInsertRowid);
      const rounding = getSettingNumber(user.id, "rounding", 2.5);
      const insertSet = db.prepare(
        `
          INSERT INTO session_sets (
            session_id,
            week_setting_id,
            program_definition_week_setting_id,
            program_definition_exercise_id,
            shared_exercise_key,
            exercise_name,
            category,
            progression_type,
            superset_group,
            week_number,
            set_number,
            intensity_pct,
            reps,
            sets,
            rep_out_target,
            calculated_weight,
            training_max,
            auto_progression_enabled
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );

      for (const weekSetting of weekSettings) {
        insertSet.run(
          sessionId,
          weekSetting.legacy_week_setting_id,
          weekSetting.week_setting_id,
          weekSetting.exercise_id,
          weekSetting.stable_key,
          weekSetting.exercise_name,
          weekSetting.category,
          weekSetting.progression_type,
          weekSetting.superset_group,
          weekSetting.week_number,
          weekSetting.set_number,
          weekSetting.intensity_pct,
          weekSetting.reps,
          weekSetting.sets,
          weekSetting.rep_out_target,
          calculateWeight(weekSetting.training_max, weekSetting.intensity_pct, rounding),
          weekSetting.training_max,
          weekSetting.progression_type === "custom" ? 0 : 1,
        );
      }

      return getSessionWithSets(sessionId);
    });

    const session = create();
    if (!session) {
      return jsonError("Cannot start a workout without exercises for the current week", 400);
    }

    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to create session", 500);
  }
}
