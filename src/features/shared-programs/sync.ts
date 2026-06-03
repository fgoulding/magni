import { diffSharedProgramSnapshots, parseSharedProgramSnapshot } from "@/features/shared-programs/snapshot";
import type {
  SharedProgramExerciseSlotSnapshot,
  SharedProgramSnapshot,
  SharedProgramSnapshotDiff,
} from "@/features/shared-programs/types";
import { getTrainingTemplate } from "@/features/training-templates/registry";
import type { TemplateWeek } from "@/features/training-templates/types";
import { getSnapshotWeek } from "./week-utils";
import { calculateWeight } from "@/lib/calculator";
import { db } from "@/lib/db";

type ExpectedMaxes = Readonly<Record<string, number>>;
type SyncAction = "apply" | "rollback";

type SharedProgramVersionRow = Readonly<{
  id: number;
  shared_program_id: number;
  version_number: number;
  snapshot_json: string;
}>;

type LocalProgramRow = Readonly<{
  id: number;
  shared_program_version_id: number | null;
  program_definition_id: number | null;
  program_run_id: number | null;
  current_week: number;
  current_day: number;
}>;

type DayRow = Readonly<{
  id: number;
  shared_day_key: string | null;
}>;

type ExerciseRow = Readonly<{
  id: number;
  day_id: number;
  training_max: number;
  shared_exercise_key: string | null;
  archived_at: string | null;
}>;

type DesiredWeekSetting = Readonly<{
  setNumber: number;
  intensityPct: number;
  reps: number;
  sets: number;
  repOutTarget: number;
}>;

export type SharedProgramSyncReview = Readonly<{
  currentVersionId: number | null;
  targetVersionId: number;
  diff: SharedProgramSnapshotDiff;
  requiredExpectedMaxKeys: readonly string[];
}>;

export type ExpectedMaxGauge = Readonly<{
  sharedExerciseKey: string;
  currentUserMax: number | null;
  memberMaxes: readonly Readonly<{
    userId: number;
    expectedMax: number;
    isCurrentUser: boolean;
  }>[];
}>;

export function getSharedProgramSyncReview({
  sharedProgramId,
  userId,
  targetVersionId,
}: {
  sharedProgramId: number;
  userId: number;
  targetVersionId: number;
}): SharedProgramSyncReview {
  assertSharedProgramMember(sharedProgramId, userId);
  const targetVersion = getSharedProgramVersion(sharedProgramId, targetVersionId);
  const localProgram = getLocalProgram(sharedProgramId, userId);
  const currentVersion = localProgram?.shared_program_version_id
    ? getSharedProgramVersion(sharedProgramId, localProgram.shared_program_version_id)
    : null;

  return {
    currentVersionId: currentVersion?.id ?? null,
    targetVersionId: targetVersion.id,
    diff: currentVersion
      ? diffSharedProgramSnapshots(currentVersion.snapshot, targetVersion.snapshot)
      : diffFromEmpty(targetVersion.snapshot),
    requiredExpectedMaxKeys: getRequiredExpectedMaxKeys(localProgram?.id ?? null, targetVersion.snapshot),
  };
}

export function applySharedProgramVersion({
  sharedProgramId,
  userId,
  targetVersionId,
  expectedMaxes,
}: {
  sharedProgramId: number;
  userId: number;
  targetVersionId: number;
  expectedMaxes: ExpectedMaxes;
}): Readonly<{ localProgramId: number; versionId: number; action: "apply" }> {
  return syncSharedProgramVersion({
    sharedProgramId,
    userId,
    targetVersionId,
    expectedMaxes,
    action: "apply",
  });
}

export function rollbackSharedProgramVersion({
  sharedProgramId,
  userId,
  targetVersionId,
  expectedMaxes,
}: {
  sharedProgramId: number;
  userId: number;
  targetVersionId: number;
  expectedMaxes: ExpectedMaxes;
}): Readonly<{ localProgramId: number; versionId: number; action: "rollback" }> {
  return syncSharedProgramVersion({
    sharedProgramId,
    userId,
    targetVersionId,
    expectedMaxes,
    action: "rollback",
  });
}

export function getExpectedMaxGauge({
  sharedProgramId,
  sharedExerciseKey,
  userId,
}: {
  sharedProgramId: number;
  sharedExerciseKey: string;
  userId: number;
}): ExpectedMaxGauge {
  assertSharedProgramMember(sharedProgramId, userId);

  const rows = db
    .prepare(
      `
        SELECT user_id, expected_max
        FROM shared_program_expected_maxes
        WHERE shared_program_id = ?
          AND shared_exercise_key = ?
        ORDER BY user_id
      `,
    )
    .all(sharedProgramId, sharedExerciseKey) as { user_id: number; expected_max: number }[];
  const currentUserRow = rows.find((row) => row.user_id === userId);

  return {
    sharedExerciseKey,
    currentUserMax: currentUserRow?.expected_max ?? null,
    memberMaxes: rows.map((row) => ({
      userId: row.user_id,
      expectedMax: row.expected_max,
      isCurrentUser: row.user_id === userId,
    })),
  };
}

function syncSharedProgramVersion<TAction extends SyncAction>({
  sharedProgramId,
  userId,
  targetVersionId,
  expectedMaxes,
  action,
}: {
  sharedProgramId: number;
  userId: number;
  targetVersionId: number;
  expectedMaxes: ExpectedMaxes;
  action: TAction;
}): Readonly<{ localProgramId: number; versionId: number; action: TAction }> {
  const sync = db.transaction(() => {
    assertSharedProgramMember(sharedProgramId, userId);
    const targetVersion = getSharedProgramVersion(sharedProgramId, targetVersionId);
    const localProgram = getLocalProgram(sharedProgramId, userId);
    const existingExerciseKeys = localProgram ? getExistingExerciseKeys(localProgram.id) : new Set<string>();
    const newExercises = flattenExercises(targetVersion.snapshot).filter(
      (exercise) => !existingExerciseKeys.has(exercise.key),
    );

    for (const exercise of newExercises) {
      assertExpectedMax(expectedMaxes[exercise.key], exercise.key);
    }

    const definitionId = ensureSharedDefinitionVersion({
      userId,
      targetVersion,
    });
    const localProgramId =
      localProgram?.id ??
      Number(
        db.prepare(
          `
            INSERT INTO programs (
              user_id,
              name,
              description,
              num_weeks,
              shared_program_id,
              shared_program_version_id,
              program_definition_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
        ).run(
          userId,
          targetVersion.snapshot.name,
          targetVersion.snapshot.description,
          targetVersion.snapshot.numWeeks,
          sharedProgramId,
          targetVersion.id,
          definitionId,
        ).lastInsertRowid,
      );
    const runId = ensureSharedProgramRun({
      userId,
      definitionId,
      snapshot: targetVersion.snapshot,
      currentRunId: localProgram?.program_run_id ?? null,
    });

    materializeSnapshot({
      programId: localProgramId,
      userId,
      sharedProgramId,
      versionId: targetVersion.id,
      snapshot: targetVersion.snapshot,
      expectedMaxes,
      newExerciseKeys: new Set(newExercises.map((exercise) => exercise.key)),
    });

    const nextCurrentWeek = Math.min(localProgram?.current_week ?? 1, targetVersion.snapshot.numWeeks);
    const nextCurrentDay = Math.min(localProgram?.current_day ?? 1, targetVersion.snapshot.days.length);

    db.prepare(
      `
        UPDATE programs
        SET name = ?,
            description = ?,
            num_weeks = ?,
            shared_program_version_id = ?,
            program_definition_id = ?,
            program_run_id = ?,
            archived_at = NULL,
            current_week = ?,
            current_day = ?
        WHERE id = ?
      `,
    ).run(
      targetVersion.snapshot.name,
      targetVersion.snapshot.description,
      targetVersion.snapshot.numWeeks,
      targetVersion.id,
      definitionId,
      runId,
      nextCurrentWeek,
      nextCurrentDay,
      localProgramId,
    );
    db.prepare(
      `
        UPDATE program_runs
        SET program_definition_id = ?,
            name = ?,
            current_week = ?,
            current_day = ?
        WHERE id = ?
      `,
    ).run(definitionId, targetVersion.snapshot.name, nextCurrentWeek, nextCurrentDay, runId);
    db.prepare("DELETE FROM program_run_expected_maxes WHERE program_run_id = ?").run(runId);
    const insertRunMax = db.prepare(
      `
        INSERT INTO program_run_expected_maxes (program_run_id, shared_exercise_key, expected_max)
        VALUES (?, ?, ?)
      `,
    );
    for (const exercise of flattenExercises(targetVersion.snapshot)) {
      const existingExercise = getExercisesBySharedKey(localProgramId).get(exercise.key);
      const expectedMax = existingExercise?.training_max ?? expectedMaxes[exercise.key];
      if (typeof expectedMax === "number" && Number.isFinite(expectedMax) && expectedMax > 0) {
        insertRunMax.run(runId, exercise.key, expectedMax);
      }
    }

    db.prepare(
      `
        INSERT INTO shared_program_applied_versions (
          shared_program_id,
          user_id,
          local_program_id,
          version_id,
          action
        ) VALUES (?, ?, ?, ?, ?)
      `,
    ).run(sharedProgramId, userId, localProgramId, targetVersion.id, action);

    return { localProgramId, versionId: targetVersion.id, action };
  });

  return sync();
}

function ensureSharedDefinitionVersion({
  userId,
  targetVersion,
}: {
  userId: number;
  targetVersion: Readonly<SharedProgramVersionRow & { snapshot: SharedProgramSnapshot }>;
}): number {
  const existing = db
    .prepare(
      `
        SELECT id
        FROM program_definitions
        WHERE shared_program_id = ?
          AND shared_program_version_id = ?
          AND archived_at IS NULL
        ORDER BY id
        LIMIT 1
      `,
    )
    .get(targetVersion.shared_program_id, targetVersion.id) as { id: number } | undefined;

  if (existing) {
    return existing.id;
  }

  const definitionId = Number(
    db.prepare(
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
        ) VALUES (?, ?, ?, ?, 'shared', 'shared', ?, ?)
      `,
    ).run(
      userId,
      targetVersion.snapshot.name,
      targetVersion.snapshot.description,
      targetVersion.snapshot.numWeeks,
      targetVersion.shared_program_id,
      targetVersion.id,
    ).lastInsertRowid,
  );
  materializeSnapshotToDefinition(definitionId, targetVersion.snapshot);

  return definitionId;
}

function materializeSnapshotToDefinition(definitionId: number, snapshot: SharedProgramSnapshot): void {
  const insertDay = db.prepare(
    "INSERT INTO program_definition_days (program_definition_id, name, day_number, sort_order, stable_key) VALUES (?, ?, ?, ?, ?)",
  );
  const insertExercise = db.prepare(
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
  );
  const insertWeek = db.prepare(
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

  snapshot.days.forEach((day, dayIndex) => {
    const sortOrder = dayIndex + 1;
    const definitionDayId = Number(
      insertDay.run(definitionId, day.name, sortOrder, sortOrder, day.key).lastInsertRowid,
    );
    day.exercises.forEach((exercise, exerciseIndex) => {
      const definitionExerciseId = Number(
        insertExercise.run(
          definitionDayId,
          exercise.name,
          exercise.category,
          exercise.progressionType,
          exerciseIndex + 1,
          exercise.key,
        ).lastInsertRowid,
      );
      for (let weekNumber = 1; weekNumber <= snapshot.numWeeks; weekNumber++) {
        for (const week of getDesiredWeekSettings(exercise.weeks, weekNumber)) {
          insertWeek.run(
            definitionExerciseId,
            weekNumber,
            week.setNumber,
            week.intensityPct,
            week.reps,
            week.sets,
            week.repOutTarget,
          );
        }
      }
    });
  });
}

function ensureSharedProgramRun({
  userId,
  definitionId,
  snapshot,
  currentRunId,
}: {
  userId: number;
  definitionId: number;
  snapshot: SharedProgramSnapshot;
  currentRunId: number | null;
}): number {
  if (currentRunId) {
    return currentRunId;
  }

  return Number(
    db.prepare(
      `
        INSERT INTO program_runs (
          user_id,
          program_definition_id,
          name
        ) VALUES (?, ?, ?)
      `,
    ).run(userId, definitionId, snapshot.name).lastInsertRowid,
  );
}

function materializeSnapshot({
  programId,
  userId,
  sharedProgramId,
  versionId,
  snapshot,
  expectedMaxes,
  newExerciseKeys,
}: {
  programId: number;
  userId: number;
  sharedProgramId: number;
  versionId: number;
  snapshot: SharedProgramSnapshot;
  expectedMaxes: ExpectedMaxes;
  newExerciseKeys: ReadonlySet<string>;
}): void {
  shiftExistingDayNumbers(programId);

  const activeDayKeys = new Set(snapshot.days.map((day) => day.key));
  const activeExerciseKeys = new Set(flattenExercises(snapshot).map((exercise) => exercise.key));
  const dayIdsByKey = new Map<string, number>();

  snapshot.days.forEach((day, index) => {
    const sortOrder = index + 1;
    const existingDay = getDaysBySharedKey(programId).get(day.key);

    if (existingDay) {
      db.prepare(
        `
          UPDATE days
          SET name = ?,
              day_number = ?,
              sort_order = ?,
              archived_at = NULL
          WHERE id = ?
        `,
      ).run(day.name, sortOrder, sortOrder, existingDay.id);
      dayIdsByKey.set(day.key, existingDay.id);
      return;
    }

    const dayId = Number(
      db.prepare(
        `
          INSERT INTO days (program_id, name, day_number, sort_order, shared_day_key)
          VALUES (?, ?, ?, ?, ?)
        `,
      ).run(programId, day.name, sortOrder, sortOrder, day.key).lastInsertRowid,
    );
    dayIdsByKey.set(day.key, dayId);
  });

  archiveRemovedDays(programId, activeDayKeys);
  archiveRemovedExercises(programId, activeExerciseKeys);

  const rounding = getUserRounding(userId);
  const exercisesByKey = getExercisesBySharedKey(programId);

  for (const day of snapshot.days) {
    const dayId = dayIdsByKey.get(day.key);

    if (!dayId) {
      throw new Error(`Failed to materialize day: ${day.key}`);
    }

    day.exercises.forEach((exercise, index) => {
      const sortOrder = index + 1;
      const existingExercise = exercisesByKey.get(exercise.key);
      const trainingMax = existingExercise?.training_max ?? expectedMaxes[exercise.key];
      const replaceExistingExercise =
        existingExercise &&
        liveWeekSettingsNeedReplacement(existingExercise.id, snapshot.numWeeks, exercise.weeks);

      if (existingExercise && !replaceExistingExercise) {
        db.prepare(
          `
            UPDATE exercises
            SET day_id = ?,
                name = ?,
                category = ?,
                progression_type = ?,
                auto_progression_enabled = ?,
                sort_order = ?,
                archived_at = NULL
            WHERE id = ?
          `,
        ).run(
          dayId,
          exercise.name,
          exercise.category,
          exercise.progressionType,
          getAutoProgressionEnabled(exercise.progressionType),
          sortOrder,
          existingExercise.id,
        );
        upsertWeekSettings(existingExercise.id, trainingMax, snapshot.numWeeks, exercise.weeks, rounding);
        return;
      }

      if (existingExercise && replaceExistingExercise) {
        db.prepare("UPDATE exercises SET archived_at = COALESCE(archived_at, datetime('now')) WHERE id = ?").run(
          existingExercise.id,
        );
      }

      const exerciseId = Number(
        db.prepare(
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
        ).run(
          dayId,
          exercise.name,
          trainingMax,
          exercise.category,
          exercise.progressionType,
          getAutoProgressionEnabled(exercise.progressionType),
          sortOrder,
          exercise.key,
        ).lastInsertRowid,
      );
      upsertWeekSettings(exerciseId, trainingMax, snapshot.numWeeks, exercise.weeks, rounding);

      if (newExerciseKeys.has(exercise.key)) {
        recordExpectedMax({
          userId,
          exerciseId,
          sharedProgramId,
          versionId,
          sharedExerciseKey: exercise.key,
          expectedMax: trainingMax,
        });
      }
    });
  }
}

function upsertWeekSettings(
  exerciseId: number,
  trainingMax: number,
  numWeeks: number,
  weeks: readonly TemplateWeek[],
  rounding: number,
): void {
  const insertWeek = db.prepare(
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
  const updateWeek = db.prepare(
    `
      UPDATE week_settings
      SET intensity_pct = ?,
          reps = ?,
          sets = ?,
          rep_out_target = ?,
          calculated_weight = ?
      WHERE id = ?
    `,
  );
  const findWeek = db.prepare(
    "SELECT id FROM week_settings WHERE exercise_id = ? AND week_number = ? AND set_number = ?",
  );
  const rowsForWeek = db.prepare(
    "SELECT id, set_number FROM week_settings WHERE exercise_id = ? AND week_number = ?",
  );
  const deleteWeek = db.prepare("DELETE FROM week_settings WHERE id = ?");

  for (let weekNumber = 1; weekNumber <= numWeeks; weekNumber++) {
    const desiredRows = getDesiredWeekSettings(weeks, weekNumber);
    const desiredSetNumbers = new Set(desiredRows.map((row) => row.setNumber));

    for (const desired of desiredRows) {
      const calculatedWeight = calculateWeight(trainingMax, desired.intensityPct, rounding);
      const existing = findWeek.get(exerciseId, weekNumber, desired.setNumber) as { id: number } | undefined;
      if (!existing) {
        insertWeek.run(
          exerciseId,
          weekNumber,
          desired.setNumber,
          desired.intensityPct,
          desired.reps,
          desired.sets,
          desired.repOutTarget,
          calculatedWeight,
        );
        continue;
      }

      if (!weekSettingHasSessionSets(existing.id)) {
        updateWeek.run(
          desired.intensityPct,
          desired.reps,
          desired.sets,
          desired.repOutTarget,
          calculatedWeight,
          existing.id,
        );
      }
    }

    const staleRows = rowsForWeek.all(exerciseId, weekNumber) as { id: number; set_number: number }[];
    for (const row of staleRows) {
      if (!desiredSetNumbers.has(row.set_number) && !weekSettingHasSessionSets(row.id)) {
        deleteWeek.run(row.id);
      }
    }
  }

  const removableRows = db
    .prepare("SELECT id FROM week_settings WHERE exercise_id = ? AND week_number > ?")
    .all(exerciseId, numWeeks) as { id: number }[];

  for (const row of removableRows) {
    if (!weekSettingHasSessionSets(row.id)) {
      deleteWeek.run(row.id);
    }
  }
}

function liveWeekSettingsNeedReplacement(
  exerciseId: number,
  numWeeks: number,
  weeks: readonly TemplateWeek[],
): boolean {
  const rows = db
    .prepare(
      `
        SELECT id, week_number, set_number, intensity_pct, reps, sets, rep_out_target
        FROM week_settings
        WHERE exercise_id = ?
      `,
    )
    .all(exerciseId) as {
    id: number;
    week_number: number;
    set_number: number;
    intensity_pct: number;
    reps: number;
    sets: number;
    rep_out_target: number;
  }[];

  return rows.some((row) => {
    if (!weekSettingHasSessionSets(row.id)) {
      return false;
    }

    if (row.week_number > numWeeks) {
      return true;
    }

    const targetWeek = getDesiredWeekSettings(weeks, row.week_number).find(
      (desired) => desired.setNumber === row.set_number,
    );
    if (!targetWeek) {
      return true;
    }

    return (
      row.intensity_pct !== targetWeek.intensityPct ||
      row.reps !== targetWeek.reps ||
      row.sets !== targetWeek.sets ||
      row.rep_out_target !== targetWeek.repOutTarget
    );
  });
}

function getDesiredWeekSettings(weeks: readonly TemplateWeek[], weekNumber: number): readonly DesiredWeekSetting[] {
  const week = getSnapshotWeek(weeks, weekNumber);

  if (week.ramp && week.ramp.length > 0) {
    return week.ramp.map((rampSet) => ({
      setNumber: rampSet.setNumber,
      intensityPct: rampSet.intensityPct,
      reps: rampSet.reps,
      sets: 1,
      repOutTarget: rampSet.repOutTarget,
    }));
  }

  return [
    {
      setNumber: 1,
      intensityPct: week.intensityPct,
      reps: week.reps,
      sets: week.sets,
      repOutTarget: week.repOutTarget,
    },
  ];
}

function recordExpectedMax({
  userId,
  exerciseId,
  sharedProgramId,
  versionId,
  sharedExerciseKey,
  expectedMax,
}: {
  userId: number;
  exerciseId: number;
  sharedProgramId: number;
  versionId: number;
  sharedExerciseKey: string;
  expectedMax: number;
}): void {
  db.prepare(
    `
      INSERT INTO shared_program_expected_maxes (
        shared_program_id,
        user_id,
        shared_exercise_key,
        expected_max,
        updated_at
      ) VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(shared_program_id, user_id, shared_exercise_key)
      DO UPDATE SET expected_max = excluded.expected_max,
                    updated_at = datetime('now')
    `,
  ).run(sharedProgramId, userId, sharedExerciseKey, expectedMax);
  db.prepare(
    `
      INSERT INTO exercise_max_history (
        user_id,
        exercise_id,
        shared_program_id,
        shared_program_version_id,
        shared_exercise_key,
        training_max,
        source
      ) VALUES (?, ?, ?, ?, ?, ?, 'sync')
    `,
  ).run(userId, exerciseId, sharedProgramId, versionId, sharedExerciseKey, expectedMax);
}

function getSharedProgramVersion(
  sharedProgramId: number,
  versionId: number,
): Readonly<SharedProgramVersionRow & { snapshot: SharedProgramSnapshot }> {
  const row = db
    .prepare(
      `
        SELECT id, shared_program_id, version_number, snapshot_json
        FROM shared_program_versions
        WHERE id = ?
          AND shared_program_id = ?
      `,
    )
    .get(versionId, sharedProgramId) as SharedProgramVersionRow | undefined;

  if (!row) {
    throw new Error(`Shared program version not found: ${versionId}`);
  }

  return { ...row, snapshot: parseSharedProgramSnapshot(row.snapshot_json) };
}

function getLocalProgram(sharedProgramId: number, userId: number): LocalProgramRow | null {
  const row = db
    .prepare(
      `
        SELECT
          p.id,
          p.shared_program_version_id,
          p.program_definition_id,
          p.program_run_id,
          COALESCE(pr.current_week, p.current_week) AS current_week,
          COALESCE(pr.current_day, p.current_day) AS current_day
        FROM programs p
        LEFT JOIN program_runs pr ON pr.id = p.program_run_id
        WHERE p.shared_program_id = ?
          AND p.user_id = ?
          AND COALESCE(pr.archived_at, p.archived_at) IS NULL
        ORDER BY p.id DESC
        LIMIT 1
      `,
    )
    .get(sharedProgramId, userId) as LocalProgramRow | undefined;

  return row ?? null;
}

function getRequiredExpectedMaxKeys(programId: number | null, snapshot: SharedProgramSnapshot): readonly string[] {
  const existingKeys = programId ? getExistingExerciseKeys(programId) : new Set<string>();

  return flattenExercises(snapshot)
    .filter((exercise) => !existingKeys.has(exercise.key))
    .map((exercise) => exercise.key);
}

function getExistingExerciseKeys(programId: number): Set<string> {
  const keys = [...getExercisesBySharedKey(programId).values()]
    .map((exercise) => exercise.shared_exercise_key)
    .filter((key): key is string => key !== null);

  return new Set(keys);
}

function getDaysBySharedKey(programId: number): Map<string, DayRow> {
  const rows = db
    .prepare("SELECT id, shared_day_key FROM days WHERE program_id = ? AND shared_day_key IS NOT NULL")
    .all(programId) as DayRow[];

  return new Map(rows.map((row) => [row.shared_day_key!, row]));
}

function getExercisesBySharedKey(programId: number): Map<string, ExerciseRow> {
  const rows = db
    .prepare(
      `
        SELECT e.id, e.day_id, e.training_max, e.shared_exercise_key, e.archived_at
        FROM exercises e
        INNER JOIN days d ON d.id = e.day_id
        WHERE d.program_id = ?
          AND e.shared_exercise_key IS NOT NULL
        ORDER BY e.id DESC
      `,
    )
    .all(programId) as ExerciseRow[];

  const exercisesByKey = new Map<string, ExerciseRow>();

  for (const row of rows) {
    const key = row.shared_exercise_key!;
    const existing = exercisesByKey.get(key);

    if (!existing || (existing.archived_at !== null && row.archived_at === null)) {
      exercisesByKey.set(key, row);
    }
  }

  return exercisesByKey;
}

function assertSharedProgramMember(sharedProgramId: number, userId: number): void {
  const row = db
    .prepare("SELECT 1 FROM shared_program_members WHERE shared_program_id = ? AND user_id = ?")
    .get(sharedProgramId, userId) as { 1: number } | undefined;

  if (!row) {
    throw new Error("Shared program access requires shared program membership");
  }
}

function assertExpectedMax(value: unknown, sharedExerciseKey: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Expected max is required for ${sharedExerciseKey}`);
  }
}

function diffFromEmpty(snapshot: SharedProgramSnapshot): SharedProgramSnapshotDiff {
  return {
    dayChanges: snapshot.days.map((day, index) => ({
      type: "added",
      key: day.key,
      name: day.name,
      index,
    })),
    exerciseChanges: snapshot.days.flatMap((day) =>
      day.exercises.map((exercise, index) => ({
        type: "added",
        dayKey: day.key,
        key: exercise.key,
        name: exercise.name,
        index,
      })),
    ),
    templateChanges: [],
  };
}

function flattenExercises(snapshot: SharedProgramSnapshot): readonly SharedProgramExerciseSlotSnapshot[] {
  return snapshot.days.flatMap((day) => day.exercises);
}

function shiftExistingDayNumbers(programId: number): void {
  db.prepare(
    `
      UPDATE days
      SET day_number = day_number + 100000,
          sort_order = sort_order + 100000
      WHERE program_id = ?
    `,
  ).run(programId);
}

function archiveRemovedDays(programId: number, activeDayKeys: ReadonlySet<string>): void {
  const rows = getDaysBySharedKey(programId);
  const archive = db.prepare("UPDATE days SET archived_at = COALESCE(archived_at, datetime('now')) WHERE id = ?");

  for (const [key, row] of rows) {
    if (!activeDayKeys.has(key)) {
      archive.run(row.id);
    }
  }
}

function archiveRemovedExercises(programId: number, activeExerciseKeys: ReadonlySet<string>): void {
  const rows = getExercisesBySharedKey(programId);
  const archive = db.prepare(
    "UPDATE exercises SET archived_at = COALESCE(archived_at, datetime('now')) WHERE id = ?",
  );

  for (const [key, row] of rows) {
    if (!activeExerciseKeys.has(key)) {
      archive.run(row.id);
    }
  }
}

function weekSettingHasSessionSets(weekSettingId: number): boolean {
  const row = db
    .prepare("SELECT 1 AS found FROM session_sets WHERE week_setting_id = ? LIMIT 1")
    .get(weekSettingId) as { found: number } | undefined;

  return row !== undefined;
}

function getUserRounding(userId: number): number {
  const row = db
    .prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'rounding'")
    .get(userId) as { value: string } | undefined;
  const rounding = row ? Number(row.value) : 2.5;

  return Number.isFinite(rounding) && rounding > 0 ? rounding : 2.5;
}

function getAutoProgressionEnabled(progressionType: string): number {
  try {
    return getTrainingTemplate(progressionType).autoProgression ? 1 : 0;
  } catch {
    return 0;
  }
}
