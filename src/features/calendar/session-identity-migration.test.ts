import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrateOccurrenceSessionUniqueness } from "./migration";

it("preserves populated session extensions, dependent history, triggers, indexes, FKs and identity sequence across a repeatable upgrade",()=>{
  const db=new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1);
    CREATE TABLE workout_occurrences(id INTEGER PRIMARY KEY,status TEXT DEFAULT 'scheduled');INSERT INTO workout_occurrences(id) VALUES(10),(11),(12);
    CREATE TABLE sessions(id INTEGER PRIMARY KEY AUTOINCREMENT,program_id INTEGER,user_id INTEGER REFERENCES users(id),day_id INTEGER,week_number INTEGER,date TEXT,
    program_run_id INTEGER,program_definition_day_id INTEGER,occurrence_id INTEGER REFERENCES workout_occurrences(id),unit TEXT NOT NULL DEFAULT 'lb',revision INTEGER DEFAULT 1,editor_extra TEXT,
    UNIQUE(program_id,user_id,day_id,week_number,date));
    CREATE UNIQUE INDEX idx_sessions_unique_definition_day ON sessions(program_run_id,user_id,program_definition_day_id,week_number,date) WHERE program_definition_day_id IS NOT NULL;
    CREATE UNIQUE INDEX idx_session_occurrence ON sessions(occurrence_id) WHERE occurrence_id IS NOT NULL;
    CREATE INDEX custom_session_unit ON sessions(unit);
    CREATE TABLE history(id INTEGER PRIMARY KEY,session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,payload TEXT);
    CREATE TRIGGER custom_insert AFTER INSERT ON sessions BEGIN UPDATE workout_occurrences SET status='in_progress' WHERE id=NEW.occurrence_id; END;
    INSERT INTO sessions(id,program_id,user_id,day_id,week_number,date,program_run_id,program_definition_day_id,occurrence_id,unit,revision,editor_extra) VALUES(5,1,1,1,1,'2090-06-05',1,1,10,'kg',7,'frozen editor data');
    INSERT INTO history VALUES(4,5,'preserved performance');
    UPDATE sqlite_sequence SET seq=99 WHERE name='sessions';`);
  const before=db.prepare("SELECT * FROM sessions").all();
  expect(()=>db.prepare("INSERT INTO sessions(program_id,user_id,day_id,week_number,date,program_run_id,program_definition_day_id,occurrence_id) VALUES(1,1,1,1,'2090-06-05',1,1,11)").run()).toThrow(/UNIQUE/);
  migrateOccurrenceSessionUniqueness(db);
  migrateOccurrenceSessionUniqueness(db);
  expect(db.prepare("SELECT * FROM sessions").all()).toEqual(before);
  expect(db.prepare("SELECT * FROM history").all()).toEqual([{id:4,session_id:5,payload:"preserved performance"}]);
  const insert=db.prepare("INSERT INTO sessions(program_id,user_id,day_id,week_number,date,program_run_id,program_definition_day_id,occurrence_id) VALUES(1,1,1,1,'2090-06-05',1,1,?)");
  expect(Number(insert.run(11).lastInsertRowid)).toBe(100);
  expect(db.prepare("SELECT status FROM workout_occurrences WHERE id=11").get()).toEqual({status:"in_progress"});
  insert.run(null);expect(()=>insert.run(null)).toThrow(/UNIQUE/);
  expect(()=>insert.run(11)).toThrow(/UNIQUE/);
  expect(db.pragma("foreign_key_check")).toEqual([]);
  expect(db.pragma("foreign_keys",{simple:true})).toBe(1);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name='custom_session_unit'").get()).toBeDefined();
  db.close();
});

it("preserves existing foreign-key violations without deleting or modifying their rows",()=>{
  const db=new Database(":memory:");
  db.pragma("foreign_keys=OFF");
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);CREATE TABLE workout_occurrences(id INTEGER PRIMARY KEY);
    CREATE TABLE sessions(id INTEGER PRIMARY KEY AUTOINCREMENT,program_id INTEGER,user_id INTEGER REFERENCES users(id),day_id INTEGER,week_number INTEGER,date TEXT,program_run_id INTEGER,program_definition_day_id INTEGER,occurrence_id INTEGER REFERENCES workout_occurrences(id),UNIQUE(program_id,user_id,day_id,week_number,date));
    INSERT INTO sessions(user_id,week_number,date) VALUES(99,1,'2090-06-05');`);
  db.pragma("foreign_keys=ON");
  const rows=db.prepare("SELECT * FROM sessions").all();
  const violations=db.pragma("foreign_key_check");
  migrateOccurrenceSessionUniqueness(db);
  expect(db.prepare("SELECT * FROM sessions").all()).toEqual(rows);
  expect(db.pragma("foreign_key_check")).toEqual(violations);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name='sessions_calendar_upgrade'").get()).toBeUndefined();
  expect(db.pragma("foreign_keys",{simple:true})).toBe(1);
  db.close();
});

it("rolls back schema, data and pragma settings when a newly required legacy unique index cannot be built",()=>{
  const db=new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1);CREATE TABLE workout_occurrences(id INTEGER PRIMARY KEY);
    CREATE TABLE sessions(id INTEGER PRIMARY KEY AUTOINCREMENT,program_id INTEGER,user_id INTEGER REFERENCES users(id),day_id INTEGER,week_number INTEGER,date TEXT,program_run_id INTEGER,program_definition_day_id INTEGER,occurrence_id INTEGER REFERENCES workout_occurrences(id),UNIQUE(program_id,user_id,day_id,week_number,date));
    INSERT INTO sessions(program_id,user_id,day_id,week_number,date,program_run_id,program_definition_day_id) VALUES(1,1,1,1,'2090-06-05',1,1),(1,1,2,1,'2090-06-05',1,1);`);
  const sql=db.prepare("SELECT sql FROM sqlite_master WHERE name='sessions'").get();
  const rows=db.prepare("SELECT * FROM sessions").all();
  expect(()=>migrateOccurrenceSessionUniqueness(db)).toThrow(/UNIQUE/);
  expect(db.prepare("SELECT sql FROM sqlite_master WHERE name='sessions'").get()).toEqual(sql);
  expect(db.prepare("SELECT * FROM sessions").all()).toEqual(rows);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name='sessions_calendar_upgrade'").get()).toBeUndefined();
  expect(db.pragma("foreign_keys",{simple:true})).toBe(1);
  db.close();
});
