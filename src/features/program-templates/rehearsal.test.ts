import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { readTemplateFile } from "./storage.mjs";
import { compileProgramTemplate, type ProgramTemplate } from "./template";
import { validateDocument } from "../program-editor/document";
import type { Occurrence } from "../programs/occurrences";

const auth = vi.hoisted(() => ({ userId: 0 }));
vi.mock("@/lib/auth", () => ({ UnauthorizedError: class UnauthorizedError extends Error {}, requireUser: async () => ({ id: auth.userId }), getSettingNumber: () => 2.5 }));
let directory: string;
let db: (typeof import("@/lib/db"))["db"];
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "magni-content-rehearsal-"));
  vi.stubEnv("DB_PATH", path.join(directory, "disposable.sqlite"));
  db = (await import("@/lib/db")).db;
  auth.userId = Number(db.prepare("INSERT INTO users(email,password_hash) VALUES ('content-rehearsal@example.test','hash')").run().lastInsertRowid);
});
afterAll(() => { db?.close(); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const request = (body: unknown, method = "POST") => new Request("http://localhost/api/rehearsal", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

it("rehearses candidate save, frozen activation, schedule, workout start, logging, completion and retry", async () => {
  const candidate = process.env.PROGRAM_TEMPLATE_CANDIDATE ?? path.join(process.cwd(), "program-templates", "full-body-supersets-3-day.json");
  const template = readTemplateFile(candidate) as ProgramTemplate;
  const document = compileProgramTemplate(template, { startDate: "2026-10-14" });
  expect(validateDocument(document)).toEqual([]);
  const repository = await import("../program-editor/repository");
  const start = await import("@/app/api/programs/[id]/sessions/route");
  const setRoute = await import("@/app/api/sessions/[sessionId]/sets/route");
  const complete = await import("@/app/api/programs/[id]/complete-and-advance/route");
  const id = crypto.randomUUID();
  const saved = repository.saveEditorDraft({ userId: auth.userId, id, document, expectedRevision: 0 });
  expect(repository.saveEditorDraft({ userId: auth.userId, id, document, expectedRevision: 0 })).toEqual(saved);
  const activation = repository.activateEditorDraft({ userId: auth.userId, id, expectedRevision: saved.revision });
  expect(repository.activateEditorDraft({ userId: auth.userId, id, expectedRevision: saved.revision })).toEqual(activation);
  const occurrences = db.prepare("SELECT * FROM workout_occurrences WHERE program_run_id=? ORDER BY slot_index").all(activation.runId) as Occurrence[];
  expect(occurrences).toHaveLength(template.days.length * template.cycles);
  for (const occurrence of occurrences) {
    expect(document.weekdays).toContain(new Date(`${occurrence.scheduled_date}T12:00:00Z`).getUTCDay());
    const dayIndex = occurrence.slot_index! % template.days.length;
    expect(JSON.parse(occurrence.prescription_json)).toHaveLength(document.weeks[0].days[dayIndex].exercises.reduce((count, exercise) => count + exercise.sets.length, 0));
  }
  const context = { params: Promise.resolve({ id: String(activation.programId) }) };
  for (const [dayIndex, occurrence] of occurrences.slice(0, template.days.length).entries()) {
    const response = await start.POST(request({ occurrenceId: occurrence.id }), context);
    expect(response.status).toBe(201);
    const session = await response.json() as { id: number; sets: { id: number; calculated_weight: number; editor_json: string }[] };
    const retry = await start.POST(request({ occurrenceId: occurrence.id }), context);
    expect(retry.status).toBe(200); expect((await retry.json()).id).toBe(session.id);
    const prescribedSets = document.weeks[0].days[dayIndex].exercises.flatMap(exercise => exercise.sets);
    expect(session.sets).toHaveLength(prescribedSets.length);
    for (const [index, set] of session.sets.entries()) {
      const frozen = JSON.parse(set.editor_json);
      expect(frozen.set).toEqual(prescribedSets[index]);
      const logged = await setRoute.PUT(request({ setId: set.id, actualReps: frozen.set.repMin, actualWeight: frozen.set.loadMode === "bodyweight" ? 0 : 20 }, "PUT"), { params: Promise.resolve({ sessionId: String(session.id) }) });
      expect(logged.status).toBe(200);
    }
    const completed = await complete.POST(request({ sessionId: session.id }), context);
    expect(completed.status).toBe(200);
    expect((await complete.POST(request({ sessionId: session.id }), context)).status).toBe(200);
  }
  expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
  expect(db.pragma("foreign_key_check")).toEqual([]);
}, 30000);
