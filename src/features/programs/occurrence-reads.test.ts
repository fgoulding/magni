import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import * as programs from "./program-service";
import * as occurrences from "./occurrences";

afterEach(() => vi.restoreAllMocks());

function fixture(weeks = 52) {
  const userId = Number(db.prepare("INSERT INTO users(email,password_hash) VALUES (?,'hash')").run(`${crypto.randomUUID()}@example.test`).lastInsertRowid);
  const run = programs.createProgramRun({ userId, name: "Read budget", numWeeks: weeks });
  for (const name of ["A", "B", "C"]) {
    const day = programs.addDefinitionDayForRun({ userId, legacyProgramId: run.legacyProgramId, name });
    programs.addDefinitionExerciseForDay({ userId, legacyDayId: day.legacyDayId, name: `Lift ${name}`, trainingMax: 100, category: "main", progressionType: "linear" });
  }
  programs.updateProgramRun({ userId, legacyProgramId: run.legacyProgramId, startDate: "2090-01-01", scheduleWeekdays: [1, 3, 5] });
  return { userId, run, rows: occurrences.getOccurrences(userId) };
}

describe("materialized occurrence reads", () => {
  it("loads pending maxima once per preview without mutating their snapshots", () => {
    const { userId, rows } = fixture(2);
    const occurrence = rows[0];
    const original = occurrences.occurrenceLiftPreview(occurrence);
    const prepare = vi.spyOn(db, "prepare");
    expect(occurrences.occurrenceLiftPreview(occurrence)).toEqual(original);
    expect(prepare.mock.calls.length).toBeLessThanOrEqual(2);
    prepare.mockRestore();
    const prescriptions = JSON.parse(occurrence.prescription_json) as occurrences.PrescriptionSet[];
    db.prepare("UPDATE program_run_expected_maxes SET expected_max=200 WHERE program_run_id=? AND shared_exercise_key=?")
      .run(occurrence.program_run_id, prescriptions[0].stable_key);
    expect(occurrences.occurrenceLiftPreview(occurrence)[0].weight).toBeGreaterThan(original[0].weight);
    expect(occurrences.getOccurrence(userId, occurrence.id)?.prescription_json).toBe(occurrence.prescription_json);
  });

  it("reads an unchanged calendar during a separate WAL writer without acquiring its lock", () => {
    const { userId, rows } = fixture(2);
    const writer = new Database(db.name);
    db.pragma("busy_timeout=20");
    writer.exec("BEGIN IMMEDIATE");
    try {
      expect(occurrences.getOccurrences(userId)).toEqual(rows);
    } finally {
      writer.exec("ROLLBACK");
      writer.close();
      db.pragma("busy_timeout=5000");
    }
  });

  it("uses a fixed query budget for a complete schedule regardless of its slot count", () => {
    const { userId, rows } = fixture();
    expect(rows).toHaveLength(156);
    const prepare = vi.spyOn(db, "prepare");
    expect(occurrences.getOccurrences(userId, "2090-10-01", "2090-10-31")).toEqual(rows.filter(row => row.scheduled_date >= "2090-10-01" && row.scheduled_date <= "2090-10-31"));
    expect(prepare.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("repairs a missing slot without regenerating moved prescriptions or changing existing identities", () => {
    const { userId, run, rows } = fixture(2);
    db.prepare("UPDATE workout_occurrences SET scheduled_date='2090-07-01',moved=1,revision=2 WHERE id=?").run(rows[0].id);
    const unchanged = occurrences.getOccurrence(userId, rows[0].id);
    db.prepare("DELETE FROM workout_occurrences WHERE id=?").run(rows[2].id);
    const repaired = occurrences.getOccurrences(userId);
    expect(repaired).toHaveLength(rows.length);
    expect(repaired.find(row => row.slot_index === rows[2].slot_index)).toMatchObject({ program_run_id: run.runId, scheduled_date: rows[2].scheduled_date, prescription_json: rows[2].prescription_json });
    expect(occurrences.getOccurrence(userId, rows[0].id)).toEqual(unchanged);
    expect(repaired.filter(row => row.slot_index !== rows[2].slot_index).map(row => row.id).sort()).toEqual(rows.filter(row => row.id !== rows[2].id).map(row => row.id).sort());
  });

  it("rechecks missing slots under the repair lock when another connection materializes first", () => {
    const { userId, rows } = fixture(2);
    const missing = db.prepare("SELECT * FROM workout_occurrences WHERE id=?").get(rows[2].id) as Record<string, string | number | null>;
    missing.scheduled_date = "2090-07-02";
    missing.moved = 1;
    missing.revision = 2;
    db.prepare("DELETE FROM workout_occurrences WHERE id=?").run(missing.id);
    const writer = new Database(db.name);
    const prepare = db.prepare.bind(db);
    let inserted = false;
    const reads = vi.spyOn(db, "prepare").mockImplementation(sql => {
      const statement = prepare(sql);
      if (!inserted && sql.includes("SELECT slot_index FROM workout_occurrences")) {
        const all = statement.all.bind(statement);
        vi.spyOn(statement, "all").mockImplementation((...args: unknown[]) => {
          const staleSlots = all(...args);
          const columns = Object.keys(missing);
          writer.prepare(`INSERT INTO workout_occurrences (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...Object.values(missing));
          inserted = true;
          return staleSlots;
        });
      }
      return statement;
    });
    try {
      expect(occurrences.getOccurrences(userId).find(row => row.id === missing.id)).toMatchObject(missing);
      expect(inserted).toBe(true);
      expect(reads.mock.calls.some(([sql]) => sql.startsWith("INSERT OR IGNORE INTO workout_occurrences"))).toBe(false);
    } finally {
      reads.mockRestore();
      writer.close();
    }
  });

  it("links eligible legacy history even when every schedule slot already exists", () => {
    const { userId, run, rows } = fixture(2);
    const row = rows[0];
    const sessionId = Number(db.prepare(`INSERT INTO sessions(user_id,program_id,program_run_id,program_definition_day_id,day_id,week_number,date,scheduled_date,status)
      VALUES (?,?,?,?,?,?,'2089-12-31',?,'completed')`).run(userId, run.legacyProgramId, run.runId, row.definition_day_id, row.legacy_day_id, row.week_number, row.scheduled_date).lastInsertRowid);
    expect(occurrences.getOccurrences(userId).find(item => item.id === row.id)).toMatchObject({ session_id: sessionId, performed_date: "2089-12-31", status: "completed", prescription_json: row.prescription_json });
  });
});
