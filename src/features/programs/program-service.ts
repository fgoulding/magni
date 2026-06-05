import crypto from "node:crypto";
import { getTemplateWeeks, getTrainingTemplate } from "@/features/training-templates/registry";
import type { ExerciseCategory, TemplateWeek } from "@/features/training-templates/types";
import { getSettingNumber } from "@/lib/auth";
import { calculateWeight } from "@/lib/calculator";
import { toLocalDateKey } from "@/lib/date-key";
import { db } from "@/lib/db";

export {
  getLatestTrainingMaxes,
  getUserTrainingHistory,
  type LatestTrainingMax,
  type UserTrainingHistoryRow,
} from "./training-log";

export type ProgramRunStatus = "active" | "paused" | "completed" | "archived";

export type CreatedProgramRun = Readonly<{
  legacyProgramId: number;
  definitionId: number;
  runId: number;
}>;

export type CreatedDefinitionDay = Readonly<{
  legacyDayId: number;
  definitionDayId: number;
  dayStableKey: string;
  dayNumber: number;
}>;

export type CreatedDefinitionExercise = Readonly<{
  legacyExerciseId: number;
  definitionExerciseId: number;
  exerciseStableKey: string;
}>;

// These detail types intentionally extend `Record<string, unknown>`: they are built
// by spreading raw `SELECT *` rows (which carry extra columns) alongside the named
// fields below. The named fields are what callers actually read.
export type ProgramDetail = Record<string, unknown> & {
  id: number;
  name: string;
  num_weeks: number;
  current_week: number;
  current_day: number;
  schedule_weekdays: string;
  is_active: number;
  active_hold_id: number | null;
  active_hold_start_date: string | null;
  active_hold_end_date: string | null;
  active_hold_reason: string | null;
  days: ProgramDetailDay[];
};

export type ProgramDetailDay = Record<string, unknown> & {
  id: number;
  name: string;
  day_number: number;
  sort_order: number;
  exercises: ProgramDetailExercise[];
};

export type ProgramDetailExercise = Record<string, unknown> & {
  id: number;
  name: string;
  training_max: number;
  category: string;
  progression_type: string;
  auto_progression_enabled: number;
  superset_group: string | null;
  weekSettings: Record<string, unknown>[];
};

export type ProgramDaySummary = Readonly<{
  program_id: number;
  program_run_id: number | null;
  program_name: string;
  current_week: number;
  current_day: number;
  schedule_weekdays: string;
  schedule_mode: string;
  schedule_start_date: string | null;
  num_weeks: number;
  day_id: number;
  legacy_day_id: number | null;
  definition_day_id: number;
  day_name: string;
  day_number: number;
  shared_day_key: string | null;
}>;

export type TodayLiftPreview = Readonly<{
  name: string;
  set_count: number;
  reps: number;
  weight: number;
}>;

export type TodayWorkoutSummary = ProgramDaySummary & Readonly<{
  schedule_label: string;
  scheduled_date?: string;
  last_session_date: string | null;
  today_session_id: number | null;
  today_session_status: "completed" | "skipped" | null;
  next_lifts: TodayLiftPreview[];
}>;

export type TodayWorkoutDashboard = Readonly<{
  missedWorkouts: TodayWorkoutSummary[];
  scheduledToday: TodayWorkoutSummary[];
  otherActiveRuns: TodayWorkoutSummary[];
}>;

export type ProgramLibraryItem = Readonly<{
  id: number;
  definition_id: number | null;
  run_id: number | null;
  name: string;
  num_weeks: number;
  current_week: number;
  current_day: number;
  schedule_weekdays: string;
  schedule_mode: string;
  last_session: string | null;
  is_active: number;
  source_type: string;
  visibility: string;
  day_count: number;
  lift_count: number;
  active_hold_id: number | null;
  active_hold_start_date: string | null;
  active_hold_end_date: string | null;
  active_hold_reason: string | null;
}>;

export type ProgramLibrary = Readonly<{
  activeRuns: ProgramLibraryItem[];
  definitions: ProgramLibraryItem[];
}>;

export type ProgramRunHold = Readonly<{
  id: number;
  program_run_id: number;
  user_id: number;
  start_date: string;
  end_date: string;
  reason: string;
  canceled_at: string | null;
}>;

type ProgramContext = Readonly<{
  legacyProgramId: number;
  definitionId: number;
  runId: number;
  userId: number;
  numWeeks: number;
}>;

type DayContext = Readonly<{
  legacyDayId: number;
  legacyProgramId: number;
  definitionDayId: number;
  definitionId: number;
  runId: number;
  userId: number;
  numWeeks: number;
}>;

const MISSED_WORKOUT_LOOKBACK_DAYS = 6;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}

function stableKey(prefix: string, name: string): string {
  return `${prefix}-${slugify(name)}-${crypto.randomBytes(4).toString("hex")}`;
}

function normalizeTemplateId(value: string | undefined): string {
  if (!value) return "custom";
  const templateId = value.trim().toLowerCase();
  return templateId === "" ? "custom" : templateId;
}

function assertProgramContext(legacyProgramId: number, userId: number): ProgramContext {
  const context = db
    .prepare(
      `
        SELECT
          p.id AS legacyProgramId,
          p.user_id AS userId,
          p.program_definition_id AS definitionId,
          p.program_run_id AS runId,
          pd.num_weeks AS numWeeks
        FROM programs p
        JOIN program_definitions pd ON pd.id = p.program_definition_id
        JOIN program_runs pr ON pr.id = p.program_run_id
        WHERE p.id = ?
          AND pr.user_id = ?
          AND pr.archived_at IS NULL
          AND pr.status != 'archived'
      `,
    )
    .get(legacyProgramId, userId) as ProgramContext | undefined;

  if (!context) {
    throw new Error("Program not found");
  }

  return context;
}

function assertDayContext(legacyDayId: number, userId: number): DayContext {
  const context = db
    .prepare(
      `
        SELECT
          d.id AS legacyDayId,
          p.id AS legacyProgramId,
          p.program_definition_id AS definitionId,
          p.program_run_id AS runId,
          p.user_id AS userId,
          pd.num_weeks AS numWeeks,
          pdd.id AS definitionDayId
        FROM days d
        JOIN programs p ON p.id = d.program_id
        JOIN program_definitions pd ON pd.id = p.program_definition_id
        JOIN program_runs pr ON pr.id = p.program_run_id
        JOIN program_definition_days pdd
          ON pdd.program_definition_id = pd.id
         AND pdd.stable_key = d.shared_day_key
         AND pdd.archived_at IS NULL
        WHERE d.id = ?
          AND d.archived_at IS NULL
          AND pr.user_id = ?
          AND pr.archived_at IS NULL
          AND pr.status != 'archived'
      `,
    )
    .get(legacyDayId, userId) as DayContext | undefined;

  if (!context) {
    throw new Error("Day not found");
  }

  return context;
}

function scheduleMode(scheduleWeekdays: readonly number[] | undefined): "scheduled" | "unscheduled" {
  return scheduleWeekdays && scheduleWeekdays.length > 0 ? "scheduled" : "unscheduled";
}

function assertDateKey(value: string, fieldName: string): void {
  if (!DATE_KEY_PATTERN.test(value) || Number.isNaN(new Date(`${value}T00:00:00`).getTime())) {
    throw new Error(`${fieldName} must be YYYY-MM-DD`);
  }
}

function normalizeHoldReason(value: string | undefined): string {
  return (value ?? "").trim().slice(0, 240);
}

function mapProgramRunHold(row: {
  id: number;
  program_run_id: number;
  user_id: number;
  start_date: string;
  end_date: string;
  reason: string;
  canceled_at: string | null;
}): ProgramRunHold {
  return {
    id: row.id,
    program_run_id: row.program_run_id,
    user_id: row.user_id,
    start_date: row.start_date,
    end_date: row.end_date,
    reason: row.reason,
    canceled_at: row.canceled_at,
  };
}

export function isDateHeldForRun(
  holds: readonly ProgramRunHold[],
  programRunId: number | null | undefined,
  dateKey: string,
): boolean {
  if (!programRunId) return false;
  return holds.some(
    (hold) =>
      hold.program_run_id === programRunId &&
      hold.canceled_at === null &&
      hold.start_date <= dateKey &&
      hold.end_date >= dateKey,
  );
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function parseScheduleWeekdays(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6);
  } catch {
    return [];
  }
}

function syncScheduleDays(runId: number, scheduleWeekdays: readonly number[] | undefined): void {
  if (!scheduleWeekdays) return;
  db.prepare("DELETE FROM program_run_schedule_days WHERE program_run_id = ?").run(runId);
  const insert = db.prepare(
    "INSERT INTO program_run_schedule_days (program_run_id, weekday, definition_day_number) VALUES (?, ?, ?)",
  );
  scheduleWeekdays.forEach((weekday, index) => {
    insert.run(runId, weekday, index + 1);
  });
}

function templateWeekFor(weeks: readonly TemplateWeek[], week: number): TemplateWeek {
  return weeks.length > 0
    ? weeks[(week - 1) % weeks.length]
    : { weekNumber: 1, intensityPct: 0.7, reps: 5, sets: 5, repOutTarget: 10 };
}

export function getProgramDetailForUser(legacyProgramId: number, userId: number): ProgramDetail | null {
  const program = db
    .prepare(
      `
        SELECT
          p.*,
          p.program_definition_id,
          p.program_run_id,
          COALESCE(pr.name, p.name) AS name,
          COALESCE(pd.description, p.description) AS description,
          COALESCE(pd.num_weeks, p.num_weeks) AS num_weeks,
          COALESCE(pr.current_week, p.current_week) AS current_week,
          COALESCE(pr.current_day, p.current_day) AS current_day,
          COALESCE(pr.schedule_weekdays, p.schedule_weekdays) AS schedule_weekdays,
          COALESCE(pr.schedule_mode, p.schedule_mode) AS schedule_mode,
          hold.id AS active_hold_id,
          hold.start_date AS active_hold_start_date,
          hold.end_date AS active_hold_end_date,
          hold.reason AS active_hold_reason,
          CASE
            WHEN pr.status IS NULL THEN p.is_active
            WHEN pr.status = 'active' THEN 1
            ELSE 0
          END AS is_active
        FROM programs p
        LEFT JOIN program_definitions pd ON pd.id = p.program_definition_id
        LEFT JOIN program_runs pr ON pr.id = p.program_run_id
        LEFT JOIN program_run_holds hold
          ON hold.id = (
            SELECT prh.id
            FROM program_run_holds prh
            WHERE prh.program_run_id = pr.id
              AND prh.user_id = ?
              AND prh.canceled_at IS NULL
              AND prh.end_date >= date('now')
            ORDER BY prh.start_date, prh.id
            LIMIT 1
          )
        WHERE p.id = ?
          AND p.user_id = ?
          AND COALESCE(pr.archived_at, p.archived_at) IS NULL
          AND COALESCE(pr.status, 'active') != 'archived'
      `,
    )
    .get(userId, legacyProgramId, userId) as
    | (Record<string, unknown> & {
        id: number;
        program_definition_id: number | null;
        program_run_id: number | null;
        name: string;
        num_weeks: number;
        current_week: number;
        current_day: number;
        schedule_weekdays: string;
        is_active: number;
        active_hold_id: number | null;
        active_hold_start_date: string | null;
        active_hold_end_date: string | null;
        active_hold_reason: string | null;
      })
    | undefined;

  if (!program) return null;
  if (!program.program_definition_id || !program.program_run_id) {
    return { ...program, days: [] } as ProgramDetail;
  }

  const rounding = getSettingNumber(userId, "rounding", 2.5);
  const days = db
    .prepare(
      `
        SELECT
          pdd.id AS definition_day_id,
          pdd.name,
          pdd.day_number,
          pdd.sort_order,
          pdd.stable_key,
          d.id AS legacy_day_id
        FROM program_definition_days pdd
        LEFT JOIN days d
          ON d.program_id = ?
         AND d.shared_day_key = pdd.stable_key
         AND d.archived_at IS NULL
        WHERE pdd.program_definition_id = ?
          AND pdd.archived_at IS NULL
        ORDER BY pdd.sort_order, pdd.day_number
      `,
    )
    .all(legacyProgramId, program.program_definition_id) as {
    definition_day_id: number;
    name: string;
    day_number: number;
    sort_order: number;
    stable_key: string | null;
    legacy_day_id: number | null;
  }[];

  return {
    ...program,
    days: days.map((day) => {
      const exercises = db
        .prepare(
          `
            SELECT
              pde.id AS definition_exercise_id,
              pde.name,
              pde.category,
              pde.progression_type,
              pde.sort_order,
              pde.stable_key,
              pde.superset_group,
              e.id AS legacy_exercise_id,
              e.auto_progression_enabled AS legacy_auto_progression_enabled,
              prx.expected_max
            FROM program_definition_exercises pde
            LEFT JOIN exercises e
              ON e.shared_exercise_key = pde.stable_key
             AND e.archived_at IS NULL
             AND e.day_id = ?
            LEFT JOIN program_run_expected_maxes prx
              ON prx.program_run_id = ?
             AND prx.shared_exercise_key = pde.stable_key
            WHERE pde.program_definition_day_id = ?
              AND pde.archived_at IS NULL
            ORDER BY pde.sort_order, pde.id
          `,
        )
        .all(day.legacy_day_id ?? -1, program.program_run_id, day.definition_day_id) as {
        definition_exercise_id: number;
        name: string;
        category: string;
        progression_type: string;
        sort_order: number;
        stable_key: string | null;
        superset_group: string | null;
        legacy_exercise_id: number | null;
        legacy_auto_progression_enabled: number | null;
        expected_max: number | null;
      }[];

      // A superset needs ≥2 members; a token left on a single exercise (e.g. its
      // partner was deleted) is meaningless, so don't surface it as a superset.
      const supersetCounts = new Map<string, number>();
      for (const ex of exercises) {
        if (ex.superset_group) supersetCounts.set(ex.superset_group, (supersetCounts.get(ex.superset_group) ?? 0) + 1);
      }

      return {
        id: day.legacy_day_id ?? day.definition_day_id,
        name: day.name,
        day_number: day.day_number,
        sort_order: day.sort_order,
        shared_day_key: day.stable_key,
        exercises: exercises.map((exercise) => {
          const trainingMax = exercise.expected_max ?? 100;
          const weekSettings = db
            .prepare(
              `
                SELECT
                  id,
                  program_definition_exercise_id AS exercise_id,
                  week_number,
                  set_number,
                  intensity_pct,
                  reps,
                  sets,
                  rep_out_target
                FROM program_definition_week_settings
                WHERE program_definition_exercise_id = ?
                ORDER BY week_number, set_number
              `,
            )
            .all(exercise.definition_exercise_id) as {
            id: number;
            exercise_id: number;
            week_number: number;
            set_number: number;
            intensity_pct: number;
            reps: number;
            sets: number;
            rep_out_target: number;
          }[];

          return {
            id: exercise.legacy_exercise_id ?? exercise.definition_exercise_id,
            name: exercise.name,
            training_max: trainingMax,
            category: exercise.category,
            progression_type: exercise.progression_type,
            auto_progression_enabled:
              exercise.legacy_auto_progression_enabled ?? (exercise.progression_type === "custom" ? 0 : 1),
            sort_order: exercise.sort_order,
            shared_exercise_key: exercise.stable_key,
            superset_group:
              exercise.superset_group && (supersetCounts.get(exercise.superset_group) ?? 0) >= 2
                ? exercise.superset_group
                : null,
            weekSettings: weekSettings.map((setting) => ({
              ...setting,
              calculated_weight: calculateWeight(trainingMax, setting.intensity_pct, rounding),
            })),
          };
        }),
      };
    }),
  } as ProgramDetail;
}

export function getActiveProgramDaysForUser(
  userId: number,
  { scheduledOnly = false }: { scheduledOnly?: boolean } = {},
): ProgramDaySummary[] {
  return db
    .prepare(
      `
        SELECT
          p.id AS program_id,
          p.program_run_id,
          COALESCE(pr.name, p.name) AS program_name,
          COALESCE(pr.current_week, p.current_week) AS current_week,
          COALESCE(pr.current_day, p.current_day) AS current_day,
          COALESCE(pr.schedule_weekdays, p.schedule_weekdays) AS schedule_weekdays,
          COALESCE(pr.schedule_mode, p.schedule_mode) AS schedule_mode,
          COALESCE(pr.start_date, substr(pr.created_at, 1, 10), substr(p.created_at, 1, 10)) AS schedule_start_date,
          COALESCE(pd.num_weeks, p.num_weeks) AS num_weeks,
          COALESCE(d.id, pdd.id) AS day_id,
          d.id AS legacy_day_id,
          pdd.id AS definition_day_id,
          pdd.name AS day_name,
          pdd.day_number,
          pdd.stable_key AS shared_day_key
        FROM programs p
        JOIN program_definitions pd ON pd.id = p.program_definition_id
        LEFT JOIN program_runs pr ON pr.id = p.program_run_id
        JOIN program_definition_days pdd
          ON pdd.program_definition_id = pd.id
         AND pdd.archived_at IS NULL
        LEFT JOIN days d
          ON d.program_id = p.id
         AND d.shared_day_key = pdd.stable_key
         AND d.archived_at IS NULL
        WHERE p.user_id = ?
          AND COALESCE(pr.archived_at, p.archived_at) IS NULL
          AND COALESCE(pr.status, CASE WHEN p.is_active = 1 THEN 'active' ELSE 'paused' END) = 'active'
          AND (? = 0 OR COALESCE(pr.schedule_mode, p.schedule_mode) = 'scheduled')
        ORDER BY p.created_at DESC, pdd.day_number
      `,
    )
    .all(userId, scheduledOnly ? 1 : 0) as ProgramDaySummary[];
}

function getLastSessionDate(userId: number, programId: number): string | null {
  const row = db
    .prepare(
      "SELECT MAX(date) AS value FROM sessions WHERE user_id = ? AND program_id = ? AND status IN ('completed', 'skipped')",
    )
    .get(userId, programId) as { value: string | null };
  return row.value;
}

function getLiftPreview(userId: number, row: ProgramDaySummary): TodayLiftPreview[] {
  const settings = db
    .prepare(
      `
        SELECT
          pde.id,
          pde.name,
          COALESCE(prx.expected_max, 100) AS training_max,
          MAX(pdws.reps) AS reps,
          MAX(pdws.intensity_pct) AS intensity_pct,
          COUNT(*) AS set_count
        FROM program_definition_exercises pde
        JOIN program_definition_week_settings pdws
          ON pdws.program_definition_exercise_id = pde.id
         AND pdws.week_number = ?
        LEFT JOIN programs p ON p.id = ?
        LEFT JOIN program_runs pr ON pr.id = p.program_run_id
        LEFT JOIN program_run_expected_maxes prx
          ON prx.program_run_id = pr.id
         AND prx.shared_exercise_key = pde.stable_key
        WHERE pde.program_definition_day_id = ?
          AND pde.archived_at IS NULL
        GROUP BY pde.id, pde.name, prx.expected_max
        ORDER BY pde.sort_order, pde.id
        LIMIT 3
      `,
    )
    .all(row.current_week, row.program_id, row.definition_day_id) as {
    name: string;
    training_max: number;
    reps: number;
    intensity_pct: number;
    set_count: number;
  }[];
  const rounding = getSettingNumber(userId, "rounding", 2.5);

  return settings.map((setting) => ({
    name: setting.name,
    set_count: setting.set_count,
    reps: setting.reps,
    weight: calculateWeight(setting.training_max, setting.intensity_pct, rounding),
  }));
}

function enrichTodayRow(
  userId: number,
  row: ProgramDaySummary,
  scheduleLabel: string,
  todayDateKey: string,
  scheduledDate?: string,
): TodayWorkoutSummary {
  const todaySession = getSessionForDate(userId, row, todayDateKey);

  return {
    ...row,
    schedule_label: scheduleLabel,
    scheduled_date: scheduledDate,
    last_session_date: getLastSessionDate(userId, row.program_id),
    today_session_id: todaySession?.id ?? null,
    today_session_status: todaySession?.status ?? null,
    next_lifts: getLiftPreview(userId, row),
  };
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function findScheduledDay(programRows: readonly ProgramDaySummary[], weekday: number): ProgramDaySummary | undefined {
  const firstRow = programRows[0];
  const scheduleIndex = parseScheduleWeekdays(firstRow.schedule_weekdays).indexOf(weekday);
  if (scheduleIndex === -1) return undefined;
  return programRows.find((row) => row.day_number === scheduleIndex + 1);
}

function hasLoggedWorkoutOnOrAfter(userId: number, row: ProgramDaySummary, scheduledDate: string): boolean {
  const existing = db
    .prepare(
      `
        SELECT 1
        FROM sessions
        WHERE user_id = ?
          AND week_number = ?
          AND date >= ?
          AND (program_run_id = ? OR program_id = ?)
          AND (
            program_definition_day_id = ?
            OR (program_definition_day_id IS NULL AND day_id = ?)
          )
        LIMIT 1
      `,
    )
    .get(
      userId,
      row.current_week,
      scheduledDate,
      row.program_run_id,
      row.program_id,
      row.definition_day_id,
      row.legacy_day_id,
    );

  return Boolean(existing);
}

function getSessionForDate(
  userId: number,
  row: ProgramDaySummary,
  dateKey: string,
): { id: number; status: "completed" | "skipped" } | null {
  return (
    (db
      .prepare(
        `
          SELECT id, status
          FROM sessions
          WHERE user_id = ?
            AND date = ?
            AND status IN ('completed', 'skipped')
            AND (program_run_id = ? OR program_id = ?)
            AND (
              program_definition_day_id = ?
              OR (program_definition_day_id IS NULL AND day_id = ?)
            )
          ORDER BY id DESC
          LIMIT 1
        `,
      )
      .get(
        userId,
        dateKey,
        row.program_run_id,
        row.program_id,
        row.definition_day_id,
        row.legacy_day_id,
      ) as { id: number; status: "completed" | "skipped" } | undefined) ?? null
  );
}

export function getProgramRunHoldsForRange({
  userId,
  startDate,
  endDate,
  programRunIds,
}: {
  userId: number;
  startDate: string;
  endDate: string;
  programRunIds?: readonly number[];
}): ProgramRunHold[] {
  assertDateKey(startDate, "startDate");
  assertDateKey(endDate, "endDate");
  if (startDate > endDate) {
    throw new Error("startDate must be before or equal to endDate");
  }
  if (programRunIds && programRunIds.length === 0) return [];

  const runFilter = programRunIds && programRunIds.length > 0
    ? `AND program_run_id IN (${programRunIds.map(() => "?").join(",")})`
    : "";
  const rows = db
    .prepare(
      `
        SELECT id, program_run_id, user_id, start_date, end_date, reason, canceled_at
        FROM program_run_holds
        WHERE user_id = ?
          AND canceled_at IS NULL
          AND start_date <= ?
          AND end_date >= ?
          ${runFilter}
        ORDER BY start_date, id
      `,
    )
    .all(userId, endDate, startDate, ...(programRunIds ?? [])) as {
    id: number;
    program_run_id: number;
    user_id: number;
    start_date: string;
    end_date: string;
    reason: string;
    canceled_at: string | null;
  }[];

  return rows.map(mapProgramRunHold);
}

export function getCurrentOrUpcomingProgramRunHold(userId: number, legacyProgramId: number, today = new Date()): ProgramRunHold | null {
  const context = assertProgramContext(legacyProgramId, userId);
  const todayKey = toLocalDateKey(today);
  const row = db
    .prepare(
      `
        SELECT id, program_run_id, user_id, start_date, end_date, reason, canceled_at
        FROM program_run_holds
        WHERE user_id = ?
          AND program_run_id = ?
          AND canceled_at IS NULL
          AND end_date >= ?
        ORDER BY start_date, id
        LIMIT 1
      `,
    )
    .get(userId, context.runId, todayKey) as
    | {
        id: number;
        program_run_id: number;
        user_id: number;
        start_date: string;
        end_date: string;
        reason: string;
        canceled_at: string | null;
      }
    | undefined;

  return row ? mapProgramRunHold(row) : null;
}

export const createProgramRunHold = db.transaction(
  ({
    userId,
    legacyProgramId,
    startDate,
    endDate,
    reason,
  }: {
    userId: number;
    legacyProgramId: number;
    startDate: string;
    endDate: string;
    reason?: string;
  }): ProgramRunHold => {
    assertDateKey(startDate, "startDate");
    assertDateKey(endDate, "endDate");
    if (startDate > endDate) {
      throw new Error("endDate must be on or after startDate");
    }
    const context = assertProgramContext(legacyProgramId, userId);
    const overlapping = db
      .prepare(
        `
          SELECT id
          FROM program_run_holds
          WHERE user_id = ?
            AND program_run_id = ?
            AND canceled_at IS NULL
            AND NOT (end_date < ? OR start_date > ?)
          LIMIT 1
        `,
      )
      .get(userId, context.runId, startDate, endDate);

    if (overlapping) {
      throw new Error("Hold overlaps an existing hold for this run");
    }

    const result = db
      .prepare(
        `
          INSERT INTO program_run_holds (program_run_id, user_id, start_date, end_date, reason)
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(context.runId, userId, startDate, endDate, normalizeHoldReason(reason));
    const row = db
      .prepare(
        "SELECT id, program_run_id, user_id, start_date, end_date, reason, canceled_at FROM program_run_holds WHERE id = ?",
      )
      .get(result.lastInsertRowid) as {
      id: number;
      program_run_id: number;
      user_id: number;
      start_date: string;
      end_date: string;
      reason: string;
      canceled_at: string | null;
    };

    return mapProgramRunHold(row);
  },
);

export const cancelActiveProgramRunHold = db.transaction(
  ({ userId, legacyProgramId, today = new Date() }: { userId: number; legacyProgramId: number; today?: Date }): boolean => {
    const context = assertProgramContext(legacyProgramId, userId);
    const todayKey = toLocalDateKey(today);
    const result = db
      .prepare(
        `
          UPDATE program_run_holds
          SET canceled_at = datetime('now')
          WHERE id = (
            SELECT id
            FROM program_run_holds
            WHERE user_id = ?
              AND program_run_id = ?
              AND canceled_at IS NULL
              AND end_date >= ?
            ORDER BY start_date, id
            LIMIT 1
          )
        `,
      )
      .run(userId, context.runId, todayKey);

    return result.changes > 0;
  },
);

export function getTodayWorkoutDashboard(userId: number, today = new Date()): TodayWorkoutDashboard {
  const rows = getActiveProgramDaysForUser(userId);
  const todayWeekday = today.getDay();
  const todayDateKey = toLocalDateKey(today);
  const rangeStart = toLocalDateKey(addDays(today, -MISSED_WORKOUT_LOOKBACK_DAYS));
  const holds = getProgramRunHoldsForRange({ userId, startDate: rangeStart, endDate: todayDateKey });
  const rowsByProgram = new Map<number, ProgramDaySummary[]>();
  for (const row of rows) {
    rowsByProgram.set(row.program_id, [...(rowsByProgram.get(row.program_id) ?? []), row]);
  }

  const missedWorkouts: TodayWorkoutSummary[] = [];
  const scheduledToday: TodayWorkoutSummary[] = [];
  const otherActiveRuns: TodayWorkoutSummary[] = [];

  for (const programRows of rowsByProgram.values()) {
    const firstRow = programRows[0];
    if (firstRow.schedule_mode === "scheduled") {
      const seenMissedDays = new Set<string>();
      const daysSinceMonday = (todayWeekday + 6) % 7;
      const missedLookbackDays = Math.min(MISSED_WORKOUT_LOOKBACK_DAYS, daysSinceMonday);
      for (let offset = 1; offset <= missedLookbackDays; offset += 1) {
        const missedDate = addDays(today, -offset);
        const missedDateKey = toLocalDateKey(missedDate);
        const missedDay = findScheduledDay(programRows, missedDate.getDay());
        const missedKey = missedDay ? `${missedDay.program_id}:${missedDay.definition_day_id}` : "";
        if (
          missedDay &&
          !seenMissedDays.has(missedKey) &&
          !isDateHeldForRun(holds, missedDay.program_run_id, missedDateKey) &&
          !hasLoggedWorkoutOnOrAfter(userId, missedDay, missedDateKey)
        ) {
          seenMissedDays.add(missedKey);
          missedWorkouts.push(
            enrichTodayRow(
              userId,
              missedDay,
              `Missed ${WEEKDAY_LABELS[missedDate.getDay()]}`,
              todayDateKey,
              missedDateKey,
            ),
          );
        }
      }

      const dayRow = findScheduledDay(programRows, todayWeekday);
      if (dayRow && !isDateHeldForRun(holds, dayRow.program_run_id, todayDateKey)) {
        scheduledToday.push(enrichTodayRow(userId, dayRow, WEEKDAY_LABELS[todayWeekday], todayDateKey));
      }
      continue;
    }

    const currentDay = programRows.find((row) => row.day_number === firstRow.current_day);
    if (currentDay) otherActiveRuns.push(enrichTodayRow(userId, currentDay, WEEKDAY_LABELS[todayWeekday], todayDateKey));
  }

  return { missedWorkouts, scheduledToday, otherActiveRuns };
}

export function getProgramLibrary(userId: number): ProgramLibrary {
  const rows = db
    .prepare(
      `
        SELECT
          p.id,
          p.program_definition_id AS definition_id,
          p.program_run_id AS run_id,
          COALESCE(pr.name, p.name) AS name,
          COALESCE(pd.num_weeks, p.num_weeks) AS num_weeks,
          COALESCE(pr.current_week, p.current_week) AS current_week,
          COALESCE(pr.current_day, p.current_day) AS current_day,
          COALESCE(pr.schedule_weekdays, p.schedule_weekdays) AS schedule_weekdays,
          COALESCE(pr.schedule_mode, p.schedule_mode) AS schedule_mode,
          CASE
            WHEN pr.status IS NULL THEN p.is_active
            WHEN pr.status = 'active' THEN 1
            ELSE 0
          END AS is_active,
          COALESCE(pd.source_type, 'custom') AS source_type,
          COALESCE(pd.visibility, 'private') AS visibility,
          (SELECT MAX(s.date) FROM sessions s WHERE s.user_id = ? AND (s.program_run_id = pr.id OR s.program_id = p.id)) AS last_session,
          (
            SELECT COUNT(*)
            FROM program_definition_days pdd
            WHERE pdd.program_definition_id = pd.id
              AND pdd.archived_at IS NULL
          ) AS day_count,
          (
            SELECT COUNT(*)
            FROM program_definition_exercises pde
            JOIN program_definition_days pdd ON pdd.id = pde.program_definition_day_id
            WHERE pdd.program_definition_id = pd.id
              AND pdd.archived_at IS NULL
              AND pde.archived_at IS NULL
          ) AS lift_count,
          hold.id AS active_hold_id,
          hold.start_date AS active_hold_start_date,
          hold.end_date AS active_hold_end_date,
          hold.reason AS active_hold_reason
        FROM programs p
        LEFT JOIN program_definitions pd ON pd.id = p.program_definition_id
        LEFT JOIN program_runs pr ON pr.id = p.program_run_id
        LEFT JOIN program_run_holds hold
          ON hold.id = (
            SELECT prh.id
            FROM program_run_holds prh
            WHERE prh.program_run_id = pr.id
              AND prh.user_id = ?
              AND prh.canceled_at IS NULL
              AND prh.end_date >= date('now')
            ORDER BY prh.start_date, prh.id
            LIMIT 1
          )
        WHERE p.user_id = ?
          AND COALESCE(pr.archived_at, p.archived_at) IS NULL
          AND COALESCE(pr.status, 'active') != 'archived'
        ORDER BY p.id DESC
      `,
    )
    .all(userId, userId, userId) as ProgramLibraryItem[];

  return {
    activeRuns: rows.filter((row) => row.is_active === 1),
    definitions: rows,
  };
}

export function getProgramRunOverview(userId: number, legacyProgramId: number): ProgramDetail | null {
  return getProgramDetailForUser(legacyProgramId, userId);
}

export const createProgramRun = db.transaction(
  ({
    userId,
    name,
    description = "",
    numWeeks,
    sourceType = "custom",
    visibility = "private",
    sharedProgramId = null,
    sharedProgramVersionId = null,
  }: {
    userId: number;
    name: string;
    description?: string;
    numWeeks: number;
    sourceType?: "custom" | "default" | "shared";
    visibility?: "private" | "shared";
    sharedProgramId?: number | null;
    sharedProgramVersionId?: number | null;
  }): CreatedProgramRun => {
    const definition = db
      .prepare(
        `
          INSERT INTO program_definitions (
            owner_user_id,
            name,
            description,
            num_weeks,
            source_type,
            visibility,
            shared_program_id,
            shared_program_version_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(userId, name, description, numWeeks, sourceType, visibility, sharedProgramId, sharedProgramVersionId);
    const definitionId = Number(definition.lastInsertRowid);
    const run = db
      .prepare("INSERT INTO program_runs (user_id, program_definition_id, name) VALUES (?, ?, ?)")
      .run(userId, definitionId, name);
    const runId = Number(run.lastInsertRowid);
    const legacy = db
      .prepare(
        `
          INSERT INTO programs (
            user_id,
            name,
            description,
            num_weeks,
            program_definition_id,
            program_run_id,
            shared_program_id,
            shared_program_version_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(userId, name, description, numWeeks, definitionId, runId, sharedProgramId, sharedProgramVersionId);

    return {
      legacyProgramId: Number(legacy.lastInsertRowid),
      definitionId,
      runId,
    };
  },
);

export const addDefinitionDayForRun = db.transaction(
  ({
    userId,
    legacyProgramId,
    name,
  }: {
    userId: number;
    legacyProgramId: number;
    name: string;
  }): CreatedDefinitionDay => {
    const context = assertProgramContext(legacyProgramId, userId);
    const nextDay = db
      .prepare(
        "SELECT COALESCE(MAX(day_number), 0) + 1 AS value FROM program_definition_days WHERE program_definition_id = ? AND archived_at IS NULL",
      )
      .get(context.definitionId) as { value: number };
    const nextSort = db
      .prepare(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 AS value FROM program_definition_days WHERE program_definition_id = ? AND archived_at IS NULL",
      )
      .get(context.definitionId) as { value: number };
    const dayStableKey = stableKey("day", name);
    const definitionDay = db
      .prepare(
        "INSERT INTO program_definition_days (program_definition_id, name, day_number, sort_order, stable_key) VALUES (?, ?, ?, ?, ?)",
      )
      .run(context.definitionId, name, nextDay.value, nextSort.value, dayStableKey);
    const definitionDayId = Number(definitionDay.lastInsertRowid);
    const legacyDay = db
      .prepare("INSERT INTO days (program_id, name, day_number, sort_order, shared_day_key) VALUES (?, ?, ?, ?, ?)")
      .run(legacyProgramId, name, nextDay.value, nextSort.value, dayStableKey);

    return {
      legacyDayId: Number(legacyDay.lastInsertRowid),
      definitionDayId,
      dayStableKey,
      dayNumber: nextDay.value,
    };
  },
);

export const addDefinitionExerciseForDay = db.transaction(
  ({
    userId,
    legacyDayId,
    name,
    trainingMax,
    category,
    progressionType,
    setCount,
    repCount,
  }: {
    userId: number;
    legacyDayId: number;
    name: string;
    trainingMax: number;
    category: ExerciseCategory;
    progressionType?: string;
    /** For manual templates (e.g. bodyweight): materialise N individual sets of repCount. */
    setCount?: number;
    repCount?: number;
  }): CreatedDefinitionExercise => {
    const context = assertDayContext(legacyDayId, userId);
    const templateId = normalizeTemplateId(progressionType);
    const template = getTrainingTemplate(templateId);
    if (!template.supportedCategories.includes(category)) {
      throw new Error(`${template.id} does not support ${category} exercises`);
    }

    const nextSort = db
      .prepare(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 AS value FROM program_definition_exercises WHERE program_definition_day_id = ? AND archived_at IS NULL",
      )
      .get(context.definitionDayId) as { value: number };
    const exerciseStableKey = stableKey("exercise", name);
    const definitionExercise = db
      .prepare(
        `
          INSERT INTO program_definition_exercises (
            program_definition_day_id,
            name,
            category,
            progression_type,
            sort_order,
            stable_key
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(context.definitionDayId, name, category, template.id, nextSort.value, exerciseStableKey);
    const definitionExerciseId = Number(definitionExercise.lastInsertRowid);
    const legacyExercise = db
      .prepare(
        `
          INSERT INTO exercises (
            day_id,
            name,
            training_max,
            category,
            progression_type,
            auto_progression_enabled,
            sort_order,
            shared_exercise_key
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        legacyDayId,
        name,
        trainingMax,
        category,
        template.id,
        template.autoProgression ? 1 : 0,
        nextSort.value,
        exerciseStableKey,
      );
    const legacyExerciseId = Number(legacyExercise.lastInsertRowid);

    db.prepare(
      `
        INSERT INTO program_run_expected_maxes (program_run_id, shared_exercise_key, expected_max)
        VALUES (?, ?, ?)
        ON CONFLICT(program_run_id, shared_exercise_key)
        DO UPDATE SET expected_max = excluded.expected_max, updated_at = datetime('now')
      `,
    ).run(context.runId, exerciseStableKey, trainingMax);

    const rounding = getSettingNumber(userId, "rounding", 2.5);
    const templateWeeks = getTemplateWeeks(template.id, category);
    const insertDefinitionWeek = db.prepare(
      `
        INSERT INTO program_definition_week_settings (
          program_definition_exercise_id,
          week_number,
          set_number,
          intensity_pct,
          reps,
          sets,
          rep_out_target
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    );
    const insertLegacyWeek = db.prepare(
      `
        INSERT INTO week_settings (
          exercise_id,
          week_number,
          set_number,
          intensity_pct,
          reps,
          sets,
          rep_out_target,
          calculated_weight
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    // A manual template (empty weeks) with explicit set/rep counts (bodyweight)
    // materialises as N individual sets so each is loggable.
    const manualSets =
      templateWeeks.length === 0 && setCount && setCount > 0
        ? Array.from({ length: Math.min(setCount, 20) }, (_, i) => ({
            setNumber: i + 1,
            intensityPct: 0,
            reps: repCount && repCount > 0 ? repCount : 10,
            sets: 1,
            repOutTarget: repCount && repCount > 0 ? repCount : 10,
          }))
        : null;

    for (let week = 1; week <= context.numWeeks; week++) {
      const templateWeek = templateWeekFor(templateWeeks, week);
      const sets =
        manualSets ??
        (templateWeek.ramp && templateWeek.ramp.length > 0
          ? templateWeek.ramp.map((rampSet) => ({
              setNumber: rampSet.setNumber,
              intensityPct: rampSet.intensityPct,
              reps: rampSet.reps,
              sets: 1,
              repOutTarget: rampSet.repOutTarget,
            }))
          : [
              {
                setNumber: 1,
                intensityPct: templateWeek.intensityPct,
                reps: templateWeek.reps,
                sets: templateWeek.sets,
                repOutTarget: templateWeek.repOutTarget,
              },
            ]);

      for (const set of sets) {
        insertDefinitionWeek.run(
          definitionExerciseId,
          week,
          set.setNumber,
          set.intensityPct,
          set.reps,
          set.sets,
          set.repOutTarget,
        );
        insertLegacyWeek.run(
          legacyExerciseId,
          week,
          set.setNumber,
          set.intensityPct,
          set.reps,
          set.sets,
          set.repOutTarget,
          calculateWeight(trainingMax, set.intensityPct, rounding),
        );
      }
    }

    return {
      legacyExerciseId,
      definitionExerciseId,
      exerciseStableKey,
    };
  },
);

/**
 * Change an existing exercise's category and/or progression after creation. This
 * re-materialises the exercise's week loading from the new template (logged
 * sessions live in session_sets and are untouched), keeping the same id, name,
 * training max, order, and superset grouping.
 */
export const updateDefinitionExerciseType = db.transaction(
  ({
    userId,
    legacyExerciseId,
    category,
    progressionType,
  }: {
    userId: number;
    legacyExerciseId: number;
    category: ExerciseCategory;
    progressionType: string;
  }): void => {
    const row = db
      .prepare(
        `
          SELECT
            e.training_max AS trainingMax,
            pd.num_weeks AS numWeeks,
            pde.id AS definitionExerciseId
          FROM exercises e
          JOIN days d ON d.id = e.day_id
          JOIN programs p ON p.id = d.program_id
          JOIN program_definitions pd ON pd.id = p.program_definition_id
          JOIN program_runs pr ON pr.id = p.program_run_id
          JOIN program_definition_days pdd
            ON pdd.program_definition_id = pd.id
           AND pdd.stable_key = d.shared_day_key
           AND pdd.archived_at IS NULL
          JOIN program_definition_exercises pde
            ON pde.program_definition_day_id = pdd.id
           AND pde.stable_key = e.shared_exercise_key
           AND pde.archived_at IS NULL
          WHERE e.id = ?
            AND e.archived_at IS NULL
            AND d.archived_at IS NULL
            AND pr.user_id = ?
            AND pr.archived_at IS NULL
            AND pr.status != 'archived'
        `,
      )
      .get(legacyExerciseId, userId) as
      | { trainingMax: number; numWeeks: number; definitionExerciseId: number }
      | undefined;
    if (!row) throw new Error("Exercise not found");

    const template = getTrainingTemplate(normalizeTemplateId(progressionType));
    if (!template.supportedCategories.includes(category)) {
      throw new Error(`${template.id} does not support ${category} exercises`);
    }

    const autoProgression = template.autoProgression ? 1 : 0;
    db.prepare(
      "UPDATE program_definition_exercises SET category = ?, progression_type = ? WHERE id = ?",
    ).run(category, template.id, row.definitionExerciseId);
    db.prepare(
      "UPDATE exercises SET category = ?, progression_type = ?, auto_progression_enabled = ? WHERE id = ?",
    ).run(category, template.id, autoProgression, legacyExerciseId);

    // Drop the old plan and rebuild it from the new template/category.
    db.prepare("DELETE FROM program_definition_week_settings WHERE program_definition_exercise_id = ?").run(
      row.definitionExerciseId,
    );
    db.prepare("DELETE FROM week_settings WHERE exercise_id = ?").run(legacyExerciseId);

    const rounding = getSettingNumber(userId, "rounding", 2.5);
    const templateWeeks = getTemplateWeeks(template.id, category);
    const insertDefinitionWeek = db.prepare(
      `
        INSERT INTO program_definition_week_settings (
          program_definition_exercise_id, week_number, set_number, intensity_pct, reps, sets, rep_out_target
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    );
    const insertLegacyWeek = db.prepare(
      `
        INSERT INTO week_settings (
          exercise_id, week_number, set_number, intensity_pct, reps, sets, rep_out_target, calculated_weight
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    for (let week = 1; week <= row.numWeeks; week++) {
      const templateWeek = templateWeekFor(templateWeeks, week);
      const sets =
        templateWeek.ramp && templateWeek.ramp.length > 0
          ? templateWeek.ramp.map((rampSet) => ({
              setNumber: rampSet.setNumber,
              intensityPct: rampSet.intensityPct,
              reps: rampSet.reps,
              sets: 1,
              repOutTarget: rampSet.repOutTarget,
            }))
          : [
              {
                setNumber: 1,
                intensityPct: templateWeek.intensityPct,
                reps: templateWeek.reps,
                sets: templateWeek.sets,
                repOutTarget: templateWeek.repOutTarget,
              },
            ];

      for (const set of sets) {
        insertDefinitionWeek.run(
          row.definitionExerciseId,
          week,
          set.setNumber,
          set.intensityPct,
          set.reps,
          set.sets,
          set.repOutTarget,
        );
        insertLegacyWeek.run(
          legacyExerciseId,
          week,
          set.setNumber,
          set.intensityPct,
          set.reps,
          set.sets,
          set.repOutTarget,
          calculateWeight(row.trainingMax, set.intensityPct, rounding),
        );
      }
    }
  },
);

export const updateProgramRun = db.transaction(
  ({
    userId,
    legacyProgramId,
    name,
    status,
    scheduleWeekdays,
    currentWeek,
    currentDay,
  }: {
    userId: number;
    legacyProgramId: number;
    name?: string;
    status?: ProgramRunStatus;
    scheduleWeekdays?: readonly number[];
    currentWeek?: number;
    currentDay?: number;
  }): void => {
    const context = assertProgramContext(legacyProgramId, userId);
    if (name !== undefined) {
      db.prepare("UPDATE program_runs SET name = ? WHERE id = ?").run(name, context.runId);
      db.prepare("UPDATE program_definitions SET name = ? WHERE id = ?").run(name, context.definitionId);
      db.prepare("UPDATE programs SET name = ? WHERE id = ?").run(name, legacyProgramId);
    }
    if (status !== undefined) {
      db.prepare("UPDATE program_runs SET status = ? WHERE id = ?").run(status, context.runId);
      db.prepare("UPDATE programs SET is_active = ? WHERE id = ?").run(status === "active" ? 1 : 0, legacyProgramId);
    }
    if (scheduleWeekdays !== undefined) {
      const scheduleJson = JSON.stringify([...scheduleWeekdays]);
      const mode = scheduleMode(scheduleWeekdays);
      db.prepare("UPDATE program_runs SET schedule_weekdays = ?, schedule_mode = ? WHERE id = ?").run(
        scheduleJson,
        mode,
        context.runId,
      );
      db.prepare("UPDATE programs SET schedule_weekdays = ?, schedule_mode = ? WHERE id = ?").run(
        scheduleJson,
        mode,
        legacyProgramId,
      );
      syncScheduleDays(context.runId, scheduleWeekdays);
    }
    if (currentWeek !== undefined || currentDay !== undefined) {
      const existing = db.prepare("SELECT current_week, current_day FROM program_runs WHERE id = ?").get(context.runId) as {
        current_week: number;
        current_day: number;
      };
      const nextWeek = currentWeek ?? existing.current_week;
      const nextDay = currentDay ?? existing.current_day;
      db.prepare("UPDATE program_runs SET current_week = ?, current_day = ? WHERE id = ?").run(
        nextWeek,
        nextDay,
        context.runId,
      );
      db.prepare("UPDATE programs SET current_week = ?, current_day = ? WHERE id = ?").run(
        nextWeek,
        nextDay,
        legacyProgramId,
      );
    }
  },
);

export const archiveProgramRun = db.transaction(
  ({ userId, legacyProgramId }: { userId: number; legacyProgramId: number }): void => {
    const context = assertProgramContext(legacyProgramId, userId);
    db.prepare(
      "UPDATE program_runs SET status = 'archived', archived_at = COALESCE(archived_at, datetime('now')) WHERE id = ?",
    ).run(context.runId);
    db.prepare("UPDATE programs SET archived_at = COALESCE(archived_at, datetime('now')), is_active = 0 WHERE id = ?").run(
      legacyProgramId,
    );
  },
);
