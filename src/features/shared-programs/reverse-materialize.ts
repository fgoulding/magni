import type { TemplateWeek } from "@/features/training-templates/types";
import { db } from "@/lib/db";
import type {
  SharedProgramDaySnapshot,
  SharedProgramExerciseSlotSnapshot,
  SharedProgramSnapshot,
} from "./types";

type WeekSettingRow = Readonly<{
  week_number: number;
  set_number: number;
  intensity_pct: number;
  reps: number;
  sets: number;
  rep_out_target: number;
}>;

export function reverseMaterializeProgram(
  programId: number,
  userId: number,
): SharedProgramSnapshot {
  const program = db
    .prepare(
      `
        SELECT
          p.id,
          p.program_definition_id,
          COALESCE(pd.name, p.name) AS name,
          COALESCE(pd.description, p.description) AS description,
          COALESCE(pd.num_weeks, p.num_weeks) AS num_weeks
        FROM programs p
        LEFT JOIN program_definitions pd ON pd.id = p.program_definition_id
        WHERE p.id = ?
          AND p.user_id = ?
      `,
    )
    .get(programId, userId) as
    | { id: number; program_definition_id: number | null; name: string; description: string; num_weeks: number }
    | undefined;

  if (!program) {
    throw new Error("Program not found");
  }

  if (program.program_definition_id) {
    return reverseMaterializeDefinition({
      definitionId: program.program_definition_id,
      programId,
      name: program.name,
      description: program.description,
      numWeeks: program.num_weeks,
    });
  }

  const days = db
    .prepare(
      "SELECT * FROM days WHERE program_id = ? AND archived_at IS NULL ORDER BY sort_order",
    )
    .all(programId) as { id: number; name: string; shared_day_key: string | null }[];

  const snapshotDays: SharedProgramDaySnapshot[] = days.map((day) => {
    const exercises = db
      .prepare(
        "SELECT * FROM exercises WHERE day_id = ? AND archived_at IS NULL ORDER BY sort_order",
      )
      .all(day.id) as {
      id: number;
      name: string;
      category: string;
      progression_type: string;
      shared_exercise_key: string | null;
    }[];

    const snapshotExercises: SharedProgramExerciseSlotSnapshot[] = exercises.map(
      (exercise) => {
        const weekSettings = db
          .prepare(
            "SELECT week_number, set_number, intensity_pct, reps, sets, rep_out_target FROM week_settings WHERE exercise_id = ? ORDER BY week_number, set_number",
          )
          .all(exercise.id) as WeekSettingRow[];

        const templateWeeks = findTemplatePattern(weekSettings);

        return {
          key: exercise.shared_exercise_key ?? makeManualExerciseKey(programId, exercise.id),
          name: exercise.name,
          category: exercise.category as SharedProgramExerciseSlotSnapshot["category"],
          progressionType: exercise.progression_type,
          weeks: templateWeeks,
        };
      },
    );

    return {
      key: day.shared_day_key ?? makeManualDayKey(programId, day.id),
      name: day.name,
      exercises: snapshotExercises,
    };
  });

  return {
    schemaVersion: 1,
    name: program.name,
    description: program.description,
    numWeeks: program.num_weeks,
    days: snapshotDays,
  };
}

function reverseMaterializeDefinition({
  definitionId,
  programId,
  name,
  description,
  numWeeks,
}: {
  definitionId: number;
  programId: number;
  name: string;
  description: string;
  numWeeks: number;
}): SharedProgramSnapshot {
  const days = db
    .prepare(
      `
        SELECT id, name, stable_key
        FROM program_definition_days
        WHERE program_definition_id = ?
          AND archived_at IS NULL
        ORDER BY sort_order, day_number
      `,
    )
    .all(definitionId) as { id: number; name: string; stable_key: string | null }[];

  return {
    schemaVersion: 1,
    name,
    description,
    numWeeks,
    days: days.map((day) => {
      const exercises = db
        .prepare(
          `
            SELECT id, name, category, progression_type, stable_key
            FROM program_definition_exercises
            WHERE program_definition_day_id = ?
              AND archived_at IS NULL
            ORDER BY sort_order, id
          `,
        )
        .all(day.id) as {
        id: number;
        name: string;
        category: string;
        progression_type: string;
        stable_key: string | null;
      }[];

      return {
        key: day.stable_key ?? makeManualDayKey(programId, day.id),
        name: day.name,
        exercises: exercises.map((exercise) => {
          const weekSettings = db
            .prepare(
              `
                SELECT week_number, set_number, intensity_pct, reps, sets, rep_out_target
                FROM program_definition_week_settings
                WHERE program_definition_exercise_id = ?
                ORDER BY week_number, set_number
              `,
            )
            .all(exercise.id) as WeekSettingRow[];

          return {
            key: exercise.stable_key ?? makeManualExerciseKey(programId, exercise.id),
            name: exercise.name,
            category: exercise.category as SharedProgramExerciseSlotSnapshot["category"],
            progressionType: exercise.progression_type,
            weeks: findTemplatePattern(weekSettings),
          };
        }),
      };
    }),
  };
}

function findTemplatePattern(weekSettings: readonly WeekSettingRow[]): TemplateWeek[] {
  const perWeek = new Map<number, WeekSettingRow[]>();
  for (const ws of weekSettings) {
    const list = perWeek.get(ws.week_number) || [];
    list.push(ws);
    perWeek.set(ws.week_number, list);
  }

  const sortedWeeks = Array.from(perWeek.keys()).sort((a, b) => a - b);
  if (sortedWeeks.length === 0) return [];

  const setsPerWeek = perWeek.get(sortedWeeks[0])!.length;
  const n = sortedWeeks.length;

  for (let len = 1; len <= n; len++) {
    let matches = true;
    for (let wi = 0; wi < n && matches; wi++) {
      const templateWeek = perWeek.get(sortedWeeks[wi % len])!;
      const currentWeek = perWeek.get(sortedWeeks[wi])!;
      if (templateWeek.length !== currentWeek.length) { matches = false; break; }
      for (let si = 0; si < templateWeek.length; si++) {
        const t = templateWeek[si], c = currentWeek[si];
        if (t.intensity_pct !== c.intensity_pct || t.reps !== c.reps ||
            t.sets !== c.sets || t.rep_out_target !== c.rep_out_target) {
          matches = false; break;
        }
      }
    }
    if (matches) {
      const result: TemplateWeek[] = [];
      for (let wi = 0; wi < len; wi++) {
        const weekSets = perWeek.get(sortedWeeks[wi])!;
        const ramp = weekSets.length > 1
          ? weekSets.map((ws) => ({
              setNumber: ws.set_number,
              intensityPct: ws.intensity_pct,
              reps: ws.reps,
              repOutTarget: ws.rep_out_target,
            }))
          : undefined;
        result.push({
          weekNumber: wi + 1,
          intensityPct: ramp ? 0 : weekSets[0].intensity_pct,
          reps: ramp ? 0 : weekSets[0].reps,
          sets: ramp ? ramp.length : weekSets[0].sets,
          repOutTarget: ramp ? 0 : weekSets[0].rep_out_target,
          ramp,
        });
      }
      return result;
    }
  }

  return sortedWeeks.map((weekNum, i) => {
    const weekSets = perWeek.get(weekNum)!;
    return {
      weekNumber: i + 1,
      intensityPct: weekSets[0].intensity_pct,
      reps: weekSets[0].reps,
      sets: setsPerWeek,
      repOutTarget: weekSets[0].rep_out_target,
    };
  });
}

function makeManualDayKey(programId: number, dayId: number): string {
  return `program:${programId}:day:${dayId}`;
}

function makeManualExerciseKey(programId: number, exerciseId: number): string {
  return `program:${programId}:exercise:${exerciseId}`;
}
