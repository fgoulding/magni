import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../migrations";

let dbModule: typeof import("../index");

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workout-db-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  dbModule = await import("../index");
});

describe("database schema", () => {
  it("adds week setting set numbers without breaking existing session set references", () => {
    const legacyDb = new Database(":memory:");
    legacyDb.pragma("foreign_keys = ON");
    legacyDb.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE shared_programs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        active_version_id INTEGER
      );
      CREATE TABLE shared_program_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shared_program_id INTEGER NOT NULL REFERENCES shared_programs(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        published_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        snapshot_json TEXT NOT NULL
      );
      CREATE TABLE shared_program_members (
        shared_program_id INTEGER NOT NULL REFERENCES shared_programs(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        PRIMARY KEY (shared_program_id, user_id)
      );
      CREATE TABLE shared_program_expected_maxes (
        shared_program_id INTEGER NOT NULL REFERENCES shared_programs(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        shared_exercise_key TEXT NOT NULL,
        expected_max REAL NOT NULL,
        PRIMARY KEY (shared_program_id, user_id, shared_exercise_key)
      );
      CREATE TABLE shared_program_applied_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shared_program_id INTEGER NOT NULL REFERENCES shared_programs(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        local_program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
        version_id INTEGER NOT NULL REFERENCES shared_program_versions(id) ON DELETE RESTRICT,
        action TEXT NOT NULL
      );
      CREATE TABLE programs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        num_weeks INTEGER NOT NULL DEFAULT 7,
        current_week INTEGER NOT NULL DEFAULT 1,
        current_day INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE days (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        day_number INTEGER NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE(program_id, day_number)
      );
      CREATE TABLE exercises (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day_id INTEGER NOT NULL REFERENCES days(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        training_max REAL NOT NULL,
        category TEXT NOT NULL DEFAULT 'main',
        progression_type TEXT NOT NULL DEFAULT 'custom',
        auto_progression_enabled INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE week_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
        week_number INTEGER NOT NULL,
        intensity_pct REAL NOT NULL,
        reps INTEGER NOT NULL,
        sets INTEGER NOT NULL,
        rep_out_target INTEGER NOT NULL,
        calculated_weight REAL,
        UNIQUE(exercise_id, week_number)
      );
      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day_id INTEGER NOT NULL REFERENCES days(id) ON DELETE CASCADE,
        week_number INTEGER NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT,
        date TEXT NOT NULL DEFAULT (date('now'))
      );
      CREATE TABLE session_sets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        week_setting_id INTEGER NOT NULL REFERENCES week_settings(id) ON DELETE RESTRICT,
        actual_reps INTEGER,
        actual_weight REAL,
        tm_delta_applied REAL NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        UNIQUE(session_id, week_setting_id)
      );
      CREATE TABLE user_settings (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (user_id, key)
      );

      INSERT INTO users (email, password_hash) VALUES ('legacy@example.com', 'hash');
      INSERT INTO programs (user_id, name) VALUES (1, 'Legacy');
      INSERT INTO days (program_id, name, day_number) VALUES (1, 'Lower', 1);
      INSERT INTO exercises (day_id, name, training_max) VALUES (1, 'Squat', 300);
      INSERT INTO week_settings (exercise_id, week_number, intensity_pct, reps, sets, rep_out_target, calculated_weight)
      VALUES (1, 1, 0.7, 5, 3, 8, 210);
      INSERT INTO sessions (program_id, user_id, day_id, week_number, completed) VALUES (1, 1, 1, 1, 1);
      INSERT INTO session_sets (session_id, week_setting_id, actual_reps, actual_weight) VALUES (1, 1, 8, 225);
    `);

    expect(() => runMigrations(legacyDb)).not.toThrow();
    expect(legacyDb.prepare("SELECT id, set_number FROM week_settings").all()).toEqual([{ id: 1, set_number: 1 }]);
    expect(legacyDb.prepare("SELECT session_id, week_setting_id FROM session_sets").all()).toEqual([
      { session_id: 1, week_setting_id: 1 },
    ]);
    expect(legacyDb.prepare("SELECT schedule_weekdays, schedule_mode FROM programs WHERE id = 1").get()).toEqual({
      schedule_weekdays: "[]",
      schedule_mode: "unscheduled",
    });
    const migratedProgram = legacyDb
      .prepare("SELECT program_definition_id, program_run_id FROM programs WHERE id = 1")
      .get() as { program_definition_id: number; program_run_id: number };
    expect(migratedProgram.program_definition_id).toEqual(expect.any(Number));
    expect(migratedProgram.program_run_id).toEqual(expect.any(Number));
    expect(
      legacyDb
        .prepare("SELECT owner_user_id, name, source_type, visibility FROM program_definitions WHERE id = ?")
        .get(migratedProgram.program_definition_id),
    ).toEqual({ owner_user_id: 1, name: "Legacy", source_type: "custom", visibility: "private" });
    expect(
      legacyDb
        .prepare("SELECT user_id, program_definition_id, name, status, current_week, current_day, schedule_weekdays, schedule_mode FROM program_runs WHERE id = ?")
        .get(migratedProgram.program_run_id),
    ).toEqual({
      user_id: 1,
      program_definition_id: migratedProgram.program_definition_id,
      name: "Legacy",
      status: "active",
      current_week: 1,
      current_day: 1,
      schedule_weekdays: "[]",
      schedule_mode: "unscheduled",
    });
    expect(
      legacyDb
        .prepare("SELECT program_definition_id, program_run_id, program_name, day_name FROM sessions WHERE id = 1")
        .get(),
    ).toEqual({
      program_definition_id: migratedProgram.program_definition_id,
      program_run_id: migratedProgram.program_run_id,
      program_name: "Legacy",
      day_name: "Lower",
    });
    expect(legacyDb.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    legacyDb.close();
  });

  it("creates the required application tables", () => {
    const rows = dbModule.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];

    expect(rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "auth_sessions",
        "days",
        "exercises",
        "programs",
        "session_sets",
        "sessions",
        "user_settings",
        "users",
        "week_settings",
      ]),
    );
  });

  it("creates shared program tables", () => {
    const tables = dbModule.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];

    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "shared_programs",
        "shared_program_members",
        "shared_program_versions",
        "shared_program_expected_maxes",
        "shared_program_applied_versions",
      ]),
    );
  });

  it("creates program definition and run tables", () => {
    const tables = dbModule.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const programColumns = dbModule.db.prepare("PRAGMA table_info(programs)").all() as { name: string }[];
    const sessionColumns = dbModule.db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];

    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "program_definitions",
        "program_definition_days",
        "program_definition_exercises",
        "program_definition_week_settings",
        "program_runs",
        "program_run_schedule_days",
        "program_run_expected_maxes",
      ]),
    );
    expect(programColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["program_definition_id", "program_run_id"]),
    );
    expect(sessionColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["program_definition_id", "program_run_id", "program_name", "day_name"]),
    );
  });

  it("adds shared sync columns to private runnable rows", () => {
    const programColumns = dbModule.db.prepare("PRAGMA table_info(programs)").all() as { name: string }[];
    const dayColumns = dbModule.db.prepare("PRAGMA table_info(days)").all() as { name: string }[];
    const exerciseColumns = dbModule.db.prepare("PRAGMA table_info(exercises)").all() as { name: string }[];

    expect(programColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["shared_program_id", "shared_program_version_id", "archived_at"]),
    );
    expect(dayColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["shared_day_key", "archived_at"]),
    );
    expect(exerciseColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["shared_exercise_key", "archived_at"]),
    );
  });

  it("stores schedule bridge fields on programs", () => {
    const programColumns = dbModule.db.prepare("PRAGMA table_info(programs)").all() as {
      name: string;
      dflt_value: string | null;
      notnull: number;
    }[];

    expect(programColumns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "schedule_weekdays", dflt_value: "'[]'", notnull: 1 }),
        expect.objectContaining({ name: "schedule_mode", dflt_value: "'unscheduled'", notnull: 1 }),
      ]),
    );
  });

  it("keeps sessions versioned and skippable while preserving reorder columns", () => {
    const sessionColumns = dbModule.db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
    const dayColumns = dbModule.db.prepare("PRAGMA table_info(days)").all() as { name: string }[];
    const exerciseColumns = dbModule.db.prepare("PRAGMA table_info(exercises)").all() as { name: string }[];
    const sessionForeignKeys = dbModule.db.prepare("PRAGMA foreign_key_list(sessions)").all() as {
      from: string;
      table: string;
      to: string;
      on_delete: string;
    }[];

    expect(sessionColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["status", "skipped_at", "skip_reason", "shared_program_version_id", "scheduled_date"]),
    );
    expect(dayColumns.map((column) => column.name)).toEqual(expect.arrayContaining(["sort_order"]));
    expect(exerciseColumns.map((column) => column.name)).toEqual(expect.arrayContaining(["sort_order"]));
    expect(sessionForeignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "shared_program_version_id", table: "shared_program_versions", to: "id" }),
        expect.objectContaining({ from: "program_id", table: "programs", to: "id", on_delete: "SET NULL" }),
        expect.objectContaining({ from: "day_id", table: "days", to: "id", on_delete: "SET NULL" }),
      ]),
    );
  });

  it("keeps user sessions if referenced program and day rows are removed", () => {
    const user = dbModule.db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run("durable-session-context@example.com", "hash");
    const program = dbModule.db
      .prepare("INSERT INTO programs (user_id, name) VALUES (?, ?)")
      .run(user.lastInsertRowid, "Durable Program");
    const day = dbModule.db
      .prepare("INSERT INTO days (program_id, name, day_number) VALUES (?, ?, ?)")
      .run(program.lastInsertRowid, "Lower", 1);
    const session = dbModule.db
      .prepare(
        "INSERT INTO sessions (program_id, user_id, day_id, week_number, status, program_name, day_name) VALUES (?, ?, ?, 1, 'completed', ?, ?)",
      )
      .run(program.lastInsertRowid, user.lastInsertRowid, day.lastInsertRowid, "Durable Program", "Lower");

    dbModule.db.prepare("DELETE FROM programs WHERE id = ?").run(program.lastInsertRowid);

    expect(
      dbModule.db.prepare("SELECT user_id, program_id, day_id, program_name, day_name FROM sessions WHERE id = ?").get(
        session.lastInsertRowid,
      ),
    ).toEqual({
      user_id: user.lastInsertRowid,
      program_id: null,
      day_id: null,
      program_name: "Durable Program",
      day_name: "Lower",
    });
  });

  it("stores exercise max history with set and session context", () => {
    const user = dbModule.db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run("history@example.com", "hash");
    const program = dbModule.db
      .prepare("INSERT INTO programs (user_id, name) VALUES (?, ?)")
      .run(user.lastInsertRowid, "Program");
    const sharedProgram = dbModule.db
      .prepare("INSERT INTO shared_programs (owner_user_id, name) VALUES (?, ?)")
      .run(user.lastInsertRowid, "Shared Program");
    const day = dbModule.db
      .prepare("INSERT INTO days (program_id, name, day_number) VALUES (?, ?, ?)")
      .run(program.lastInsertRowid, "Day 1", 1);
    const exercise = dbModule.db
      .prepare("INSERT INTO exercises (day_id, name, training_max, shared_exercise_key) VALUES (?, ?, ?, ?)")
      .run(day.lastInsertRowid, "Squat", 300, "squat");
    const weekSetting = dbModule.db
      .prepare(
        "INSERT INTO week_settings (exercise_id, week_number, intensity_pct, reps, sets, rep_out_target) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(exercise.lastInsertRowid, 1, 0.7, 5, 5, 10);
    const session = dbModule.db
      .prepare("INSERT INTO sessions (program_id, user_id, day_id, week_number) VALUES (?, ?, ?, ?)")
      .run(program.lastInsertRowid, user.lastInsertRowid, day.lastInsertRowid, 1);
    const sessionSet = dbModule.db
      .prepare("INSERT INTO session_sets (session_id, week_setting_id, actual_reps, actual_weight) VALUES (?, ?, ?, ?)")
      .run(session.lastInsertRowid, weekSetting.lastInsertRowid, 8, 225);

    dbModule.db
      .prepare(
        `INSERT INTO exercise_max_history (
          user_id,
          exercise_id,
          shared_program_id,
          shared_exercise_key,
          session_id,
          session_set_id,
          training_max,
          working_weight,
          actual_reps,
          implied_max,
          source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.lastInsertRowid,
        exercise.lastInsertRowid,
        sharedProgram.lastInsertRowid,
        "squat",
        session.lastInsertRowid,
        sessionSet.lastInsertRowid,
        315,
        225,
        8,
        285,
        "set",
      );

    const history = dbModule.db.prepare("SELECT * FROM exercise_max_history").get() as {
      user_id: number;
      exercise_id: number;
      shared_program_id: number;
      shared_exercise_key: string;
      session_id: number;
      session_set_id: number;
      training_max: number;
      working_weight: number;
      actual_reps: number;
      implied_max: number;
      source: string;
    };

    expect(history).toEqual(
      expect.objectContaining({
        user_id: user.lastInsertRowid,
        exercise_id: exercise.lastInsertRowid,
        shared_program_id: sharedProgram.lastInsertRowid,
        shared_exercise_key: "squat",
        session_id: session.lastInsertRowid,
        session_set_id: sessionSet.lastInsertRowid,
        training_max: 315,
        working_weight: 225,
        actual_reps: 8,
        implied_max: 285,
        source: "set",
      }),
    );
  });

  it("inherits a program shared version when inserting sessions without an explicit version", () => {
    const user = dbModule.db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run("session-version@example.com", "hash");
    const sharedProgram = dbModule.db
      .prepare("INSERT INTO shared_programs (owner_user_id, name) VALUES (?, ?)")
      .run(user.lastInsertRowid, "Shared Program");
    const firstVersion = dbModule.db
      .prepare(
        "INSERT INTO shared_program_versions (shared_program_id, version_number, published_by_user_id, snapshot_json) VALUES (?, ?, ?, ?)",
      )
      .run(sharedProgram.lastInsertRowid, 1, user.lastInsertRowid, "{}");
    const secondVersion = dbModule.db
      .prepare(
        "INSERT INTO shared_program_versions (shared_program_id, version_number, published_by_user_id, snapshot_json) VALUES (?, ?, ?, ?)",
      )
      .run(sharedProgram.lastInsertRowid, 2, user.lastInsertRowid, "{}");
    const program = dbModule.db
      .prepare(
        "INSERT INTO programs (user_id, name, shared_program_id, shared_program_version_id) VALUES (?, ?, ?, ?)",
      )
      .run(user.lastInsertRowid, "Program", sharedProgram.lastInsertRowid, firstVersion.lastInsertRowid);
    const day = dbModule.db
      .prepare("INSERT INTO days (program_id, name, day_number) VALUES (?, ?, ?)")
      .run(program.lastInsertRowid, "Day 1", 1);
    const inheritedSession = dbModule.db
      .prepare("INSERT INTO sessions (program_id, user_id, day_id, week_number) VALUES (?, ?, ?, ?)")
      .run(program.lastInsertRowid, user.lastInsertRowid, day.lastInsertRowid, 1);
    const explicitSession = dbModule.db
      .prepare(
        "INSERT INTO sessions (program_id, user_id, day_id, week_number, shared_program_version_id, date) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(program.lastInsertRowid, user.lastInsertRowid, day.lastInsertRowid, 2, secondVersion.lastInsertRowid, "2000-02-02");

    const sessions = dbModule.db
      .prepare("SELECT id, shared_program_version_id FROM sessions WHERE id IN (?, ?) ORDER BY id")
      .all(inheritedSession.lastInsertRowid, explicitSession.lastInsertRowid) as {
      id: number;
      shared_program_version_id: number;
    }[];

    expect(sessions).toEqual([
      { id: inheritedSession.lastInsertRowid, shared_program_version_id: firstVersion.lastInsertRowid },
      { id: explicitSession.lastInsertRowid, shared_program_version_id: secondVersion.lastInsertRowid },
    ]);
  });

  it("keeps session status coherent when legacy completion fields change", () => {
    const user = dbModule.db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run("completion-sync@example.com", "hash");
    const program = dbModule.db
      .prepare("INSERT INTO programs (user_id, name) VALUES (?, ?)")
      .run(user.lastInsertRowid, "Program");
    const day = dbModule.db
      .prepare("INSERT INTO days (program_id, name, day_number) VALUES (?, ?, ?)")
      .run(program.lastInsertRowid, "Day 1", 1);
    const completedSession = dbModule.db
      .prepare("INSERT INTO sessions (program_id, user_id, day_id, week_number) VALUES (?, ?, ?, ?)")
      .run(program.lastInsertRowid, user.lastInsertRowid, day.lastInsertRowid, 1);
    const statusSession = dbModule.db
      .prepare("INSERT INTO sessions (program_id, user_id, day_id, week_number, date) VALUES (?, ?, ?, ?, ?)")
      .run(program.lastInsertRowid, user.lastInsertRowid, day.lastInsertRowid, 2, "2000-03-02");

    dbModule.db.prepare("UPDATE sessions SET completed = 1 WHERE id = ?").run(completedSession.lastInsertRowid);
    dbModule.db.prepare("UPDATE sessions SET status = 'completed' WHERE id = ?").run(statusSession.lastInsertRowid);

    const sessions = dbModule.db
      .prepare("SELECT id, completed, completed_at, status FROM sessions WHERE id IN (?, ?) ORDER BY id")
      .all(completedSession.lastInsertRowid, statusSession.lastInsertRowid) as {
      id: number;
      completed: number;
      completed_at: string | null;
      status: string;
    }[];

    expect(sessions).toEqual([
      expect.objectContaining({ id: completedSession.lastInsertRowid, completed: 1, status: "completed" }),
      expect.objectContaining({ id: statusSession.lastInsertRowid, completed: 1, status: "completed" }),
    ]);
    expect(sessions[0].completed_at).not.toBeNull();
    expect(sessions[1].completed_at).not.toBeNull();
  });

  it("keeps max history facts when shared programs are deleted", () => {
    const user = dbModule.db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run("durable-history@example.com", "hash");
    const sharedProgram = dbModule.db
      .prepare("INSERT INTO shared_programs (owner_user_id, name) VALUES (?, ?)")
      .run(user.lastInsertRowid, "Shared Program");
    const sharedVersion = dbModule.db
      .prepare(
        "INSERT INTO shared_program_versions (shared_program_id, version_number, published_by_user_id, snapshot_json) VALUES (?, ?, ?, ?)",
      )
      .run(sharedProgram.lastInsertRowid, 1, user.lastInsertRowid, "{}");
    const history = dbModule.db
      .prepare(
        "INSERT INTO exercise_max_history (user_id, shared_program_id, shared_program_version_id, shared_exercise_key, training_max, source) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(user.lastInsertRowid, sharedProgram.lastInsertRowid, sharedVersion.lastInsertRowid, "squat", 315, "sync");

    dbModule.db.prepare("DELETE FROM shared_programs WHERE id = ?").run(sharedProgram.lastInsertRowid);

    const retainedHistory = dbModule.db.prepare("SELECT * FROM exercise_max_history WHERE id = ?").get(history.lastInsertRowid) as {
      shared_program_id: number | null;
      shared_program_version_id: number | null;
      shared_exercise_key: string;
      training_max: number;
    };

    expect(retainedHistory).toEqual(
      expect.objectContaining({
        shared_program_id: null,
        shared_program_version_id: null,
        shared_exercise_key: "squat",
        training_max: 315,
      }),
    );
  });

  it("rejects max history rows without valid measured values", () => {
    const user = dbModule.db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run("invalid-history@example.com", "hash");

    expect(() => {
      dbModule.db.prepare("INSERT INTO exercise_max_history (user_id, source) VALUES (?, ?)").run(user.lastInsertRowid, "manual");
    }).toThrow();
    expect(() => {
      dbModule.db
        .prepare("INSERT INTO exercise_max_history (user_id, training_max, source) VALUES (?, ?, ?)")
        .run(user.lastInsertRowid, 0, "manual");
    }).toThrow();
    expect(() => {
      dbModule.db
        .prepare("INSERT INTO exercise_max_history (user_id, actual_reps, source) VALUES (?, ?, ?)")
        .run(user.lastInsertRowid, -1, "set");
    }).toThrow();
  });

  it("adds shared sync foreign keys", () => {
    const sharedProgramForeignKeys = dbModule.db.prepare("PRAGMA foreign_key_list(shared_programs)").all() as {
      from: string;
      table: string;
      to: string;
    }[];
    const programForeignKeys = dbModule.db.prepare("PRAGMA foreign_key_list(programs)").all() as {
      from: string;
      table: string;
      to: string;
    }[];

    expect(sharedProgramForeignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "active_version_id", table: "shared_program_versions", to: "id" }),
      ]),
    );
    expect(programForeignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "shared_program_id", table: "shared_programs", to: "id" }),
        expect.objectContaining({ from: "shared_program_version_id", table: "shared_program_versions", to: "id" }),
      ]),
    );
  });

  it("migrates old private schemas without losing data and can run repeatedly", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workout-old-db-"));
    const oldDb = new Database(path.join(dir, "old.db"));

    try {
      oldDb.pragma("foreign_keys = ON");
      oldDb.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE programs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          num_weeks INTEGER NOT NULL DEFAULT 7 CHECK(num_weeks > 0),
          current_week INTEGER NOT NULL DEFAULT 1 CHECK(current_week > 0),
          current_day INTEGER NOT NULL DEFAULT 1 CHECK(current_day > 0),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE days (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          day_number INTEGER NOT NULL CHECK(day_number > 0),
          sort_order INTEGER NOT NULL DEFAULT 0,
          UNIQUE(program_id, day_number)
        );

        CREATE TABLE exercises (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          day_id INTEGER NOT NULL REFERENCES days(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          training_max REAL NOT NULL CHECK(training_max > 0),
          category TEXT NOT NULL DEFAULT 'main' CHECK(category IN ('main','aux','accessory')),
          progression_type TEXT NOT NULL DEFAULT 'custom',
          auto_progression_enabled INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE week_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
          week_number INTEGER NOT NULL CHECK(week_number > 0),
          intensity_pct REAL NOT NULL CHECK(intensity_pct >= 0 AND intensity_pct <= 1),
          reps INTEGER NOT NULL CHECK(reps > 0),
          sets INTEGER NOT NULL CHECK(sets > 0),
          rep_out_target INTEGER NOT NULL CHECK(rep_out_target >= 0),
          calculated_weight REAL,
          UNIQUE(exercise_id, week_number)
        );

        CREATE TABLE sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          day_id INTEGER NOT NULL REFERENCES days(id) ON DELETE CASCADE,
          week_number INTEGER NOT NULL CHECK(week_number > 0),
          completed INTEGER NOT NULL DEFAULT 0,
          completed_at TEXT,
          date TEXT NOT NULL DEFAULT (date('now')),
          UNIQUE(program_id, user_id, day_id, week_number, date)
        );

        CREATE TABLE session_sets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          week_setting_id INTEGER NOT NULL REFERENCES week_settings(id) ON DELETE RESTRICT,
          actual_reps INTEGER,
          actual_weight REAL,
          tm_delta_applied REAL NOT NULL DEFAULT 0,
          notes TEXT NOT NULL DEFAULT '',
          UNIQUE(session_id, week_setting_id)
        );
      `);
      const user = oldDb.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run("old@example.com", "hash");
      const program = oldDb
        .prepare("INSERT INTO programs (user_id, name, current_week, current_day) VALUES (?, ?, ?, ?)")
        .run(user.lastInsertRowid, "Old Program", 3, 2);
      const day = oldDb
        .prepare("INSERT INTO days (program_id, name, day_number) VALUES (?, ?, ?)")
        .run(program.lastInsertRowid, "Old Day", 1);
      oldDb
        .prepare("INSERT INTO exercises (day_id, name, training_max) VALUES (?, ?, ?)")
        .run(day.lastInsertRowid, "Old Squat", 315);
      oldDb
        .prepare("INSERT INTO sessions (program_id, user_id, day_id, week_number, completed) VALUES (?, ?, ?, ?, ?)")
        .run(program.lastInsertRowid, user.lastInsertRowid, day.lastInsertRowid, 1, 1);
      oldDb
        .prepare("INSERT INTO sessions (program_id, user_id, day_id, week_number, completed, date) VALUES (?, ?, ?, ?, ?, ?)")
        .run(program.lastInsertRowid, user.lastInsertRowid, day.lastInsertRowid, 2, 0, "2000-01-02");

      const schema = fs.readFileSync(path.join(process.cwd(), "src", "lib", "db", "schema.sql"), "utf8");
      oldDb.exec(schema);
      runMigrations(oldDb);
      runMigrations(oldDb);

      const migratedProgram = oldDb.prepare("SELECT name, current_week, current_day FROM programs").get() as {
        name: string;
        current_week: number;
        current_day: number;
      };
      const migratedExercise = oldDb.prepare("SELECT name, training_max FROM exercises").get() as {
        name: string;
        training_max: number;
      };
      const migratedSessions = oldDb
        .prepare("SELECT completed, status FROM sessions ORDER BY week_number")
        .all() as { completed: number; status: string }[];
      const programColumns = oldDb.prepare("PRAGMA table_info(programs)").all() as { name: string }[];
      const sessionColumns = oldDb.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
      const programForeignKeys = oldDb.prepare("PRAGMA foreign_key_list(programs)").all() as {
        from: string;
        table: string;
        to: string;
      }[];
      const definitionCount = oldDb.prepare("SELECT COUNT(*) AS count FROM program_definitions").get() as { count: number };
      const runCount = oldDb.prepare("SELECT COUNT(*) AS count FROM program_runs").get() as { count: number };

      expect(migratedProgram).toEqual({ name: "Old Program", current_week: 3, current_day: 2 });
      expect(migratedExercise).toEqual({ name: "Old Squat", training_max: 315 });
      expect(migratedSessions).toEqual([
        { completed: 1, status: "completed" },
        { completed: 0, status: "in_progress" },
      ]);
      expect(programColumns.map((column) => column.name).filter((name) => name === "shared_program_id")).toHaveLength(1);
      expect(programColumns.map((column) => column.name).filter((name) => name === "shared_program_version_id")).toHaveLength(1);
      expect(sessionColumns.map((column) => column.name).filter((name) => name === "status")).toHaveLength(1);
      expect(sessionColumns.map((column) => column.name).filter((name) => name === "skipped_at")).toHaveLength(1);
      expect(sessionColumns.map((column) => column.name).filter((name) => name === "skip_reason")).toHaveLength(1);
      expect(
        sessionColumns.map((column) => column.name).filter((name) => name === "shared_program_version_id"),
      ).toHaveLength(1);
      expect(definitionCount.count).toBe(1);
      expect(runCount.count).toBe(1);
      expect(programForeignKeys).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ from: "shared_program_id", table: "shared_programs", to: "id" }),
          expect.objectContaining({ from: "shared_program_version_id", table: "shared_program_versions", to: "id" }),
        ]),
      );
    } finally {
      oldDb.close();
    }
  });

  it("backfills existing session version context from programs during migrations", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workout-session-version-db-"));
    const versionDb = new Database(path.join(dir, "session-version.db"));

    try {
      versionDb.pragma("foreign_keys = ON");
      const schema = fs.readFileSync(path.join(process.cwd(), "src", "lib", "db", "schema.sql"), "utf8");
      versionDb.exec(schema);
      const user = versionDb
        .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
        .run("version-backfill@example.com", "hash");
      const sharedProgram = versionDb
        .prepare("INSERT INTO shared_programs (owner_user_id, name) VALUES (?, ?)")
        .run(user.lastInsertRowid, "Shared Program");
      const sharedVersion = versionDb
        .prepare(
          "INSERT INTO shared_program_versions (shared_program_id, version_number, published_by_user_id, snapshot_json) VALUES (?, ?, ?, ?)",
        )
        .run(sharedProgram.lastInsertRowid, 1, user.lastInsertRowid, "{}");
      const program = versionDb
        .prepare(
          "INSERT INTO programs (user_id, name, shared_program_id, shared_program_version_id) VALUES (?, ?, ?, ?)",
        )
        .run(user.lastInsertRowid, "Program", sharedProgram.lastInsertRowid, sharedVersion.lastInsertRowid);
      const day = versionDb
        .prepare("INSERT INTO days (program_id, name, day_number) VALUES (?, ?, ?)")
        .run(program.lastInsertRowid, "Day 1", 1);
      const session = versionDb
        .prepare("INSERT INTO sessions (program_id, user_id, day_id, week_number) VALUES (?, ?, ?, ?)")
        .run(program.lastInsertRowid, user.lastInsertRowid, day.lastInsertRowid, 1);

      versionDb
        .prepare("UPDATE sessions SET shared_program_version_id = NULL WHERE id = ?")
        .run(session.lastInsertRowid);
      runMigrations(versionDb);
      runMigrations(versionDb);

      const migratedSession = versionDb
        .prepare("SELECT shared_program_version_id FROM sessions WHERE id = ?")
        .get(session.lastInsertRowid) as { shared_program_version_id: number };

      expect(migratedSession.shared_program_version_id).toBe(sharedVersion.lastInsertRowid);
    } finally {
      versionDb.close();
    }
  });

  it("snapshots session program and day context when sessions are inserted", () => {
    const user = dbModule.db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run("session-context@example.com", "hash");
    const definition = dbModule.db
      .prepare("INSERT INTO program_definitions (owner_user_id, name) VALUES (?, ?)")
      .run(user.lastInsertRowid, "Snapshot Program");
    const run = dbModule.db
      .prepare("INSERT INTO program_runs (user_id, program_definition_id, name) VALUES (?, ?, ?)")
      .run(user.lastInsertRowid, definition.lastInsertRowid, "Snapshot Program");
    const program = dbModule.db
      .prepare("INSERT INTO programs (user_id, name, program_definition_id, program_run_id) VALUES (?, ?, ?, ?)")
      .run(user.lastInsertRowid, "Snapshot Program", definition.lastInsertRowid, run.lastInsertRowid);
    const day = dbModule.db
      .prepare("INSERT INTO days (program_id, name, day_number) VALUES (?, ?, ?)")
      .run(program.lastInsertRowid, "Lower", 1);
    const session = dbModule.db
      .prepare("INSERT INTO sessions (program_id, user_id, day_id, week_number) VALUES (?, ?, ?, ?)")
      .run(program.lastInsertRowid, user.lastInsertRowid, day.lastInsertRowid, 1);

    dbModule.db.prepare("UPDATE programs SET name = 'Renamed Program' WHERE id = ?").run(program.lastInsertRowid);
    dbModule.db.prepare("UPDATE days SET name = 'Renamed Day' WHERE id = ?").run(day.lastInsertRowid);
    dbModule.db.prepare("UPDATE sessions SET status = 'completed' WHERE id = ?").run(session.lastInsertRowid);

    expect(
      dbModule.db
        .prepare("SELECT program_definition_id, program_run_id, program_name, day_name, status FROM sessions WHERE id = ?")
        .get(session.lastInsertRowid),
    ).toEqual({
      program_definition_id: definition.lastInsertRowid,
      program_run_id: run.lastInsertRowid,
      program_name: "Snapshot Program",
      day_name: "Lower",
      status: "completed",
    });
  });

  it("migrates existing max history tables to durable nullable shared references", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workout-history-db-"));
    const historyDb = new Database(path.join(dir, "history.db"));

    try {
      historyDb.pragma("foreign_keys = ON");
      const schema = fs.readFileSync(path.join(process.cwd(), "src", "lib", "db", "schema.sql"), "utf8");
      historyDb.exec(schema);
      historyDb.exec(`
        DROP TABLE exercise_max_history;

        CREATE TABLE exercise_max_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          exercise_id INTEGER REFERENCES exercises(id) ON DELETE SET NULL,
          shared_program_id INTEGER REFERENCES shared_programs(id) ON DELETE CASCADE,
          shared_exercise_key TEXT,
          session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
          session_set_id INTEGER REFERENCES session_sets(id) ON DELETE SET NULL,
          training_max REAL,
          working_weight REAL,
          actual_reps INTEGER,
          implied_max REAL,
          source TEXT NOT NULL CHECK(source IN ('sync','manual','set','progression','import')),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      const user = historyDb
        .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
        .run("old-history@example.com", "hash");
      const sharedProgram = historyDb
        .prepare("INSERT INTO shared_programs (owner_user_id, name) VALUES (?, ?)")
        .run(user.lastInsertRowid, "Shared Program");
      const sharedVersion = historyDb
        .prepare(
          "INSERT INTO shared_program_versions (shared_program_id, version_number, published_by_user_id, snapshot_json) VALUES (?, ?, ?, ?)",
        )
        .run(sharedProgram.lastInsertRowid, 1, user.lastInsertRowid, "{}");
      const history = historyDb
        .prepare("INSERT INTO exercise_max_history (user_id, shared_program_id, training_max, source) VALUES (?, ?, ?, ?)")
        .run(user.lastInsertRowid, sharedProgram.lastInsertRowid, 315, "sync");

      runMigrations(historyDb);
      runMigrations(historyDb);
      historyDb
        .prepare("UPDATE exercise_max_history SET shared_program_version_id = ? WHERE id = ?")
        .run(sharedVersion.lastInsertRowid, history.lastInsertRowid);
      historyDb.prepare("DELETE FROM shared_programs WHERE id = ?").run(sharedProgram.lastInsertRowid);

      const retainedHistory = historyDb
        .prepare("SELECT shared_program_id, shared_program_version_id, training_max FROM exercise_max_history WHERE id = ?")
        .get(history.lastInsertRowid) as {
        shared_program_id: number | null;
        shared_program_version_id: number | null;
        training_max: number;
      };

      expect(retainedHistory).toEqual({
        shared_program_id: null,
        shared_program_version_id: null,
        training_max: 315,
      });
      expect(() => {
        historyDb.prepare("INSERT INTO exercise_max_history (user_id, training_max, source) VALUES (?, ?, ?)").run(user.lastInsertRowid, -1, "manual");
      }).toThrow();
    } finally {
      historyDb.close();
    }
  });

  it("drops invalid legacy max history rows while preserving valid rows during migrations", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workout-invalid-history-db-"));
    const historyDb = new Database(path.join(dir, "invalid-history.db"));

    try {
      historyDb.pragma("foreign_keys = ON");
      const schema = fs.readFileSync(path.join(process.cwd(), "src", "lib", "db", "schema.sql"), "utf8");
      historyDb.exec(schema);
      historyDb.exec(`
        DROP TABLE exercise_max_history;

        CREATE TABLE exercise_max_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          exercise_id INTEGER REFERENCES exercises(id) ON DELETE SET NULL,
          shared_program_id INTEGER REFERENCES shared_programs(id) ON DELETE CASCADE,
          shared_exercise_key TEXT,
          session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
          session_set_id INTEGER REFERENCES session_sets(id) ON DELETE SET NULL,
          training_max REAL,
          working_weight REAL,
          actual_reps INTEGER,
          implied_max REAL,
          source TEXT NOT NULL CHECK(source IN ('sync','manual','set','progression','import')),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      const user = historyDb
        .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
        .run("invalid-legacy-history@example.com", "hash");
      const validHistory = historyDb
        .prepare("INSERT INTO exercise_max_history (user_id, training_max, source) VALUES (?, ?, ?)")
        .run(user.lastInsertRowid, 315, "manual");

      historyDb.prepare("INSERT INTO exercise_max_history (user_id, source) VALUES (?, ?)").run(user.lastInsertRowid, "manual");
      historyDb
        .prepare("INSERT INTO exercise_max_history (user_id, training_max, source) VALUES (?, ?, ?)")
        .run(user.lastInsertRowid, 0, "manual");
      historyDb
        .prepare("INSERT INTO exercise_max_history (user_id, actual_reps, source) VALUES (?, ?, ?)")
        .run(user.lastInsertRowid, -1, "set");

      expect(() => runMigrations(historyDb)).not.toThrow();
      expect(() => runMigrations(historyDb)).not.toThrow();

      const histories = historyDb
        .prepare("SELECT id, training_max, source FROM exercise_max_history ORDER BY id")
        .all() as { id: number; training_max: number; source: string }[];

      expect(histories).toEqual([{ id: validHistory.lastInsertRowid, training_max: 315, source: "manual" }]);
      expect(() => {
        historyDb.prepare("INSERT INTO exercise_max_history (user_id, source) VALUES (?, ?)").run(user.lastInsertRowid, "manual");
      }).toThrow();
    } finally {
      historyDb.close();
    }
  });

  it("enforces unique user emails", () => {
    dbModule.db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run("one@example.com", "hash");

    expect(() => {
      dbModule.db
        .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
        .run("one@example.com", "hash2");
    }).toThrow();
  });

  it("keeps programs scoped to their owning user", () => {
    const userA = dbModule.db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run("a@example.com", "hash");
    const userB = dbModule.db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run("b@example.com", "hash");

    dbModule.db
      .prepare("INSERT INTO programs (user_id, name) VALUES (?, ?)")
      .run(userA.lastInsertRowid, "A Program");
    dbModule.db
      .prepare("INSERT INTO programs (user_id, name) VALUES (?, ?)")
      .run(userB.lastInsertRowid, "B Program");

    const rows = dbModule.db
      .prepare("SELECT name FROM programs WHERE user_id = ? ORDER BY name")
      .all(userA.lastInsertRowid) as { name: string }[];

    expect(rows).toEqual([{ name: "A Program" }]);
  });

  it("allows only one session set per week setting per session", () => {
    const user = dbModule.db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run("sets@example.com", "hash");
    const program = dbModule.db
      .prepare("INSERT INTO programs (user_id, name) VALUES (?, ?)")
      .run(user.lastInsertRowid, "Program");
    const day = dbModule.db
      .prepare("INSERT INTO days (program_id, name, day_number) VALUES (?, ?, ?)")
      .run(program.lastInsertRowid, "Day 1", 1);
    const exercise = dbModule.db
      .prepare("INSERT INTO exercises (day_id, name, training_max) VALUES (?, ?, ?)")
      .run(day.lastInsertRowid, "Squat", 300);
    const weekSetting = dbModule.db
      .prepare(
        "INSERT INTO week_settings (exercise_id, week_number, intensity_pct, reps, sets, rep_out_target) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(exercise.lastInsertRowid, 1, 0.7, 5, 5, 10);
    const session = dbModule.db
      .prepare("INSERT INTO sessions (program_id, user_id, day_id, week_number) VALUES (?, ?, ?, ?)")
      .run(program.lastInsertRowid, user.lastInsertRowid, day.lastInsertRowid, 1);

    dbModule.db
      .prepare("INSERT INTO session_sets (session_id, week_setting_id) VALUES (?, ?)")
      .run(session.lastInsertRowid, weekSetting.lastInsertRowid);

    expect(() => {
      dbModule.db
        .prepare("INSERT INTO session_sets (session_id, week_setting_id) VALUES (?, ?)")
        .run(session.lastInsertRowid, weekSetting.lastInsertRowid);
    }).toThrow();
  });
});
