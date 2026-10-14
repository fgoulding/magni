import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import bundled from "../../../program-templates/full-body-supersets-3-day.json";
import { compileProgramTemplate, validateProgramTemplate, type ProgramTemplate, type TemplateSetup } from "./template";
import { validateDocument } from "../program-editor/document";

const template = bundled as ProgramTemplate;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "magni-template-contract-"));
afterAll(() => { fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe("declarative program templates", () => {
  it("compiles independent day loads, ranges, cues, bodyweight and fresh linked history", () => {
    expect(validateProgramTemplate(template)).toEqual([]);
    const setup = { startDate: "2026-10-14", weekdays: [1, 3, 5], cycles: 4, loads: { "squat-row": 45, "bench-row": 35, "squat-main": 135 } };
    const document = compileProgramTemplate(template, setup);
    expect(validateDocument(document)).toEqual([]);
    const days = document.weeks[0].days;
    expect(days[0].exercises[0].baseLoad).toBe(135);
    expect(days[0].exercises[1].baseLoad).toBe(45);
    expect(days[1].exercises[4].baseLoad).toBe(35);
    expect(days[2].exercises[4].baseLoad).toBe(0);
    expect(days[2].exercises[4].sets[0].notes).toContain("Choose your working weight before logging.");
    expect(days[0].exercises[0].sets[0].notes).not.toContain("Choose your working weight");
    expect(days[0].exercises[1].historyKey).toBe(days[1].exercises[4].historyKey);
    expect(days[0].exercises[1].progressionKey).not.toBe(days[1].exercises[4].progressionKey);
    expect(days[0].exercises[3].sets[0]).toMatchObject({ repMin: 6, repMax: 8, tempo: "1-second hover pause" });
    expect(days[0].exercises[4].sets[0].loadMode).toBe("bodyweight");
    expect(days[0].exercises[4].sets[0].notes).not.toContain("Choose your working weight");
    expect(compileProgramTemplate(template, setup).weeks[0].id).not.toBe(document.weeks[0].id);
  });

  it("rejects unsupported template capabilities, invalid references and ambiguous load keys", () => {
    for (const mutate of [
      (copy: ProgramTemplate) => { copy.schemaVersion = 2 as 1; },
      (copy: ProgramTemplate) => { copy.days[0].exercises[0].liftId = "missing"; },
      (copy: ProgramTemplate) => { copy.days[1].exercises[0].id = copy.days[0].exercises[0].id; },
      (copy: ProgramTemplate) => { copy.days[0].exercises[0].repMax = 1; },
      (copy: ProgramTemplate) => { Object.assign(copy.days[0].exercises[0], { rule: { malicious: "unsupported" } }); },
      (copy: ProgramTemplate) => { copy.id = "../outside"; },
      (copy: ProgramTemplate) => { copy.lifts[0].notes = "x".repeat(2000); copy.days[0].exercises[0].notes = "x".repeat(2000); },
    ]) {
      const copy = structuredClone(template); mutate(copy);
      expect(validateProgramTemplate(copy).length).toBeGreaterThan(0);
      expect(() => compileProgramTemplate(copy, { startDate: "2026-10-14" })).toThrow();
    }
  });

  it("validates setup without invented loads or silent unit conversions", () => {
    const document = compileProgramTemplate(template, { startDate: "2026-10-14", unit: "kg", loads: { "squat-main": 60 } });
    expect(document.unit).toBe("kg"); expect(document.weeks[0].days[0].exercises[0].baseLoad).toBe(60);
    const invalidSetups: TemplateSetup[] = [
      { startDate: "2026-02-30" }, { startDate: "2026-10-14", name: "" },
      { startDate: "2026-10-14", weekdays: [] }, { startDate: "2026-10-14", weekdays: [1, 1] },
      { startDate: "2026-10-14", weekdays: [1, 3] },
      { startDate: "2026-10-14", cycles: 0 }, { startDate: "2026-10-14", loads: { missing: 20 } },
      { startDate: "2026-10-14", loads: { "squat-main": -1 } },
      { startDate: "2026-10-14", loads: { "squat-pull-up": 20 } },
    ];
    for (const setup of invalidSetups) expect(() => compileProgramTemplate(template, setup)).toThrow();
  });

  it("rejects a compact recipe that expands beyond the persisted document limit", () => {
    const large = structuredClone(template);
    large.days = [{ id: "day", name: "Day", exercises: Array.from({ length: 40 }, (_, index) => ({
      id: `slot-${index}`, liftId: large.lifts[0].id, supersetGroup: "", sets: 30, repMin: 5, repMax: 8, notes: "x".repeat(1900),
    })) }];
    large.weekdays = [1];
    expect(() => compileProgramTemplate(large, { startDate: "2026-10-14" })).toThrow(/expanded program.*2 MB/);
  });

  it("activates a frozen owned copy once, unaffected by subsequent template changes", async () => {
    vi.stubEnv("DB_PATH", path.join(directory, "workouts.sqlite"));
    const { db } = await import("@/lib/db");
    const { saveEditorDraft, activateEditorDraft } = await import("../program-editor/repository");
    const userId = Number(db.prepare("INSERT INTO users(email,password_hash) VALUES ('template-owner@example.test','hash')").run().lastInsertRowid);
    const otherId = Number(db.prepare("INSERT INTO users(email,password_hash) VALUES ('template-other@example.test','hash')").run().lastInsertRowid);
    const id = crypto.randomUUID();
    const document = compileProgramTemplate(template, { startDate: "2026-10-14", loads: { "squat-main": 135 } });
    const saved = saveEditorDraft({ userId, id, document, expectedRevision: 0 });
    expect(saveEditorDraft({ userId, id, document, expectedRevision: 0 }).revision).toBe(saved.revision);
    expect(() => activateEditorDraft({ userId: otherId, id, expectedRevision: saved.revision })).toThrow("not found");
    const active = activateEditorDraft({ userId, id, expectedRevision: saved.revision });
    expect(activateEditorDraft({ userId, id, expectedRevision: saved.revision })).toEqual(active);
    const rows = db.prepare("SELECT scheduled_date, prescription_json FROM workout_occurrences WHERE program_id=? ORDER BY slot_index").all(active.programId) as { scheduled_date: string; prescription_json: string }[];
    expect(rows).toHaveLength(12);
    expect(rows.slice(0, 3).map(row => row.scheduled_date)).toEqual(["2026-10-14", "2026-10-16", "2026-10-19"]);
    expect(rows.every(row => JSON.parse(row.prescription_json).length === 26)).toBe(true);
    expect(JSON.parse(rows[0].prescription_json)[0].weight).toBe(135);
    const changed = structuredClone(template); changed.days[0].exercises[0].repMin = 2;
    compileProgramTemplate(changed, { startDate: "2026-10-14" });
    expect(JSON.parse(rows[0].prescription_json)[0].editor.set.repMin).toBe(4);
    db.close();
  });
});
