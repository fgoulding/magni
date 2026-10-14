import { validateDocument, validateDraftStructure, type DocumentIssue, type ProgramDocumentV1 } from "../program-editor/document";
import { compileProgramTemplate, validateProgramTemplate, type ProgramTemplate } from "../program-templates/template";

export type ProgramFileV1 = {
  format: "magni.program";
  schemaVersion: 1;
  program: Pick<ProgramDocumentV1, "name" | "description" | "unit" | "weeks">;
  setup?: Partial<Pick<ProgramDocumentV1, "cycles" | "weekdays" | "startDate">>;
};
export type ProgramFileSource = "program-file" | "legacy-document" | "catalog-template";
export class ProgramFileError extends Error {
  constructor(public issues: DocumentIssue[]) { super(issues.map(issue => `${issue.path}: ${issue.message}`).join("\n")); this.name = "ProgramFileError"; }
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function keys(value: unknown, allowed: string[], path: string, issues: DocumentIssue[]) {
  if (!record(value)) return;
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push({ path: path ? `${path}.${key}` : key, message: "Unsupported field. Check the program JSON schema." });
}
function strictDocument(value: unknown): DocumentIssue[] {
  const issues: DocumentIssue[] = [];
  keys(value, ["schemaVersion", "name", "description", "unit", "cycles", "weekdays", "startDate", "weeks"], "", issues);
  if (!record(value) || !Array.isArray(value.weeks)) return issues;
  for (const [wi, week] of value.weeks.entries()) {
    const wp = `weeks.${wi}`; keys(week, ["id", "name", "block", "deload", "days"], wp, issues);
    if (!record(week) || !Array.isArray(week.days)) continue;
    for (const [di, day] of week.days.entries()) {
      const dp = `${wp}.days.${di}`; keys(day, ["id", "name", "exercises"], dp, issues);
      if (!record(day) || !Array.isArray(day.exercises)) continue;
      for (const [ei, exercise] of day.exercises.entries()) {
        const ep = `${dp}.exercises.${ei}`;
        keys(exercise, ["id", "historyKey", "name", "progressionKey", "baseLoad", "trainingMax", "supersetGroup", "notes", "rule", "sets"], ep, issues);
        if (!record(exercise)) continue;
        if (Array.isArray(exercise.sets)) for (const [si, set] of exercise.sets.entries()) keys(set, ["id", "role", "repMin", "repMax", "loadMode", "load", "effortKind", "effort", "restSeconds", "tempo", "notes"], `${ep}.sets.${si}`, issues);
        const rule = exercise.rule;
        keys(rule, ["version", "condition", "action", "skipPolicy", "partialPolicy", "failureReset"], `${ep}.rule`, issues);
        if (!record(rule)) continue;
        const condition = rule.condition;
        keys(condition, record(condition) && condition.type === "designated_set" ? ["type", "setId", "targetReps"] : record(condition) && condition.type === "all_work_sets" ? ["type", "target"] : ["type"], `${ep}.rule.condition`, issues);
        keys(rule.action, ["variable", "unit", "operation", "amount", "rounding", "timing"], `${ep}.rule.action`, issues);
        if (record(rule.action)) keys(rule.action.rounding, ["mode", "quantum"], `${ep}.rule.action.rounding`, issues);
        keys(rule.failureReset, ["afterFailures", "percent", "rounding"], `${ep}.rule.failureReset`, issues);
        if (record(rule.failureReset)) keys(rule.failureReset.rounding, ["mode", "quantum"], `${ep}.rule.failureReset.rounding`, issues);
      }
    }
  }
  return issues;
}
function validateImportDocument(value: unknown): asserts value is ProgramDocumentV1 {
  const structural = [...strictDocument(value), ...validateDraftStructure(value)];
  if (structural.length) throw new ProgramFileError(structural);
  const document = value as ProgramDocumentV1;
  // Importing/exporting an unfinished draft is useful; scheduling still requires
  // the full validator. Invalid prescriptions and identity references are errors.
  const incomplete = new Set(["Enter a name.", "Add a training week.", "Add a day to this week.", "Add an exercise to this day.", "Add at least one set."]);
  const issues = validateDocument(document).filter(issue => !(issue.path === "startDate" && document.startDate === "") && !incomplete.has(issue.message));
  if (issues.length) throw new ProgramFileError(issues);
}
export function parseProgramFile(input: unknown, options: { startDate?: string } = {}): { document: ProgramDocumentV1; source: ProgramFileSource } {
  let serialized: string;
  try { serialized = typeof input === "string" ? input : JSON.stringify(input); }
  catch { throw new ProgramFileError([{ path: "file", message: "Use serializable JSON." }]); }
  if (!serialized || new TextEncoder().encode(serialized).length > 2_000_000) throw new ProgramFileError([{ path: "file", message: "Program files must be smaller than 2 MB." }]);
  let value: unknown;
  try { value = typeof input === "string" ? JSON.parse(input) : structuredClone(input); }
  catch { throw new ProgramFileError([{ path: "file", message: "Enter valid JSON, without Markdown fences." }]); }
  if (!record(value)) throw new ProgramFileError([{ path: "file", message: "A program JSON object is required." }]);
  let document: unknown; let source: ProgramFileSource;
  if ("format" in value) {
    const issues: DocumentIssue[] = [];
    keys(value, ["format", "schemaVersion", "program", "setup"], "", issues);
    if (value.format !== "magni.program") issues.push({ path: "format", message: 'Use "magni.program".' });
    if (value.schemaVersion !== 1) issues.push({ path: "schemaVersion", message: "Unsupported program file version." });
    if (!record(value.program)) issues.push({ path: "program", message: "A program object is required." });
    keys(value.program, ["name", "description", "unit", "weeks"], "program", issues);
    if (value.setup !== undefined && !record(value.setup)) issues.push({ path: "setup", message: "Setup must be an object." });
    keys(value.setup, ["cycles", "weekdays", "startDate"], "setup", issues);
    if (issues.length) throw new ProgramFileError(issues);
    const setup = (value.setup ?? {}) as ProgramFileV1["setup"];
    document = { ...value.program as ProgramFileV1["program"], schemaVersion: 1, cycles: setup && "cycles" in setup ? setup.cycles : 1, weekdays: setup && "weekdays" in setup ? setup.weekdays : [1, 3, 5], startDate: setup && "startDate" in setup ? setup.startDate : options.startDate ?? "" };
    source = "program-file";
  } else if ("lifts" in value || "title" in value) {
    const issues = validateProgramTemplate(value); if (issues.length) throw new ProgramFileError(issues);
    // The compiler requires a valid date; absent personal dates remain unset in
    // the resulting draft, rather than becoming a silently scheduled date.
    const startDate = options.startDate ?? "";
    document = compileProgramTemplate(value as ProgramTemplate, { startDate: startDate || "2000-01-01" });
    (document as ProgramDocumentV1).startDate = startDate;
    source = "catalog-template";
  } else { document = value; source = "legacy-document"; }
  validateImportDocument(document);
  return { document, source };
}
export function exportProgramFile(document: ProgramDocumentV1): ProgramFileV1 {
  const issues = strictDocument(document); if (issues.length) throw new ProgramFileError(issues);
  const { name, description, unit, weeks, cycles, weekdays, startDate } = structuredClone(document);
  return { format: "magni.program", schemaVersion: 1, program: { name, description, unit, weeks }, setup: { cycles, weekdays, ...(startDate ? { startDate } : {}) } };
}
/** Only new imports/copies use this. In-place editing must preserve identities. */
export function scopeProgramDocument(document: ProgramDocumentV1): ProgramDocumentV1 {
  const result = structuredClone(document);
  const history = new Map<string, string>(); const progression = new Map<string, string>();
  const mapped = (map: Map<string, string>, key: string) => { if (!map.has(key)) map.set(key, crypto.randomUUID()); return map.get(key)!; };
  for (const week of result.weeks) {
    week.id = crypto.randomUUID();
    for (const day of week.days) {
      day.id = crypto.randomUUID();
      for (const exercise of day.exercises) {
        exercise.historyKey = mapped(history, exercise.historyKey ?? exercise.id);
        exercise.id = crypto.randomUUID(); exercise.progressionKey = mapped(progression, exercise.progressionKey);
        const sets = new Map(exercise.sets.map(set => [set.id, crypto.randomUUID()]));
        for (const set of exercise.sets) set.id = sets.get(set.id)!;
        if (exercise.rule?.condition.type === "designated_set") exercise.rule.condition.setId = sets.get(exercise.rule.condition.setId)!;
      }
    }
  }
  return result;
}
