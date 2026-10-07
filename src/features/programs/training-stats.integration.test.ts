import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getLastPerformanceByExercise, getSessionPrs, getUserTrainingStats } from "./training-stats";
import * as workouts from "@/features/workouts/history-service";

let owner: number;
let outsider: number;
beforeAll(() => {
  owner = Number(db.prepare("INSERT INTO users(email,password_hash) VALUES ('stats-accuracy@example.com','hash')").run().lastInsertRowid);
  outsider = Number(db.prepare("INSERT INTO users(email,password_hash) VALUES ('stats-outsider@example.com','hash')").run().lastInsertRowid);
});
function record(date: string, weight: number | null, options: { name?: string; source?: number; unit?: "lb" | "kg"; reps?: number } = {}) {
  let session = workouts.createQuickSession({ userId: owner, newWorkout: true, date, ...(options.unit ? { unit: options.unit } : {}), ...(options.source ? { sourceSessionId: options.source } : {}) }).session;
  if (!options.source) session = workouts.addQuickExercise({ userId: owner, sessionId: session.id, name: options.name ?? "Row", sets: [{ reps: 1, weight: weight ?? 40 }] });
  workouts.saveActualSet({ userId: owner, sessionId: session.id, setId: session.sets[0].id, actualReps: options.reps ?? 1, actualWeight: weight });
  workouts.finishQuickSession(owner, session.id);
  return session;
}

describe("historical records and previous performance", () => {
  it("compares only earlier performed dates, then IDs for workouts on the same date", () => {
    const first = record("2026-09-01", 100, { name: "Chronology" });
    const middle = record("2026-09-02", 110, { source: first.id });
    const laterSameDay = record("2026-09-02", 120, { source: first.id });
    const future = record("2026-09-03", 130, { source: first.id });
    expect(getSessionPrs(owner, first.id)).toEqual([]);
    expect(getSessionPrs(owner, middle.id)).toEqual([{ exercise: "Chronology", e1rm: 110, weight: 110, reps: 1 }]);
    expect(getSessionPrs(owner, laterSameDay.id)).toEqual([{ exercise: "Chronology", e1rm: 120, weight: 120, reps: 1 }]);
    expect(getSessionPrs(owner, future.id)).toHaveLength(1);
    expect(getLastPerformanceByExercise(owner, middle.id)[String(middle.sets[0].id)]).toMatchObject({ sessionId: first.id, date: "2026-09-01", topWeight: 100 });
    expect(getLastPerformanceByExercise(owner, laterSameDay.id)[String(laterSameDay.sets[0].id)]).toMatchObject({ sessionId: middle.id, topWeight: 110 });
    expect(getLastPerformanceByExercise(owner, first.id)).toEqual({});
    expect(getSessionPrs(outsider, middle.id)).toEqual([]);
    expect(getLastPerformanceByExercise(outsider, middle.id)).toEqual({});
  });

  it("does not merge unrelated variants with identical labels", () => {
    record("2026-08-01", 40, { name: "Same label" });
    const different = record("2026-08-02", 80, { name: "Same label" });
    expect(getSessionPrs(owner, different.id)).toEqual([]);
    expect(getLastPerformanceByExercise(owner, different.id)).toEqual({});
  });

  it("keeps original units and missing weight distinct from a recorded zero", () => {
    const first = record("2026-07-01", 0, { name: "Load semantics", reps: 10, unit: "kg" });
    const second = record("2026-07-02", null, { source: first.id, reps: 11 });
    const third = record("2026-07-03", 0, { source: first.id, reps: 0 });
    expect(getLastPerformanceByExercise(owner, second.id)[String(second.sets[0].id)]).toMatchObject({ sessionId: first.id, topWeight: 0, unit: "kg", reps: [10] });
    expect(getLastPerformanceByExercise(owner, third.id)[String(third.sets[0].id)]).toMatchObject({ sessionId: second.id, topWeight: null, unit: "kg", reps: [11] });
  });

  it("uses the user's Monday calendar week at a server timezone boundary", () => {
    db.prepare("INSERT INTO user_settings(user_id,key,value) VALUES (?, 'timezone', 'America/Los_Angeles')").run(owner);
    record("2026-10-04", 40, { name: "Sunday" });
    // UTC Monday is still Sunday for this user.
    const stats = getUserTrainingStats(owner, new Date("2026-10-05T01:00:00Z"));
    expect(stats.frequency.weeks.at(-1)?.weekStart).toBe("2026-09-28");
    expect(stats.frequency.thisWeek).toBe(1);
  });
});
