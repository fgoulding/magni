import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isValidElement, type ReactNode } from "react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ userId: 0 }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ id: auth.userId }), getSettingNumber: () => 2.5 }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
let db: typeof import("@/lib/db").db;
let service: typeof import("@/features/programs/program-service");
let occurrences: typeof import("@/features/programs/occurrences");
let Page: typeof import("./page").default;
let directory: string;
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "history-exact-resume-"));
  vi.stubEnv("DB_PATH", path.join(directory, "test.sqlite"));
  db = (await import("@/lib/db")).db;
  service = await import("@/features/programs/program-service");
  occurrences = await import("@/features/programs/occurrences");
  Page = (await import("./page")).default;
});
afterAll(() => { db?.close(); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });
function user() { return Number(db.prepare("INSERT INTO users(email,password_hash) VALUES (?,'hash')").run(`${crypto.randomUUID()}@example.com`).lastInsertRowid); }
function href(node: ReactNode): string | null {
  if (Array.isArray(node)) return node.map(href).find(Boolean) ?? null;
  if (!isValidElement<{ children?: ReactNode; href?: string }>(node)) return null;
  if (node.props.children === "Resume planned workout") return node.props.href ?? null;
  return href(node.props.children);
}
async function futureSession() {
  auth.userId = user();
  const program = service.createProgramRun({ userId: auth.userId, name: "Future workout", numWeeks: 2 });
  for (const [name, lift] of [["Lower", "Squat"], ["Upper", "Row"]]) {
    const day = service.addDefinitionDayForRun({ userId: auth.userId, legacyProgramId: program.legacyProgramId, name });
    service.addDefinitionExerciseForDay({ userId: auth.userId, legacyDayId: day.legacyDayId, name: lift, trainingMax: 200, category: "main", progressionType: "linear" });
  }
  service.updateProgramRun({ userId: auth.userId, legacyProgramId: program.legacyProgramId, scheduleWeekdays: [0,1,2,3,4,5,6], startDate: "2026-09-05" });
  const future = occurrences.getOccurrences(auth.userId).find((occurrence) => occurrence.week_number === 2 && occurrence.day_number === 2)!;
  const start = await import("@/app/api/programs/[id]/sessions/route");
  const response = await start.POST(new Request("http://localhost/api/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ occurrenceId: future.id }) }), { params: Promise.resolve({ id: String(program.legacyProgramId) }) });
  expect(response.status).toBe(201);
  const session = await response.json();
  db.prepare("UPDATE session_sets SET actual_reps=7,actual_weight=42.5 WHERE id=?").run(session.sets[0].id);
  expect(db.prepare("SELECT current_week,current_day FROM programs WHERE id=?").get(program.legacyProgramId)).toEqual({ current_week: 1, current_day: 1 });
  return { session, future, program };
}
it("links a future started workout to its exact occurrence, date and frozen logged sets", async () => {
  const { session, future, program } = await futureSession();
  const page = await Page({ params: Promise.resolve({ sessionId: String(session.id) }) });
  const link = href(page)!;
  expect(link).toBe(`/calendar?month=${future.scheduled_date.slice(0, 7)}&date=${future.scheduled_date}&workout=occurrence-${future.id}`);
  const current = await import("@/app/api/programs/[id]/sessions/current/route");
  const restored = await (await current.GET(new Request(`http://localhost/api/current?occurrenceId=${future.id}`), { params: Promise.resolve({ id: String(program.legacyProgramId) }) })).json();
  expect(restored.id).toBe(session.id);
  expect(restored.sets[0]).toMatchObject({ id: session.sets[0].id, actual_reps: 7, actual_weight: 42.5 });
});
it("does not expose another user's workout through the resume page", async () => {
  const { session } = await futureSession();
  auth.userId = user();
  await expect(Page({ params: Promise.resolve({ sessionId: String(session.id) }) })).rejects.toThrow("NOT_FOUND");
});

it("routes an unlinked legacy workout through its exact session even when a newer day/week match exists", async () => {
  auth.userId = user();
  const program = service.createProgramRun({ userId: auth.userId, name: "Legacy manual", numWeeks: 2 });
  const day = service.addDefinitionDayForRun({ userId: auth.userId, legacyProgramId: program.legacyProgramId, name: "Upper" });
  const insert = db.prepare("INSERT INTO sessions(user_id,program_id,day_id,program_definition_day_id,week_number,date) VALUES (?,?,?,?,1,?)");
  const older = Number(insert.run(auth.userId, program.legacyProgramId, day.legacyDayId, day.definitionDayId, "2026-09-01").lastInsertRowid);
  const newer = Number(insert.run(auth.userId, program.legacyProgramId, day.legacyDayId, day.definitionDayId, "2026-09-03").lastInsertRowid);
  expect(newer).not.toBe(older);
  expect(href(await Page({ params: Promise.resolve({ sessionId: String(older) }) }))).toBe(`/workouts/${older}/resume`);
  const Resume = (await import("./resume/page")).default;
  const { WorkoutCard } = await import("@/components/WorkoutCard");
  function card(node: ReactNode): { resumeSessionId?: number; dayId?: number } | null {
    if (Array.isArray(node)) return node.map(card).find(Boolean) ?? null;
    if (!isValidElement<{ children?: ReactNode; resumeSessionId?: number; dayId?: number }>(node)) return null;
    return node.type === WorkoutCard ? node.props : card(node.props.children);
  }
  expect(card(await Resume({ params: Promise.resolve({ sessionId: String(older) }) }))).toMatchObject({ resumeSessionId: older, dayId: day.legacyDayId });
  auth.userId = user();
  await expect(Resume({ params: Promise.resolve({ sessionId: String(older) }) })).rejects.toThrow("NOT_FOUND");
});
