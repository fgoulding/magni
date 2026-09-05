import { validateProgressionRule, type ProgressionRuleV1, type ProgressionSetRole } from "./progression";

export type ProgramSetV1 = {
  id: string;
  role: ProgressionSetRole;
  repMin: number;
  repMax: number;
  loadMode: "working" | "fixed" | "percent" | "bodyweight" | "added";
  load: number;
  effortKind: "none" | "rpe" | "rir";
  effort: number;
  restSeconds: number;
  tempo: string;
  notes: string;
};
export type ProgramExerciseV1 = {
  id: string;
  name: string;
  progressionKey: string;
  baseLoad: number;
  trainingMax: number;
  supersetGroup: string;
  notes: string;
  rule: ProgressionRuleV1 | null;
  sets: ProgramSetV1[];
};
export type ProgramDayV1 = { id: string; name: string; exercises: ProgramExerciseV1[] };
export type ProgramWeekV1 = { id: string; name: string; block: string; deload: boolean; days: ProgramDayV1[] };
export type ProgramDocumentV1 = {
  schemaVersion: 1;
  name: string;
  description: string;
  unit: "lb" | "kg";
  cycles: number;
  weekdays: number[];
  startDate: string;
  weeks: ProgramWeekV1[];
};
export type DocumentIssue = { path: string; message: string };

export function createSet(): ProgramSetV1 {
  return { id: crypto.randomUUID(), role: "work", repMin: 8, repMax: 12, loadMode: "working", load: 0, effortKind: "none", effort: 0, restSeconds: 120, tempo: "", notes: "" };
}
export function createExercise(name = ""): ProgramExerciseV1 {
  return { id: crypto.randomUUID(), name, progressionKey: crypto.randomUUID(), baseLoad: 40, trainingMax: 100, supersetGroup: "", notes: "", rule: null, sets: [createSet(), createSet(), createSet()] };
}
export function createDay(name = "Day A"): ProgramDayV1 {
  return { id: crypto.randomUUID(), name, exercises: [] };
}
export function createWeek(name = "Week 1"): ProgramWeekV1 {
  return { id: crypto.randomUUID(), name, block: "", deload: false, days: [] };
}
export function createBlankDocument(): ProgramDocumentV1 {
  return { schemaVersion: 1, name: "", description: "", unit: "lb", cycles: 1, weekdays: [1, 3, 5], startDate: "", weeks: [{ ...createWeek(), days: [createDay()] }] };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const dateKeyIsValid = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** Structural validation permits unfinished names, empty arrays and contextual
 * numeric errors. Such drafts can be saved, but never activated until valid. */
export function validateDraftStructure(value: unknown): DocumentIssue[] {
  const issues: DocumentIssue[] = [];
  const issue = (path: string, message: string) => { issues.push({ path, message }); };
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); } catch { issue("document", "Document must be serializable JSON."); }
  if (serialized && serialized.length > 2_000_000) issue("document", "Draft must be smaller than 2 MB.");
  if (!isRecord(value)) return [...issues, { path: "document", message: "A program document is required." }];
  if (value.schemaVersion !== 1) issue("schemaVersion", "Unsupported document version.");
  const text = (row: Record<string, unknown>, key: string, prefix: string, max = 140) => {
    if (typeof row[key] !== "string" || (row[key] as string).length > max) issue(`${prefix}${key}`, `Enter text no longer than ${max} characters.`);
  };
  const number = (row: Record<string, unknown>, key: string, prefix: string) => {
    if (typeof row[key] !== "number" || !Number.isFinite(row[key]) || Math.abs(row[key]) > 1_000_000) issue(`${prefix}${key}`, "Enter a finite number within one million.");
  };
  const rows = (row: Record<string, unknown>, key: string, prefix: string, max: number): Record<string, unknown>[] => {
    const items = row[key];
    if (!Array.isArray(items) || items.length > max || items.some((item) => !isRecord(item))) {
      issue(`${prefix}${key}`, `Use an array with at most ${max} entries.`); return [];
    }
    return items;
  };
  text(value, "name", ""); text(value, "description", "", 8000); text(value, "unit", "", 2); text(value, "startDate", "", 10); number(value, "cycles", "");
  if (!Array.isArray(value.weekdays) || value.weekdays.length > 7 || value.weekdays.some((day) => typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6)) issue("weekdays", "Weekdays must be numbers from 0 to 6.");
  let setCount = 0;
  for (const [wi, week] of rows(value, "weeks", "", 52).entries()) {
    const wp = `weeks.${wi}.`;
    text(week, "id", wp, 100); text(week, "name", wp); text(week, "block", wp);
    if (typeof week.deload !== "boolean") issue(`${wp}deload`, "Deload must be true or false.");
    for (const [di, day] of rows(week, "days", wp, 14).entries()) {
      const dp = `${wp}days.${di}.`;
      text(day, "id", dp, 100); text(day, "name", dp);
      for (const [ei, exercise] of rows(day, "exercises", dp, 40).entries()) {
        const ep = `${dp}exercises.${ei}.`;
        text(exercise, "id", ep, 100); text(exercise, "name", ep); text(exercise, "progressionKey", ep, 120);
        text(exercise, "supersetGroup", ep, 100); text(exercise, "notes", ep, 4000);
        number(exercise, "baseLoad", ep); number(exercise, "trainingMax", ep);
        if (exercise.rule !== null && !isRecord(exercise.rule)) issue(`${ep}rule`, "Rule must be an object or null.");
        for (const [si, set] of rows(exercise, "sets", ep, 30).entries()) {
          setCount++;
          const sp = `${ep}sets.${si}.`;
          text(set, "id", sp, 100); text(set, "role", sp, 20); text(set, "loadMode", sp, 20); text(set, "effortKind", sp, 10);
          text(set, "tempo", sp, 80); text(set, "notes", sp, 4000);
          for (const key of ["repMin", "repMax", "load", "effort", "restSeconds"]) number(set, key, sp);
        }
      }
    }
  }
  if (setCount > 10000) issue("weeks", "Use at most 10,000 set prescriptions in one document.");
  return issues;
}

/** Full activation validation; dot-separated paths match the editor's fields. */
export function validateDocument(value: unknown): DocumentIssue[] {
  const structural = validateDraftStructure(value);
  if (structural.length) return structural;
  const doc = value as ProgramDocumentV1;
  const issues: DocumentIssue[] = [];
  const add = (path: string, message: string) => { issues.push({ path, message }); };
  const ids = new Set<string>();
  const identity = (id: string, path: string) => {
    if (!id.trim() || ids.has(id)) add(path, "Use a unique nonempty ID; copies need their own IDs.");
    ids.add(id);
  };
  const name = (value: string, path: string) => { if (!value.trim()) add(path, "Enter a name."); };
  if (doc.unit !== "lb" && doc.unit !== "kg") add("unit", "Choose lb or kg.");
  name(doc.name, "name");
  if (!Number.isInteger(doc.cycles) || doc.cycles < 1 || doc.cycles > 52) add("cycles", "Choose 1 to 52 repeating cycles.");
  if (!dateKeyIsValid(doc.startDate)) add("startDate", "Choose a valid start date.");
  if (doc.weekdays.length === 0 || new Set(doc.weekdays).size !== doc.weekdays.length) add("weekdays", "Choose at least one weekday without duplicates.");
  if (doc.weeks.length === 0) add("weeks", "Add a training week.");
  const workoutCount = doc.weeks.reduce((total, week) => total + week.days.length, 0) * doc.cycles;
  if (workoutCount > 3640) add("cycles", "Limit the schedule to 3,640 workouts.");
  if (dateKeyIsValid(doc.startDate)) {
    const latestDate = new Date(`${doc.startDate}T12:00:00Z`);
    latestDate.setUTCDate(latestDate.getUTCDate() + Math.min(workoutCount, 3640) * 7);
    if (latestDate.getUTCFullYear() > 9999) add("startDate", "Choose a start date that keeps the schedule within the supported calendar range.");
  }
  const shared = new Map<string, string>();
  for (const [wi, week] of doc.weeks.entries()) {
    const wp = `weeks.${wi}.`;
    identity(week.id, `${wp}id`); name(week.name, `${wp}name`);
    if (!week.days.length) add(`${wp}days`, "Add a day to this week.");
    for (const [di, day] of week.days.entries()) {
      const dp = `${wp}days.${di}.`;
      identity(day.id, `${dp}id`); name(day.name, `${dp}name`);
      if (!day.exercises.length) add(`${dp}exercises`, "Add an exercise to this day.");
      const dayKeys = new Set<string>();
      for (const [ei, exercise] of day.exercises.entries()) {
        const ep = `${dp}exercises.${ei}.`;
        identity(exercise.id, `${ep}id`); name(exercise.name, `${ep}name`);
        if (exercise.baseLoad < 0) add(`${ep}baseLoad`, "Working load cannot be negative.");
        if (exercise.trainingMax < 0 || (exercise.trainingMax === 0 && exercise.sets.some((set) => set.loadMode === "percent"))) add(`${ep}trainingMax`, "Percentage sets require an explicit positive training max.");
        if (!exercise.progressionKey.trim() || dayKeys.has(exercise.progressionKey)) add(`${ep}progressionKey`, "Use a distinct progression key for each exercise in this workout.");
        dayKeys.add(exercise.progressionKey);
        // Copies renew IDs. Share the target ordinal within its role so inserting
        // a warm-up or back-off override cannot retarget the designated top set.
        // while the stored rule still points at this appearance's actual set ID.
        const condition = exercise.rule?.condition;
        const target = condition?.type === "designated_set" ? exercise.sets.find((set) => set.id === condition.setId) : undefined;
        const targetIndex = target ? exercise.sets.filter(set => set.role === target.role).findIndex(set => set.id === target.id) : -1;
        const sharedRule = condition?.type === "designated_set" ? {
          ...exercise.rule, condition: { ...condition, setId: `role:${target?.role ?? "missing"}:${targetIndex}` },
        } : exercise.rule;
        const stateDefinition = JSON.stringify([exercise.baseLoad, exercise.trainingMax, sharedRule], (_key, row) =>
          isRecord(row) ? Object.fromEntries(Object.keys(row).sort().map((key) => [key, row[key]])) : row,
        );
        if (shared.has(exercise.progressionKey) && shared.get(exercise.progressionKey) !== stateDefinition) add(`${ep}progressionKey`, "Shared progression must use the same initial load, max and rule; separate the key to progress independently.");
        shared.set(exercise.progressionKey, stateDefinition);
        const ruleErrors = validateProgressionRule(exercise.rule);
        for (const message of ruleErrors) add(`${ep}rule`, message);
        if (!ruleErrors.length && exercise.rule) {
          if (exercise.rule.action.variable !== "reps" && exercise.rule.action.unit !== doc.unit) add(`${ep}rule.action.unit`, "Progression units must match the program.");
          if (exercise.rule.condition.type === "designated_set") {
            const target = exercise.rule.condition.setId;
            if (!exercise.sets.some((set) => set.id === target && (set.role === "top" || set.role === "amrap"))) add(`${ep}rule.condition.setId`, "Choose a top or AMRAP set from this exercise.");
          }
        }
        if (!exercise.sets.length) add(`${ep}sets`, "Add at least one set.");
        for (const [si, set] of exercise.sets.entries()) {
          const sp = `${ep}sets.${si}.`;
          identity(set.id, `${sp}id`);
          if (!["warmup", "work", "top", "backoff", "amrap"].includes(set.role)) add(`${sp}role`, "Choose a supported set role.");
          if (!Number.isInteger(set.repMin) || set.repMin < 1 || set.repMin > 1000) add(`${sp}repMin`, "Minimum reps must be a whole number from 1 to 1,000.");
          if (!Number.isInteger(set.repMax) || set.repMax < set.repMin || set.repMax > 1000) add(`${sp}repMax`, "Maximum reps must be whole, at least the minimum and at most 1,000.");
          if (!["working", "fixed", "percent", "bodyweight", "added"].includes(set.loadMode)) add(`${sp}loadMode`, "Choose a supported load mode.");
          if (set.load < 0 || (set.loadMode === "percent" && set.load > 200)) add(`${sp}load`, "Load must be nonnegative; percentages cannot exceed 200%.");
          if (!["none", "rpe", "rir"].includes(set.effortKind)) add(`${sp}effortKind`, "Choose no effort target, RPE or RIR.");
          if (set.effortKind !== "none" && (set.effort < (set.effortKind === "rpe" ? 1 : 0) || set.effort > 10)) add(`${sp}effort`, "Use RPE 1–10 or RIR 0–10.");
          if (!Number.isInteger(set.restSeconds) || set.restSeconds < 0 || set.restSeconds > 3600) add(`${sp}restSeconds`, "Rest must be whole seconds from 0 to 3,600.");
        }
      }
    }
  }
  return issues;
}
