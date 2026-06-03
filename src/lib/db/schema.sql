CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  num_weeks INTEGER NOT NULL DEFAULT 7 CHECK(num_weeks > 0),
  current_week INTEGER NOT NULL DEFAULT 1 CHECK(current_week > 0),
  current_day INTEGER NOT NULL DEFAULT 1 CHECK(current_day > 0),
  schedule_weekdays TEXT NOT NULL DEFAULT '[]',
  schedule_mode TEXT NOT NULL DEFAULT 'unscheduled' CHECK(schedule_mode IN ('unscheduled','scheduled')),
  shared_program_id INTEGER REFERENCES shared_programs(id),
  shared_program_version_id INTEGER REFERENCES shared_program_versions(id),
  program_definition_id INTEGER REFERENCES program_definitions(id) ON DELETE SET NULL,
  program_run_id INTEGER REFERENCES program_runs(id) ON DELETE SET NULL,
  archived_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shared_programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active_version_id INTEGER REFERENCES shared_program_versions(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shared_program_members (
  shared_program_id INTEGER NOT NULL REFERENCES shared_programs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner','admin','member')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (shared_program_id, user_id)
);

CREATE TABLE IF NOT EXISTS shared_program_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shared_program_id INTEGER NOT NULL REFERENCES shared_programs(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  published_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(shared_program_id, version_number)
);

CREATE TABLE IF NOT EXISTS shared_program_expected_maxes (
  shared_program_id INTEGER NOT NULL REFERENCES shared_programs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_exercise_key TEXT NOT NULL,
  expected_max REAL NOT NULL CHECK(expected_max > 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (shared_program_id, user_id, shared_exercise_key)
);

CREATE TABLE IF NOT EXISTS shared_program_applied_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shared_program_id INTEGER NOT NULL REFERENCES shared_programs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES shared_program_versions(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN ('apply','rollback')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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

CREATE TABLE IF NOT EXISTS days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  day_number INTEGER NOT NULL CHECK(day_number > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(program_id, day_number)
);

CREATE TABLE IF NOT EXISTS exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_id INTEGER NOT NULL REFERENCES days(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  training_max REAL NOT NULL CHECK(training_max > 0),
  category TEXT NOT NULL DEFAULT 'main' CHECK(category IN ('main','aux','accessory')),
  progression_type TEXT NOT NULL DEFAULT 'custom',
  auto_progression_enabled INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  shared_exercise_key TEXT,
  archived_at TEXT,
  superset_group TEXT
);

CREATE TABLE IF NOT EXISTS week_settings (
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

CREATE TABLE IF NOT EXISTS sessions (
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

CREATE TABLE IF NOT EXISTS session_sets (
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

CREATE TABLE IF NOT EXISTS exercise_max_history (
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

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_week_settings_exercise_week ON week_settings(exercise_id, week_number);
CREATE INDEX IF NOT EXISTS idx_shared_program_members_user ON shared_program_members(user_id);
CREATE INDEX IF NOT EXISTS idx_program_definitions_owner ON program_definitions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_program_runs_user_status ON program_runs(user_id, status);
