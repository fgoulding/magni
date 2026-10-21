import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getProgressHistory } from "@/features/progress/queries";
import { listWorkouts } from "./history-service";

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const userId = Number(db.prepare("INSERT INTO users(email,password_hash) VALUES (?,'hash')").run(`${crypto.randomUUID()}@example.test`).lastInsertRowid);
  const rows: { id: number; date: string; status: "completed" | "skipped" | "in_progress"; target: boolean }[] = [];
  db.transaction(() => {
    for (let i = 0; i < 205; i++) {
      const status = i % 3 === 0 ? "skipped" : i % 3 === 1 ? "completed" : "in_progress";
      const date = `2026-10-${String(i % 5 + 1).padStart(2, "0")}`;
      const id = Number(db.prepare("INSERT INTO sessions(user_id,week_number,date,status,unit,program_name,day_name) VALUES (?,1,?,?,?,'Quick Workout','History')")
        .run(userId, date, status, i % 2 ? "kg" : "lb").lastInsertRowid);
      const target = i % 4 === 0;
      const insert = db.prepare("INSERT INTO session_sets(session_id,exercise_name,sets,actual_reps,actual_weight) VALUES (?,?,?,?,?)");
      insert.run(id, target ? "Target lift" : "Other lift", 2, 5, 10);
      insert.run(id, "Unperformed", 1, null, null);
      insert.run(id, "Unknown weight", 1, 5, null);
      rows.push({ id, date, status, target });
    }
  })();
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  return { userId, rows };
}

function countWeightReads(run: () => void): number {
  let reads = 0;
  db.function("audit_history_weight", value => { reads++; return value; });
  const prepare = db.prepare.bind(db);
  const spy = vi.spyOn(db, "prepare").mockImplementation(sql => prepare(sql.replaceAll("ss.actual_weight", "audit_history_weight(ss.actual_weight)")));
  try { run(); } finally { spy.mockRestore(); }
  return reads;
}

describe("history session pagination before set aggregation", () => {
  it("aggregates only the first workout page and preserves tied-date cursors and totals", () => {
    const { userId, rows } = fixture();
    const reads = countWeightReads(() => {
      const first = listWorkouts(userId);
      expect(first.map(row => row.id)).toEqual(rows.slice(0, 100).map(row => row.id));
      expect(first.every(row => row.volume === 100 && row.loggedSets === 3 && row.totalSets === 4)).toBe(true);
    });
    expect(reads).toBeLessThanOrEqual(200);
    const second = listWorkouts(userId, `${rows[99].date}:${rows[99].id}`);
    const third = listWorkouts(userId, `${rows[199].date}:${rows[199].id}`);
    expect(second.map(row => row.id)).toEqual(rows.slice(100, 200).map(row => row.id));
    expect(third.map(row => row.id)).toEqual(rows.slice(200).map(row => row.id));
  });

  it("aggregates only the Progress history page including its next-page sentinel", () => {
    const { userId, rows } = fixture();
    const reads = countWeightReads(() => {
      const first = getProgressHistory(userId);
      expect(first.items.map(row => row.sessionId)).toEqual(rows.slice(0, 20).map(row => row.id));
      expect(first.items.every(row => row.volume === 100 && row.loggedSets === 3 && row.totalSets === 4 && row.missingWeightSets === 1)).toBe(true);
      expect(first.nextCursor).not.toBeNull();
    });
    expect(reads).toBeLessThanOrEqual(105);
  });

  it("applies status, date and exercise search eligibility before pagination", () => {
    const { userId, rows } = fixture();
    const filters = { from: "2026-10-02", to: "2026-10-04", status: "completed" as const, programId: 0, search: "Target", limit: 3 };
    const expected = rows.filter(row => row.target && row.status === "completed" && row.date >= filters.from && row.date <= filters.to);
    const first = getProgressHistory(userId, filters);
    expect(first.items.map(row => row.sessionId)).toEqual(expected.slice(0, 3).map(row => row.id));
    const second = getProgressHistory(userId, { ...filters, cursor: first.nextCursor! });
    expect(second.items.map(row => row.sessionId)).toEqual(expected.slice(3, 6).map(row => row.id));
    expect(getProgressHistory(userId, { ...filters, cursor: second.previousCursor! }).items).toEqual(first.items);
  });
});
