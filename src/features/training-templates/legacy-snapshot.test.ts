import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createProgramRun, addDefinitionDayForRun, addDefinitionExerciseForDay } from "@/features/programs/program-service";
import { createUserTrainingTemplate, deleteUserTrainingTemplate } from "./user-templates";
import { POST as start } from "@/app/api/programs/[id]/sessions/route";
import { POST as complete } from "@/app/api/programs/[id]/complete-and-advance/route";

const identity = vi.hoisted(() => ({ id: 0 }));
vi.mock("@/lib/auth", async (original) => ({ ...await original<typeof import("@/lib/auth")>(), requireUser: async () => identity }));
const request = (body: unknown) => new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
function setup() {
  identity.id = Number(db.prepare("INSERT INTO users(email,password_hash) VALUES (?, 'hash')").run(`${crypto.randomUUID()}@example.test`).lastInsertRowid);
  const template = createUserTrainingTemplate({ userId: identity.id, name: "Frozen two point five", weeks: [{ sets: 1, reps: 5, intensityPct: 1, repOutTarget: 5 }], rule: { kind: "linear-add", onSuccess: 2.5 } });
  const program = createProgramRun({ userId: identity.id, name: "Legacy custom", numWeeks: 2 });
  const day = addDefinitionDayForRun({ userId: identity.id, legacyProgramId: program.legacyProgramId, name: "Lift" });
  const exercise = addDefinitionExerciseForDay({ userId: identity.id, legacyDayId: day.legacyDayId, name: "Squat", trainingMax: 100, category: "main", progressionType: template.id });
  const context = { params: Promise.resolve({ id: String(program.legacyProgramId) }) };
  return { template, program, day, exercise, context };
}
async function begin(fixture: ReturnType<typeof setup>) {
  const response = await start(request({ dayId: fixture.day.legacyDayId }), fixture.context);
  expect(response.status).toBe(201);
  const session = await response.json() as { id: number; sets: { id: number; calculated_weight: number }[] };
  db.prepare("UPDATE session_sets SET actual_reps=5,actual_weight=calculated_weight WHERE session_id=?").run(session.id);
  return session;
}

describe("legacy custom template snapshots", () => {
  it("requires a deliberate manual hold for an unavailable original rule and records it once", async () => {
    const fixture = setup(); const session = await begin(fixture);
    db.prepare("UPDATE session_sets SET template_snapshot_json=NULL WHERE session_id=?").run(session.id);
    const refused = await complete(request({ sessionId: session.id }), fixture.context);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "missing_legacy_template" });
    expect(db.prepare("SELECT completed FROM sessions WHERE id=?").get(session.id)).toEqual({ completed: 0 });
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await complete(request({ sessionId: session.id, unavailableTemplatePolicy: "hold" }), fixture.context)).status).toBe(200);
    }
    expect(db.prepare("SELECT expected_max FROM program_run_expected_maxes WHERE program_run_id=?").get(fixture.program.runId)).toEqual({ expected_max: 100 });
    const stored = db.prepare("SELECT legacy_completion_json FROM sessions WHERE id=?").get(session.id) as { legacy_completion_json: string };
    expect(JSON.parse(stored.legacy_completion_json)).toMatchObject([{ reason: "missing_legacy_template", delta: 0 }]);
  });
  it("does not suppress a valid frozen rule when a manual missing-template policy is sent", async () => {
    const fixture = setup(); const session = await begin(fixture);
    expect((await complete(request({ sessionId: session.id, unavailableTemplatePolicy: "hold" }), fixture.context)).status).toBe(200);
    expect(db.prepare("SELECT expected_max FROM program_run_expected_maxes WHERE program_run_id=?").get(fixture.program.runId)).toEqual({ expected_max: 102.5 });
  });
  it.each(["changed", "deleted"])("keeps the assigned rule when its reusable template is %s before starting", async (change) => {
    const fixture = setup();
    if (change === "changed") db.prepare("UPDATE user_training_templates SET rule_json=? WHERE id=?").run(JSON.stringify({ kind: "linear-add", onSuccess: 25 }), fixture.template.id);
    else deleteUserTrainingTemplate(fixture.template.id, identity.id);
    const session = await begin(fixture);
    const response = await complete(request({ sessionId: session.id }), fixture.context);
    expect(response.status).toBe(200);
    expect(db.prepare("SELECT expected_max FROM program_run_expected_maxes WHERE program_run_id=?").get(fixture.program.runId)).toEqual({ expected_max: 102.5 });
  });

  it.each(["changed", "deleted"])("keeps an active session and its retry immutable after template %s", async (change) => {
    const fixture = setup();
    const session = await begin(fixture);
    const before = db.prepare("SELECT calculated_weight,reps,rep_out_target FROM session_sets WHERE session_id=?").all(session.id);
    if (change === "changed") db.prepare("UPDATE user_training_templates SET rule_json=? WHERE id=?").run(JSON.stringify({ kind: "linear-add", onSuccess: 25 }), fixture.template.id);
    else deleteUserTrainingTemplate(fixture.template.id, identity.id);
    expect((await complete(request({ sessionId: session.id }), fixture.context)).status).toBe(200);
    expect((await complete(request({ sessionId: session.id }), fixture.context)).status).toBe(200);
    expect(db.prepare("SELECT expected_max FROM program_run_expected_maxes WHERE program_run_id=?").get(fixture.program.runId)).toEqual({ expected_max: 102.5 });
    expect(db.prepare("SELECT calculated_weight,reps,rep_out_target FROM session_sets WHERE session_id=?").all(session.id)).toEqual(before);
    expect(db.prepare("SELECT tm_delta_applied FROM session_sets WHERE session_id=?").get(session.id)).toEqual({ tm_delta_applied: 2.5 });
  });
});
