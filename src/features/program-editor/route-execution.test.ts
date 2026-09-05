import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Occurrence } from "@/features/programs/occurrences";
import type { ProgramExerciseV1 } from "./document";
import type { EditorCompletionDecision } from "./execution";
import type { ProgressionRuleV1, ProgressionState } from "./progression";

const authState = vi.hoisted(() => ({ userId: 0 }));
vi.mock("@/lib/auth", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireUser: async () => ({ id: authState.userId }), getSettingNumber: () => 2.5,
}));
let db: (typeof import("@/lib/db"))["db"];
let document: typeof import("./document");
let repository: typeof import("./repository");
let occurrences: typeof import("@/features/programs/occurrences");
let startRoute: typeof import("@/app/api/programs/[id]/sessions/route");
let currentRoute: typeof import("@/app/api/programs/[id]/sessions/current/route");
let completeRoute: typeof import("@/app/api/programs/[id]/complete-and-advance/route");
let skipRoute: typeof import("@/app/api/programs/[id]/skip-workout/route");
let setRoute: typeof import("@/app/api/sessions/[sessionId]/sets/route");
let directory: string;
let userId: number;
let otherId: number;
const rule: ProgressionRuleV1 = {
  version: 1, condition: { type: "double_progression" },
  action: { variable: "load", unit: "lb", operation: "add", amount: 2.5, rounding: { mode: "nearest", quantum: 2.5 }, timing: "per_exposure" },
};
type SessionResponse = { id: number; unit: "lb" | "kg"; sets: Array<{ id: number; calculated_weight: number; actual_reps: number | null; editor_json: string | null }> };
const request = (body: object, method = "POST") => new Request("http://localhost/api/workout", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const context = (programId: number) => ({ params: Promise.resolve({ id: String(programId) }) });

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "magni-editor-routes-"));
  vi.stubEnv("DB_PATH", path.join(directory, "routes.sqlite"));
  db = (await import("@/lib/db")).db;
  document = await import("./document");
  repository = await import("./repository");
  occurrences = await import("@/features/programs/occurrences");
  startRoute = await import("@/app/api/programs/[id]/sessions/route");
  currentRoute = await import("@/app/api/programs/[id]/sessions/current/route");
  completeRoute = await import("@/app/api/programs/[id]/complete-and-advance/route");
  skipRoute = await import("@/app/api/programs/[id]/skip-workout/route");
  setRoute = await import("@/app/api/sessions/[sessionId]/sets/route");
  userId = Number(db.prepare("INSERT INTO users(email,password_hash) VALUES ('editor-routes@example.test','hash')").run().lastInsertRowid);
  otherId = Number(db.prepare("INSERT INTO users(email,password_hash) VALUES ('other-routes@example.test','hash')").run().lastInsertRowid);
});
afterAll(() => { db?.close(); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });

function fixture(edit?: (exercise: ProgramExerciseV1) => void, unit: "lb" | "kg" = "lb") {
  authState.userId = userId;
  const doc = document.createBlankDocument();
  doc.name = "Route progression";
  doc.unit = unit;
  doc.startDate = "2026-09-05";
  doc.weekdays = [0, 1, 2, 3, 4, 5, 6];
  doc.cycles = 4;
  const exercise = document.createExercise("Dumbbell Row");
  exercise.rule = structuredClone(rule);
  exercise.rule.action.unit = unit;
  edit?.(exercise);
  doc.weeks[0].days[0].exercises = [exercise];
  const id = crypto.randomUUID();
  repository.saveEditorDraft({ userId, id, expectedRevision: 0, document: doc });
  const activation = repository.activateEditorDraft({ userId, id, expectedRevision: 1 });
  const rows = db.prepare("SELECT * FROM workout_occurrences WHERE program_run_id=? ORDER BY slot_index").all(activation.runId) as Occurrence[];
  return { activation, rows, exercise };
}
async function start(programId: number, row: Occurrence): Promise<SessionResponse> {
  const response = await startRoute.POST(request({ occurrenceId: row.id }), context(programId));
  expect(response.status).toBe(201);
  return response.json();
}
async function log(session: SessionResponse, reps: Array<number | null>) {
  for (const [index, set] of session.sets.entries()) {
    if (reps[index] == null) continue;
    const response = await setRoute.PUT(request({ setId: set.id, actualReps: reps[index], actualWeight: set.calculated_weight }, "PUT"), { params: Promise.resolve({ sessionId: String(session.id) }) });
    expect(response.status).toBe(200);
  }
}
function state(runId: number, key: string): ProgressionState {
  return JSON.parse((db.prepare("SELECT state_json FROM program_editor_progression_state WHERE run_id=? AND progression_key=?").get(runId, key) as { state_json: string }).state_json);
}

describe("editor start, actual logging, completion and skip routes", () => {
  it("freezes the editor unit onto the session for hot-added sets and history", async () => {
    const { activation, rows } = fixture(undefined, "kg");
    const started = await start(activation.programId, rows[0]);
    expect(started.unit).toBe("kg");
    expect(db.prepare("SELECT unit FROM sessions WHERE id=?").get(started.id)).toEqual({ unit: "kg" });
  });
  it("holds after12/12/11, advances once after12/12/12, and matches both pending preview and the next actual workout", async () => {
    const { activation, rows, exercise } = fixture();
    const first = await start(activation.programId, rows[0]);
    expect(first.sets.every((set) => set.editor_json !== null)).toBe(true);
    await log(first, [12, 12, 11]);
    const held = await completeRoute.POST(request({ sessionId: first.id }), context(activation.programId));
    expect(held.status).toBe(200);
    const heldBody = await held.json();
    expect(heldBody.progressionDecisions[0].result.reason).toBe("within_rep_range");
    expect(state(activation.runId, exercise.progressionKey).load).toBe(40);
    const second = await start(activation.programId, rows[1]);
    expect(second.sets.map((set) => set.calculated_weight)).toEqual([40, 40, 40]);
    await log(second, [12, 12, 12]);
    const completed = await completeRoute.POST(request({ sessionId: second.id }), context(activation.programId));
    expect(completed.status).toBe(200);
    const body = await completed.json();
    const decisions = body.progressionDecisions as EditorCompletionDecision[];
    expect(decisions[0].afterState.load).toBe(42.5);
    const { evaluateProgression } = await import("./progression");
    expect(decisions[0].result).toEqual(evaluateProgression(decisions[0].input));
    const retry = await completeRoute.POST(request({ sessionId: second.id }), context(activation.programId));
    expect((await retry.json()).progressionDecisions).toEqual(decisions);
    expect(state(activation.runId, exercise.progressionKey).load).toBe(42.5);
    const preview = occurrences.occurrencePrescription(occurrences.getOccurrence(userId, rows[2].id)!);
    expect(preview.map((set) => set.calculated_weight)).toEqual([42.5, 42.5, 42.5]);
    const third = await start(activation.programId, rows[2]);
    expect(third.sets.map((set) => set.calculated_weight)).toEqual(preview.map((set) => set.calculated_weight));
    expect(db.prepare("SELECT COUNT(*) AS n FROM program_editor_progression_events WHERE session_id=?").get(second.id)).toEqual({ n: 1 });
  });

  it("preserves active-session snapshots while other completions update future working loads", async () => {
    const { activation, rows } = fixture();
    const active = await start(activation.programId, rows[0]);
    const second = await start(activation.programId, rows[1]);
    await log(second, [12, 12, 12]);
    expect((await completeRoute.POST(request({ sessionId: second.id }), context(activation.programId))).status).toBe(200);
    const retry = await startRoute.POST(request({ occurrenceId: rows[0].id }), context(activation.programId));
    expect(retry.status).toBe(200);
    expect((await retry.json()).sets).toEqual(active.sets);
    const current = await currentRoute.GET(new Request(`http://localhost/api/workout?occurrenceId=${rows[0].id}`), context(activation.programId));
    expect((await current.json()).sets).toEqual(active.sets);
    const preview = occurrences.occurrencePrescription(occurrences.getOccurrence(userId, rows[0].id)!);
    expect(preview.map((set) => set.calculated_weight)).toEqual([40, 40, 40]);
    expect((preview[0] as { editor?: { prescribedState?: ProgressionState } }).editor?.prescribedState?.load).toBe(40);
  });

  it("completes partial editor workouts without fabricating performed sets and applies configured skip failure policies once", async () => {
    const { activation, rows, exercise } = fixture((exercise) => {
      exercise.rule = { ...rule, partialPolicy: "count_failure", skipPolicy: "count_failure", failureReset: { afterFailures: 2, percent: 10, rounding: { mode: "down", quantum: 2.5 } } };
    });
    const session = await start(activation.programId, rows[0]);
    await log(session, [12, null, null]);
    const complete = await completeRoute.POST(request({ sessionId: session.id }), context(activation.programId));
    expect(complete.status).toBe(200);
    expect((await complete.json()).progressionDecisions[0].input.status).toBe("partial");
    expect(state(activation.runId, exercise.progressionKey).consecutiveFailures).toBe(1);
    expect(db.prepare("SELECT actual_reps FROM session_sets WHERE session_id=? ORDER BY id").all(session.id)).toEqual([{ actual_reps: 12 }, { actual_reps: null }, { actual_reps: null }]);
    const skipped = await skipRoute.POST(request({ occurrenceId: rows[1].id }), context(activation.programId));
    expect(skipped.status).toBe(201);
    const skippedBody = await skipped.json();
    expect(skippedBody.progressionDecisions[0].result.outcome).toBe("reset");
    expect(state(activation.runId, exercise.progressionKey).load).toBe(35);
    const retry = await skipRoute.POST(request({ occurrenceId: rows[1].id }), context(activation.programId));
    expect(retry.status).toBe(200);
    expect((await retry.json()).progressionDecisions).toEqual(skippedBody.progressionDecisions);
    expect(state(activation.runId, exercise.progressionKey).load).toBe(35);
  });

  it("rolls progression back if the final status write fails and safely retries the same completion", async () => {
    const { activation, rows, exercise } = fixture();
    const session = await start(activation.programId, rows[0]);
    await log(session, [12, 12, 12]);
    db.exec(`CREATE TRIGGER execution_test_fail_status BEFORE UPDATE OF completed ON sessions
      WHEN NEW.id=${session.id} BEGIN SELECT RAISE(ABORT, 'simulated status failure'); END;`);
    try {
      expect((await completeRoute.POST(request({ sessionId: session.id }), context(activation.programId))).status).toBe(500);
      expect(state(activation.runId, exercise.progressionKey).load).toBe(40);
      expect(db.prepare("SELECT * FROM program_editor_progression_events WHERE session_id=?").get(session.id)).toBeUndefined();
      expect(db.prepare("SELECT status FROM sessions WHERE id=?").get(session.id)).toEqual({ status: "in_progress" });
    } finally { db.exec("DROP TRIGGER execution_test_fail_status"); }
    expect((await completeRoute.POST(request({ sessionId: session.id }), context(activation.programId))).status).toBe(200);
    expect(state(activation.runId, exercise.progressionKey).load).toBe(42.5);
  });

  it("requires occurrence identity for editor start/skip and preserves ownership checks", async () => {
    const { activation, rows } = fixture();
    const body = { definitionDayId: rows[0].definition_day_id, dayId: rows[0].legacy_day_id, weekNumber: rows[0].week_number };
    expect((await startRoute.POST(request(body), context(activation.programId))).status).toBe(400);
    expect((await skipRoute.POST(request(body), context(activation.programId))).status).toBe(400);
    authState.userId = otherId;
    try {
      expect((await startRoute.POST(request({ occurrenceId: rows[0].id }), context(activation.programId))).status).toBe(404);
      expect((await skipRoute.POST(request({ occurrenceId: rows[0].id }), context(activation.programId))).status).toBe(404);
    } finally { authState.userId = userId; }
  });
});
