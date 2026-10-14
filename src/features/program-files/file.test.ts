import { describe, expect, it } from "vitest";
import { makePreset } from "../program-editor/operations";
import { cloneExercise } from "../program-editor/operations";
import bundled from "../../../program-templates/full-body-supersets-3-day.json";
import * as files from "./file";

describe("public program files", () => {
  it("round-trips advanced prescriptions and shared relationships without a start date", () => {
    const document = makePreset("top-backoff", "2026-10-13");
    document.weeks[0].days[0].exercises[0].sets[0].notes = "Retain this exact cue";
    const exported = files.exportProgramFile(document);
    expect(exported.format).toBe("magni.program");
    expect(exported.program).not.toHaveProperty("startDate");
    expect(files.parseProgramFile(JSON.stringify(exported)).document).toEqual(document);
    delete exported.setup!.startDate;
    expect(files.parseProgramFile(exported).document.startDate).toBe("");
    expect(files.parseProgramFile(exported, { startDate: "2026-10-20" }).document.startDate).toBe("2026-10-20");
  });
  it("accepts old rich documents and compact catalog templates without losing prescriptions", () => {
    const rich = makePreset("percentage", "2026-10-13");
    expect(files.parseProgramFile(rich)).toEqual({ document: rich, source: "legacy-document" });
    const parsed = files.parseProgramFile(bundled, { startDate: "2026-10-13" });
    expect(parsed.source).toBe("catalog-template");
    expect(parsed.document.weeks[0].days.map(day => day.exercises.reduce((n, ex) => n + ex.sets.length, 0))).toEqual([26,26,26]);
  });
  it("scopes new identities while preserving shared history, progression and designated set targets", () => {
    const original = makePreset("top-backoff", "2026-10-13");
    const first = original.weeks[0].days[0].exercises[0];
    original.weeks[0].days.push({ id: "second-day", name: "Second", exercises: [cloneExercise(first)] });
    const scoped = files.scopeProgramDocument(original);
    const [a, b] = scoped.weeks[0].days.map(day => day.exercises[0]);
    expect(a.id).not.toBe(first.id); expect(a.historyKey).not.toBe(first.historyKey);
    expect(a.historyKey).toBe(b.historyKey); expect(a.progressionKey).toBe(b.progressionKey);
    expect(a.rule?.condition).toMatchObject({ type: "designated_set", setId: a.sets.find(set => set.role === "top")!.id });
    expect(original.weeks[0].days[0].exercises[0]).toBe(first);
  });
  it.each([
    ["unknown version", (file: ReturnType<typeof files.exportProgramFile>) => { file.schemaVersion = 99 as 1; }],
    ["unknown field", (file: ReturnType<typeof files.exportProgramFile>) => { Object.assign(file.program, { code: "run()" }); }],
    ["invalid nested field", (file: ReturnType<typeof files.exportProgramFile>) => { Object.assign(file.program.weeks[0].days[0].exercises[0].sets[0], { reps: 4 }); }],
    ["invalid reps", (file: ReturnType<typeof files.exportProgramFile>) => { file.program.weeks[0].days[0].exercises[0].sets[0].repMin = -1; }],
    ["unknown progression", (file: ReturnType<typeof files.exportProgramFile>) => { Object.assign(file.program.weeks[0].days[0].exercises[0].rule!, { code: "run()" }); }],
  ])("rejects %s with field-specific errors", (_name, modify) => {
    const file = files.exportProgramFile(makePreset("top-backoff", "2026-10-13")); modify(file);
    expect(() => files.parseProgramFile(file)).toThrow(files.ProgramFileError);
    try { files.parseProgramFile(file); } catch (error) { expect((error as InstanceType<typeof files.ProgramFileError>).issues[0].path).toBeTruthy(); }
  });
  it("retains unfinished names and empty days as drafts but bounds input and rejects malformed JSON", () => {
    const doc = makePreset("double", ""); doc.name = ""; doc.weeks[0].days[0].exercises = [];
    expect(files.parseProgramFile(files.exportProgramFile(doc)).document).toEqual(doc);
    expect(() => files.parseProgramFile("{" )).toThrow(files.ProgramFileError);
    expect(() => files.parseProgramFile(" ".repeat(2_000_001))).toThrow(/2 MB/);
  });
});

it.each(["cycles","weekdays","startDate"])("rejects explicit null setup.%s instead of substituting defaults", key => {
  const file=files.exportProgramFile(makePreset("double","")); Object.assign(file.setup!,{[key]:null});
  expect(()=>files.parseProgramFile(file)).toThrow(files.ProgramFileError);
});
it("refuses export when an unsupported hidden field would otherwise be dropped",()=>{
  const doc=makePreset("double",""); Object.assign(doc,{customEngine:"unknown"});
  expect(()=>files.exportProgramFile(doc)).toThrow(files.ProgramFileError);
});
