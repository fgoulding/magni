import type Database from "better-sqlite3";

function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
  return columns.some((column) => column.name === columnName);
}

function addColumn(db: Database.Database, tableName: string, definition: string): void {
  const columnName = definition.split(/\s+/)[0];
  if (!hasColumn(db, tableName, columnName)) {
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`).run();
  }
}

function hasTable(db: Database.Database, tableName: string): boolean {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;
  return table !== undefined;
}

function createProgramDefinitionRunTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS program_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      num_weeks INTEGER NOT NULL DEFAULT 7 CHECK(num_weeks > 0),
      source_type TEXT NOT NULL DEFAULT 'custom' CHECK(source_type IN ('custom','default','shared')),
      visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')),
      shared_program_id INTEGER REFERENCES shared_programs(id) ON DELETE SET NULL,
      shared_program_version_id INTEGER REFERENCES shared_program_versions(id) ON DELETE SET NULL,
      archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS program_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      program_definition_id INTEGER REFERENCES program_definitions(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed','archived')),
      current_week INTEGER NOT NULL DEFAULT 1 CHECK(current_week > 0),
      current_day INTEGER NOT NULL DEFAULT 1 CHECK(current_day > 0),
      schedule_weekdays TEXT NOT NULL DEFAULT '[]',
      schedule_mode TEXT NOT NULL DEFAULT 'unscheduled' CHECK(schedule_mode IN ('unscheduled','scheduled')),
      start_date TEXT,
      private_modifications_enabled INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS program_definition_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_definition_id INTEGER NOT NULL REFERENCES program_definitions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      day_number INTEGER NOT NULL CHECK(day_number > 0),
      sort_order INTEGER NOT NULL DEFAULT 0,
      stable_key TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(program_definition_id, day_number)
    );

    CREATE TABLE IF NOT EXISTS program_definition_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_definition_day_id INTEGER NOT NULL REFERENCES program_definition_days(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'main' CHECK(category IN ('main','aux','accessory')),
      progression_type TEXT NOT NULL DEFAULT 'custom',
      sort_order INTEGER NOT NULL DEFAULT 0,
      stable_key TEXT,
      superset_group TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS program_definition_week_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_definition_exercise_id INTEGER NOT NULL REFERENCES program_definition_exercises(id) ON DELETE CASCADE,
      week_number INTEGER NOT NULL CHECK(week_number > 0),
      set_number INTEGER NOT NULL DEFAULT 1,
      intensity_pct REAL NOT NULL CHECK(intensity_pct >= 0 AND intensity_pct <= 1),
      reps INTEGER NOT NULL CHECK(reps > 0),
      sets INTEGER NOT NULL CHECK(sets > 0),
      rep_out_target INTEGER NOT NULL CHECK(rep_out_target >= 0),
      UNIQUE(program_definition_exercise_id, week_number, set_number)
    );

    CREATE TABLE IF NOT EXISTS program_run_schedule_days (
      program_run_id INTEGER NOT NULL REFERENCES program_runs(id) ON DELETE CASCADE,
      weekday INTEGER NOT NULL CHECK(weekday >= 0 AND weekday <= 6),
      definition_day_number INTEGER CHECK(definition_day_number IS NULL OR definition_day_number > 0),
      PRIMARY KEY (program_run_id, weekday)
    );

    CREATE TABLE IF NOT EXISTS program_run_expected_maxes (
      program_run_id INTEGER NOT NULL REFERENCES program_runs(id) ON DELETE CASCADE,
      shared_exercise_key TEXT NOT NULL,
      expected_max REAL NOT NULL CHECK(expected_max > 0),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (program_run_id, shared_exercise_key)
    );

    CREATE TABLE IF NOT EXISTS program_run_holds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_run_id INTEGER NOT NULL REFERENCES program_runs(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      canceled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK(start_date <= end_date)
    );
  `);
}

function parseScheduleWeekdaysJson(value: string | null | undefined): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed)]
      .filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

function backfillProgramDefinitionsAndRuns(db: Database.Database): void {
  db.transaction(() => {
    const programs = db
      .prepare(
        `
          SELECT
            id,
            user_id,
            name,
            description,
            num_weeks,
            current_week,
            current_day,
            schedule_weekdays,
            schedule_mode,
            shared_program_id,
            shared_program_version_id,
            program_definition_id,
            program_run_id,
            archived_at,
            is_active
          FROM programs
        `,
      )
      .all() as {
      id: number;
      user_id: number;
      name: string;
      description: string;
      num_weeks: number;
      current_week: number;
      current_day: number;
      schedule_weekdays: string;
      schedule_mode: string;
      shared_program_id: number | null;
      shared_program_version_id: number | null;
      program_definition_id: number | null;
      program_run_id: number | null;
      archived_at: string | null;
      is_active: number;
    }[];

    const insertDefinition = db.prepare(
      `
        INSERT INTO program_definitions (
          owner_user_id,
          name,
          description,
          num_weeks,
          source_type,
          visibility,
          shared_program_id,
          shared_program_version_id,
          archived_at,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
    );
    const insertRun = db.prepare(
      `
        INSERT INTO program_runs (
          user_id,
          program_definition_id,
          name,
          status,
          current_week,
          current_day,
          schedule_weekdays,
          schedule_mode,
          archived_at,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
    );
    const updateProgram = db.prepare(
      "UPDATE programs SET program_definition_id = ?, program_run_id = ? WHERE id = ?",
    );
    const insertScheduleDay = db.prepare(
      "INSERT OR IGNORE INTO program_run_schedule_days (program_run_id, weekday, definition_day_number) VALUES (?, ?, ?)",
    );

    for (const program of programs) {
      let definitionId = program.program_definition_id;
      if (!definitionId) {
        definitionId = Number(
          insertDefinition.run(
            program.user_id,
            program.name,
            program.description,
            program.num_weeks,
            program.shared_program_id ? "shared" : "custom",
            program.shared_program_id ? "shared" : "private",
            program.shared_program_id,
            program.shared_program_version_id,
            program.archived_at,
          ).lastInsertRowid,
        );
        copyProgramStructureToDefinition(db, program.id, definitionId);
      }

      let runId = program.program_run_id;
      if (!runId) {
        runId = Number(
          insertRun.run(
            program.user_id,
            definitionId,
            program.name,
            program.archived_at || program.is_active === 0 ? "archived" : "active",
            program.current_week,
            program.current_day,
            program.schedule_weekdays,
            program.schedule_mode,
            program.archived_at,
          ).lastInsertRowid,
        );
      }

      updateProgram.run(definitionId, runId, program.id);
      parseScheduleWeekdaysJson(program.schedule_weekdays).forEach((weekday, index) => {
        insertScheduleDay.run(runId, weekday, index + 1);
      });
    }

    db.exec(`
      UPDATE sessions
      SET program_definition_id = COALESCE(
            program_definition_id,
            (SELECT programs.program_definition_id FROM programs WHERE programs.id = sessions.program_id)
          ),
          program_run_id = COALESCE(
            program_run_id,
            (SELECT programs.program_run_id FROM programs WHERE programs.id = sessions.program_id)
          ),
          program_name = COALESCE(
            NULLIF(program_name, ''),
            (SELECT programs.name FROM programs WHERE programs.id = sessions.program_id),
            ''
          ),
          day_name = COALESCE(
            NULLIF(day_name, ''),
            (SELECT days.name FROM days WHERE days.id = sessions.day_id),
            ''
          )
      WHERE program_definition_id IS NULL
         OR program_run_id IS NULL
         OR program_name = ''
         OR day_name = '';
    `);
  })();
}

function copyProgramStructureToDefinition(
  db: Database.Database,
  programId: number,
  definitionId: number,
): void {
  const days = db
    .prepare(
      "SELECT id, name, day_number, sort_order, shared_day_key, archived_at FROM days WHERE program_id = ? ORDER BY sort_order, day_number",
    )
    .all(programId) as {
    id: number;
    name: string;
    day_number: number;
    sort_order: number;
    shared_day_key: string | null;
    archived_at: string | null;
  }[];
  const insertDay = db.prepare(
    "INSERT INTO program_definition_days (program_definition_id, name, day_number, sort_order, stable_key, archived_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertExercise = db.prepare(
    `
      INSERT INTO program_definition_exercises (
        program_definition_day_id,
        name,
        category,
        progression_type,
        sort_order,
        stable_key,
        superset_group,
        archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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

  for (const day of days) {
    const definitionDayId = Number(
      insertDay.run(
        definitionId,
        day.name,
        day.day_number,
        day.sort_order,
        day.shared_day_key,
        day.archived_at,
      ).lastInsertRowid,
    );
    const exercises = db
      .prepare(
        `
          SELECT id, name, category, progression_type, sort_order, shared_exercise_key, superset_group, archived_at
          FROM exercises
          WHERE day_id = ?
          ORDER BY sort_order, id
        `,
      )
      .all(day.id) as {
      id: number;
      name: string;
      category: string;
      progression_type: string;
      sort_order: number;
      shared_exercise_key: string | null;
      superset_group: string | null;
      archived_at: string | null;
    }[];

    for (const exercise of exercises) {
      const definitionExerciseId = Number(
        insertExercise.run(
          definitionDayId,
          exercise.name,
          exercise.category,
          exercise.progression_type,
          exercise.sort_order,
          exercise.shared_exercise_key,
          exercise.superset_group,
          exercise.archived_at,
        ).lastInsertRowid,
      );
      const weeks = db
        .prepare(
          "SELECT week_number, set_number, intensity_pct, reps, sets, rep_out_target FROM week_settings WHERE exercise_id = ? ORDER BY week_number, set_number",
        )
        .all(exercise.id) as {
        week_number: number;
        set_number: number;
        intensity_pct: number;
        reps: number;
        sets: number;
        rep_out_target: number;
      }[];

      for (const week of weeks) {
        insertWeek.run(
          definitionExerciseId,
          week.week_number,
          week.set_number,
          week.intensity_pct,
          week.reps,
          week.sets,
          week.rep_out_target,
        );
      }
    }
  }
}

function createExerciseMaxHistoryTable(db: Database.Database, tableName = "exercise_max_history"): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      exercise_id INTEGER REFERENCES exercises(id) ON DELETE SET NULL,
      shared_program_id INTEGER REFERENCES shared_programs(id) ON DELETE SET NULL,
      shared_program_version_id INTEGER REFERENCES shared_program_versions(id) ON DELETE SET NULL,
      shared_exercise_key TEXT,
      session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
      session_set_id INTEGER REFERENCES session_sets(id) ON DELETE SET NULL,
      training_max REAL CHECK(training_max IS NULL OR training_max > 0),
      working_weight REAL CHECK(working_weight IS NULL OR working_weight > 0),
      actual_reps INTEGER CHECK(actual_reps IS NULL OR actual_reps >= 0),
      implied_max REAL CHECK(implied_max IS NULL OR implied_max > 0),
      source TEXT NOT NULL CHECK(source IN ('sync','manual','set','progression','import')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK(
        training_max IS NOT NULL
        OR working_weight IS NOT NULL
        OR actual_reps IS NOT NULL
        OR implied_max IS NOT NULL
      )
    );
  `);
}

function exerciseMaxHistoryNeedsRebuild(db: Database.Database): boolean {
  const table = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'exercise_max_history'")
    .get() as { sql: string } | undefined;

  if (!table) {
    return false;
  }

  return (
    !hasColumn(db, "exercise_max_history", "shared_program_version_id") ||
    !table.sql.includes("shared_program_id INTEGER REFERENCES shared_programs(id) ON DELETE SET NULL") ||
    !table.sql.includes("training_max REAL CHECK(training_max IS NULL OR training_max > 0)") ||
    !table.sql.includes("working_weight REAL CHECK(working_weight IS NULL OR working_weight > 0)") ||
    !table.sql.includes("actual_reps INTEGER CHECK(actual_reps IS NULL OR actual_reps >= 0)") ||
    !table.sql.includes("implied_max REAL CHECK(implied_max IS NULL OR implied_max > 0)") ||
    !table.sql.includes("training_max IS NOT NULL")
  );
}

function ensureExerciseMaxHistoryTable(db: Database.Database): void {
  if (!hasTable(db, "exercise_max_history")) {
    createExerciseMaxHistoryTable(db);
    return;
  }

  if (!exerciseMaxHistoryNeedsRebuild(db)) {
    return;
  }

  const sharedProgramVersionSelect = hasColumn(db, "exercise_max_history", "shared_program_version_id")
    ? "shared_program_version_id"
    : "NULL";

  db.exec("DROP TABLE IF EXISTS exercise_max_history_new");
  db.exec("BEGIN");
  try {
    createExerciseMaxHistoryTable(db, "exercise_max_history_new");
    db.exec(`
      INSERT INTO exercise_max_history_new (
        id,
        user_id,
        exercise_id,
        shared_program_id,
        shared_program_version_id,
        shared_exercise_key,
        session_id,
        session_set_id,
        training_max,
        working_weight,
        actual_reps,
        implied_max,
        source,
        created_at
      )
      SELECT
        id,
        user_id,
        exercise_id,
        shared_program_id,
        ${sharedProgramVersionSelect},
        shared_exercise_key,
        session_id,
        session_set_id,
        training_max,
        working_weight,
        actual_reps,
        implied_max,
        source,
        created_at
      FROM exercise_max_history
      WHERE
        (training_max IS NULL OR training_max > 0)
        AND (working_weight IS NULL OR working_weight > 0)
        AND (actual_reps IS NULL OR actual_reps >= 0)
        AND (implied_max IS NULL OR implied_max > 0)
        AND (
          training_max IS NOT NULL
          OR working_weight IS NOT NULL
          OR actual_reps IS NOT NULL
          OR implied_max IS NOT NULL
        );

      DROP TABLE exercise_max_history;
      ALTER TABLE exercise_max_history_new RENAME TO exercise_max_history;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function ensureWeekSettingsSupportsSetNumber(db: Database.Database): void {
  if (hasColumn(db, "week_settings", "set_number")) return;
  const foreignKeyState = db.pragma("foreign_keys") as { foreign_keys: number }[];
  const restoreForeignKeys = foreignKeyState[0]?.foreign_keys === 1;
  let transactionStarted = false;

  if (restoreForeignKeys) {
    db.pragma("foreign_keys = OFF");
  }

  try {
    db.exec("DROP TABLE IF EXISTS week_settings_new");
    db.exec("BEGIN");
    transactionStarted = true;
    db.exec(`
      CREATE TABLE week_settings_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
        week_number INTEGER NOT NULL CHECK(week_number > 0),
        set_number INTEGER NOT NULL DEFAULT 1,
        intensity_pct REAL NOT NULL CHECK(intensity_pct >= 0 AND intensity_pct <= 1),
        reps INTEGER NOT NULL CHECK(reps > 0),
        sets INTEGER NOT NULL CHECK(sets > 0),
        rep_out_target INTEGER NOT NULL CHECK(rep_out_target >= 0),
        calculated_weight REAL,
        UNIQUE(exercise_id, week_number, set_number)
      );
      INSERT INTO week_settings_new (id, exercise_id, week_number, set_number, intensity_pct, reps, sets, rep_out_target, calculated_weight)
      SELECT id, exercise_id, week_number, 1, intensity_pct, reps, sets, rep_out_target, calculated_weight FROM week_settings;
      DROP TABLE week_settings;
      ALTER TABLE week_settings_new RENAME TO week_settings;
    `);
    db.exec("COMMIT");
    transactionStarted = false;

    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error("week_settings migration produced foreign key violations");
    }
  } catch (error) {
    if (transactionStarted) {
      db.exec("ROLLBACK");
    }
    throw error;
  } finally {
    if (restoreForeignKeys) {
      db.pragma("foreign_keys = ON");
    }
  }
}

function createSessionsTable(db: Database.Database, tableName = "sessions"): void {
  db.exec(`
    CREATE TABLE ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day_id INTEGER REFERENCES days(id) ON DELETE SET NULL,
      program_definition_id INTEGER REFERENCES program_definitions(id) ON DELETE SET NULL,
      program_definition_day_id INTEGER REFERENCES program_definition_days(id) ON DELETE SET NULL,
      program_run_id INTEGER REFERENCES program_runs(id) ON DELETE SET NULL,
      program_name TEXT NOT NULL DEFAULT '',
      day_name TEXT NOT NULL DEFAULT '',
      week_number INTEGER NOT NULL CHECK(week_number > 0),
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed','skipped')),
      skipped_at TEXT,
      skip_reason TEXT NOT NULL DEFAULT '',
      shared_program_version_id INTEGER REFERENCES shared_program_versions(id),
      scheduled_date TEXT,
      date TEXT NOT NULL DEFAULT (date('now')),
      UNIQUE(program_id, user_id, day_id, week_number, date)
    );
  `);
}

function createSessionSetsTable(db: Database.Database, tableName = "session_sets"): void {
  db.exec(`
    CREATE TABLE ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      week_setting_id INTEGER REFERENCES week_settings(id) ON DELETE SET NULL,
      program_definition_week_setting_id INTEGER REFERENCES program_definition_week_settings(id) ON DELETE SET NULL,
      program_definition_exercise_id INTEGER REFERENCES program_definition_exercises(id) ON DELETE SET NULL,
      shared_exercise_key TEXT,
      exercise_name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'main' CHECK(category IN ('main','aux','accessory')),
      progression_type TEXT NOT NULL DEFAULT 'custom',
      superset_group TEXT,
      week_number INTEGER NOT NULL DEFAULT 1 CHECK(week_number > 0),
      set_number INTEGER NOT NULL DEFAULT 1,
      intensity_pct REAL NOT NULL DEFAULT 0 CHECK(intensity_pct >= 0 AND intensity_pct <= 1),
      reps INTEGER NOT NULL DEFAULT 1 CHECK(reps > 0),
      sets INTEGER NOT NULL DEFAULT 1 CHECK(sets > 0),
      rep_out_target INTEGER NOT NULL DEFAULT 0 CHECK(rep_out_target >= 0),
      calculated_weight REAL,
      training_max REAL CHECK(training_max IS NULL OR training_max > 0),
      auto_progression_enabled INTEGER NOT NULL DEFAULT 0,
      actual_reps INTEGER,
      actual_weight REAL,
      tm_delta_applied REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      UNIQUE(session_id, program_definition_week_setting_id, set_number),
      UNIQUE(session_id, week_setting_id)
    );
  `);
}

function sessionSetsNeedNativeSnapshotRebuild(db: Database.Database): boolean {
  const columns = db.prepare("PRAGMA table_info(session_sets)").all() as {
    name: string;
    notnull: number;
  }[];
  const weekSettingColumn = columns.find((column) => column.name === "week_setting_id");

  return (
    weekSettingColumn?.notnull === 1 ||
    !columns.some((column) => column.name === "program_definition_week_setting_id") ||
    !columns.some((column) => column.name === "exercise_name") ||
    !columns.some((column) => column.name === "calculated_weight") ||
    !columns.some((column) => column.name === "training_max")
  );
}

function ensureSessionSetsUseNativeSnapshots(db: Database.Database): void {
  if (!hasTable(db, "session_sets")) {
    createSessionSetsTable(db);
    return;
  }

  if (!sessionSetsNeedNativeSnapshotRebuild(db)) {
    return;
  }

  const foreignKeyState = db.pragma("foreign_keys") as { foreign_keys: number }[];
  const restoreForeignKeys = foreignKeyState[0]?.foreign_keys === 1;
  let transactionStarted = false;

  if (restoreForeignKeys) {
    db.pragma("foreign_keys = OFF");
  }

  try {
    db.exec("DROP TABLE IF EXISTS session_sets_new");
    db.exec("BEGIN");
    transactionStarted = true;
    createSessionSetsTable(db, "session_sets_new");
    db.exec(`
      INSERT OR IGNORE INTO session_sets_new (
        id,
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
        auto_progression_enabled,
        actual_reps,
        actual_weight,
        tm_delta_applied,
        notes
      )
      SELECT
        ss.id,
        ss.session_id,
        ss.week_setting_id,
        pdws.id,
        pde.id,
        e.shared_exercise_key,
        COALESCE(e.name, ''),
        COALESCE(e.category, 'main'),
        COALESCE(e.progression_type, 'custom'),
        e.superset_group,
        COALESCE(ws.week_number, 1),
        COALESCE(ws.set_number, 1),
        COALESCE(ws.intensity_pct, 0),
        COALESCE(ws.reps, 1),
        COALESCE(ws.sets, 1),
        COALESCE(ws.rep_out_target, 0),
        ws.calculated_weight,
        e.training_max,
        COALESCE(e.auto_progression_enabled, 0),
        ss.actual_reps,
        ss.actual_weight,
        ss.tm_delta_applied,
        ss.notes
      FROM session_sets ss
      LEFT JOIN week_settings ws ON ws.id = ss.week_setting_id
      LEFT JOIN exercises e ON e.id = ws.exercise_id
      LEFT JOIN days d ON d.id = e.day_id
      LEFT JOIN programs p ON p.id = d.program_id
      LEFT JOIN program_definition_exercises pde
        ON pde.stable_key = e.shared_exercise_key
       AND pde.program_definition_day_id IN (
          SELECT id
          FROM program_definition_days
          WHERE program_definition_id = p.program_definition_id
       )
      LEFT JOIN program_definition_week_settings pdws
        ON pdws.program_definition_exercise_id = pde.id
       AND pdws.week_number = ws.week_number
       AND pdws.set_number = ws.set_number;

      DROP TABLE session_sets;
      ALTER TABLE session_sets_new RENAME TO session_sets;
    `);
    db.exec("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      db.exec("ROLLBACK");
    }
    throw error;
  } finally {
    if (restoreForeignKeys) {
      db.pragma("foreign_keys = ON");
    }
  }
}

function sessionsNeedDurableContextRebuild(db: Database.Database): boolean {
  const columns = db.prepare("PRAGMA table_info(sessions)").all() as {
    name: string;
    notnull: number;
  }[];
  const foreignKeys = db.prepare("PRAGMA foreign_key_list(sessions)").all() as {
    from: string;
    on_delete: string;
  }[];
  const programColumn = columns.find((column) => column.name === "program_id");
  const dayColumn = columns.find((column) => column.name === "day_id");
  const definitionDayColumn = columns.find((column) => column.name === "program_definition_day_id");
  const programForeignKey = foreignKeys.find((foreignKey) => foreignKey.from === "program_id");
  const dayForeignKey = foreignKeys.find((foreignKey) => foreignKey.from === "day_id");

  return (
    programColumn?.notnull === 1 ||
    dayColumn?.notnull === 1 ||
    !definitionDayColumn ||
    programForeignKey?.on_delete !== "SET NULL" ||
    dayForeignKey?.on_delete !== "SET NULL"
  );
}

function ensureSessionsUseDurableContext(db: Database.Database): void {
  if (!sessionsNeedDurableContextRebuild(db)) {
    return;
  }

  const foreignKeyState = db.pragma("foreign_keys") as { foreign_keys: number }[];
  const restoreForeignKeys = foreignKeyState[0]?.foreign_keys === 1;
  let transactionStarted = false;

  if (restoreForeignKeys) {
    db.pragma("foreign_keys = OFF");
  }

  try {
    db.exec("DROP TABLE IF EXISTS sessions_new");
    db.exec("BEGIN");
    transactionStarted = true;
    createSessionsTable(db, "sessions_new");
    db.exec(`
      INSERT INTO sessions_new (
        id,
        program_id,
        user_id,
        day_id,
        program_definition_id,
        program_definition_day_id,
        program_run_id,
        program_name,
        day_name,
        week_number,
        completed,
        completed_at,
        status,
        skipped_at,
        skip_reason,
        shared_program_version_id,
        scheduled_date,
        date
      )
      SELECT
        id,
        program_id,
        user_id,
        day_id,
        program_definition_id,
        (
          SELECT pdd.id
          FROM program_definition_days pdd
          JOIN days d ON d.shared_day_key = pdd.stable_key
          WHERE d.id = sessions.day_id
            AND pdd.program_definition_id = sessions.program_definition_id
          LIMIT 1
        ),
        program_run_id,
        program_name,
        day_name,
        week_number,
        completed,
        completed_at,
        status,
        skipped_at,
        skip_reason,
        shared_program_version_id,
        scheduled_date,
        date
      FROM sessions;

      DROP TABLE sessions;
      ALTER TABLE sessions_new RENAME TO sessions;
    `);
    db.exec("COMMIT");
    transactionStarted = false;

    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error("sessions migration produced foreign key violations");
    }
  } catch (error) {
    if (transactionStarted) {
      db.exec("ROLLBACK");
    }
    throw error;
  } finally {
    if (restoreForeignKeys) {
      db.pragma("foreign_keys = ON");
    }
  }
}

function createSessionTriggers(db: Database.Database): void {
  dropSessionTriggers(db);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS sessions_set_shared_program_version_after_insert
    AFTER INSERT ON sessions
    FOR EACH ROW
    WHEN NEW.shared_program_version_id IS NULL
    BEGIN
      UPDATE sessions
      SET shared_program_version_id = (
        SELECT shared_program_version_id
        FROM programs
        WHERE programs.id = NEW.program_id
      )
      WHERE id = NEW.id
        AND shared_program_version_id IS NULL;
    END;

    CREATE TRIGGER IF NOT EXISTS sessions_set_program_context_after_insert
    AFTER INSERT ON sessions
    FOR EACH ROW
    WHEN NEW.program_definition_id IS NULL
      OR NEW.program_run_id IS NULL
      OR NEW.program_name = ''
      OR NEW.day_name = ''
    BEGIN
      UPDATE sessions
      SET program_definition_id = COALESCE(
            NEW.program_definition_id,
            (SELECT program_definition_id FROM programs WHERE programs.id = NEW.program_id)
          ),
          program_run_id = COALESCE(
            NEW.program_run_id,
            (SELECT program_run_id FROM programs WHERE programs.id = NEW.program_id)
          ),
          program_name = COALESCE(
            NULLIF(NEW.program_name, ''),
            (SELECT name FROM programs WHERE programs.id = NEW.program_id),
            ''
          ),
          day_name = COALESCE(
            NULLIF(NEW.day_name, ''),
            (SELECT name FROM program_definition_days WHERE program_definition_days.id = NEW.program_definition_day_id),
            (SELECT name FROM days WHERE days.id = NEW.day_id),
            ''
          )
      WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS sessions_set_status_after_completed_update
    AFTER UPDATE OF completed ON sessions
    FOR EACH ROW
    WHEN NEW.completed = 1 AND NEW.status != 'completed'
    BEGIN
      UPDATE sessions
      SET status = 'completed',
          completed_at = COALESCE(NEW.completed_at, datetime('now'))
      WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS sessions_set_completed_after_status_update
    AFTER UPDATE OF status ON sessions
    FOR EACH ROW
    WHEN NEW.status = 'completed' AND NEW.completed != 1
    BEGIN
      UPDATE sessions
      SET completed = 1,
          completed_at = COALESCE(NEW.completed_at, datetime('now'))
      WHERE id = NEW.id;
    END;
  `);
}

function dropSessionTriggers(db: Database.Database): void {
  db.exec(`
    DROP TRIGGER IF EXISTS sessions_set_shared_program_version_after_insert;
    DROP TRIGGER IF EXISTS sessions_set_program_context_after_insert;
    DROP TRIGGER IF EXISTS sessions_set_status_after_completed_update;
    DROP TRIGGER IF EXISTS sessions_set_completed_after_status_update;
  `);
}

function createUserTrainingTemplatesTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_training_templates (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      weeks_json TEXT NOT NULL,
      rule_json TEXT NOT NULL,
      auto_progression INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_user_training_templates_user ON user_training_templates(user_id);
  `);
}

export function runMigrations(db: Database.Database): void {
  dropSessionTriggers(db);
  createProgramDefinitionRunTables(db);
  createUserTrainingTemplatesTable(db);
  addColumn(db, "programs", "shared_program_id INTEGER REFERENCES shared_programs(id)");
  addColumn(db, "programs", "shared_program_version_id INTEGER REFERENCES shared_program_versions(id)");
  addColumn(db, "programs", "program_definition_id INTEGER REFERENCES program_definitions(id) ON DELETE SET NULL");
  addColumn(db, "programs", "program_run_id INTEGER REFERENCES program_runs(id) ON DELETE SET NULL");
  addColumn(db, "programs", "archived_at TEXT");
  addColumn(db, "programs", "schedule_weekdays TEXT NOT NULL DEFAULT '[]'");
  addColumn(
    db,
    "programs",
    "schedule_mode TEXT NOT NULL DEFAULT 'unscheduled' CHECK(schedule_mode IN ('unscheduled','scheduled'))",
  );
  addColumn(db, "programs", "is_active INTEGER NOT NULL DEFAULT 1");
  db.exec("UPDATE programs SET is_active = 1 WHERE is_active IS NULL");
  addColumn(db, "days", "shared_day_key TEXT");
  addColumn(db, "days", "archived_at TEXT");
  addColumn(db, "exercises", "shared_exercise_key TEXT");
  addColumn(db, "exercises", "archived_at TEXT");
  addColumn(db, "exercises", "superset_group TEXT");
  ensureWeekSettingsSupportsSetNumber(db);
  addColumn(db, "sessions", "program_definition_id INTEGER REFERENCES program_definitions(id) ON DELETE SET NULL");
  addColumn(db, "sessions", "program_definition_day_id INTEGER REFERENCES program_definition_days(id) ON DELETE SET NULL");
  addColumn(db, "sessions", "program_run_id INTEGER REFERENCES program_runs(id) ON DELETE SET NULL");
  addColumn(db, "sessions", "program_name TEXT NOT NULL DEFAULT ''");
  addColumn(db, "sessions", "day_name TEXT NOT NULL DEFAULT ''");
  addColumn(
    db,
    "sessions",
    "status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed','skipped'))",
  );
  addColumn(db, "sessions", "skipped_at TEXT");
  addColumn(db, "sessions", "skip_reason TEXT NOT NULL DEFAULT ''");
  addColumn(db, "sessions", "shared_program_version_id INTEGER REFERENCES shared_program_versions(id)");
  addColumn(db, "sessions", "scheduled_date TEXT");
  // Per-week absolute weight override for manual exercises. NULL = derive from
  // training_max × intensity_pct (the default for auto-progressing templates).
  addColumn(db, "program_definition_week_settings", "weight REAL");
  ensureSessionsUseDurableContext(db);
  ensureSessionSetsUseNativeSnapshots(db);
  db.exec(`
    UPDATE sessions
    SET status = CASE WHEN completed = 1 THEN 'completed' ELSE 'in_progress' END
    WHERE status = 'in_progress';

    UPDATE sessions
    SET shared_program_version_id = (
      SELECT programs.shared_program_version_id
      FROM programs
      WHERE programs.id = sessions.program_id
    )
    WHERE shared_program_version_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM programs
        WHERE programs.id = sessions.program_id
          AND programs.shared_program_version_id IS NOT NULL
      );
  `);
  ensureExerciseMaxHistoryTable(db);
  backfillProgramDefinitionsAndRuns(db);
  createSessionTriggers(db);
  dedupeInProgressQuickWorkouts(db);
  createPerformanceIndexes(db);
}

/** Quick Workouts are program-less in-progress sessions; there should be at most
 *  one per user per day. getQuickWorkoutForToday only ever surfaces the newest
 *  (ORDER BY id DESC), so any older same-day in-progress duplicate is already
 *  invisible/orphaned — remove it so the partial unique index below can be
 *  created safely. Runs before createPerformanceIndexes for that reason. */
function dedupeInProgressQuickWorkouts(db: Database.Database): void {
  db.exec(`
    DELETE FROM sessions
    WHERE program_id IS NULL
      AND status = 'in_progress'
      AND id NOT IN (
        SELECT MAX(id) FROM sessions
        WHERE program_id IS NULL AND status = 'in_progress'
        GROUP BY user_id, date
      );
  `);
}

function createPerformanceIndexes(db: Database.Database): void {
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions(user_id, date)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_user_run_date ON sessions(user_id, program_run_id, date)",
    // Stats aggregates scan a user's completed sessions; this drives that + date windows.
    "CREATE INDEX IF NOT EXISTS idx_sessions_user_status_date ON sessions(user_id, status, date)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_unique_definition_day ON sessions(program_run_id, user_id, program_definition_day_id, week_number, date) WHERE program_definition_day_id IS NOT NULL",
    // At most one in-progress Quick Workout (program-less session) per user per
    // day — the DB-level guard behind POST /api/sessions' find-or-create.
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_unique_quick_in_progress ON sessions(user_id, date) WHERE program_id IS NULL AND status = 'in_progress'",
    "CREATE INDEX IF NOT EXISTS idx_exercises_day_archived ON exercises(day_id, archived_at)",
    "CREATE INDEX IF NOT EXISTS idx_days_program_archived ON days(program_id, archived_at)",
    "CREATE INDEX IF NOT EXISTS idx_week_settings_exercise_week ON week_settings(exercise_id, week_number)",
    "CREATE INDEX IF NOT EXISTS idx_shared_program_members_user ON shared_program_members(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_program_definitions_owner ON program_definitions(owner_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_program_runs_user_status ON program_runs(user_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_program_run_holds_user_range ON program_run_holds(user_id, program_run_id, start_date, end_date)",
  ];
  for (const sql of indexes) {
    db.exec(sql);
  }
}
