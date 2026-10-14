/** Plain JavaScript shared by the app and the operator CLI. Version 1 supports
 * repeated manual/bodyweight weeks, never executable rules or arbitrary code. */
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const slug = value => typeof value === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(value);
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const text = (value, max, allowEmpty = false) => typeof value === "string" && value.length <= max && (allowEmpty || value.trim().length > 0);
const weekdaysValid = value => Array.isArray(value) && value.length > 0 && value.length <= 7 && new Set(value).size === value.length && value.every(day => integer(day, 0, 6));
const dateValid = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;

export function validateTemplate(value) {
  const issues = [];
  const add = (path, message) => issues.push({ path, message });
  const keys = (row, allowed, prefix) => { for (const key of Object.keys(row)) if (!allowed.includes(key)) add(`${prefix}${key}`, "Unsupported field in template version 1."); };
  if (!record(value)) return [{ path: "template", message: "A template object is required." }];
  keys(value, ["schemaVersion", "id", "revision", "title", "description", "unit", "cycles", "weekdays", "lifts", "days"], "");
  if (value.schemaVersion !== 1) add("schemaVersion", "Use template schema version 1.");
  if (!slug(value.id)) add("id", "Use a lowercase template identifier with letters, numbers and hyphens.");
  if (!integer(value.revision, 1, 1000000)) add("revision", "Use a positive revision number.");
  if (!text(value.title, 140)) add("title", "Enter a title up to 140 characters.");
  if (!text(value.description, 8000, true)) add("description", "Use description text up to 8000 characters.");
  if (!["lb", "kg"].includes(value.unit)) add("unit", "Choose lb or kg.");
  if (!integer(value.cycles, 1, 52)) add("cycles", "Choose 1 to 52 repeat cycles.");
  if (!weekdaysValid(value.weekdays)) add("weekdays", "Choose weekdays without duplicates.");
  const lifts = new Map();
  if (!Array.isArray(value.lifts) || !value.lifts.length || value.lifts.length > 40) add("lifts", "Use 1 to 40 lifts.");
  else for (const [index, lift] of value.lifts.entries()) {
    const prefix = `lifts.${index}.`;
    if (!record(lift)) { add(prefix, "A lift object is required."); continue; }
    keys(lift, ["id", "name", "loadMode", "notes"], prefix);
    if (!slug(lift.id) || lifts.has(lift.id)) add(`${prefix}id`, "Use a unique lift identifier.");
    lifts.set(lift.id, lift);
    if (!text(lift.name, 140)) add(`${prefix}name`, "Enter a lift name up to 140 characters.");
    if (!["working", "bodyweight"].includes(lift.loadMode)) add(`${prefix}loadMode`, "Version 1 supports working loads or bodyweight.");
    if (lift.notes !== undefined && !text(lift.notes, 2000, true)) add(`${prefix}notes`, "Use notes up to 2000 characters.");
  }
  const dayIds = new Set(); const slotIds = new Set(); let setCount = 0;
  if (Array.isArray(value.days) && Array.isArray(value.weekdays) && value.days.length !== value.weekdays.length) add("weekdays", "Choose one weekday for each training day.");
  if (!Array.isArray(value.days) || !value.days.length || value.days.length > 7) add("days", "Use 1 to 7 training days.");
  else for (const [dayIndex, day] of value.days.entries()) {
    const prefix = `days.${dayIndex}.`;
    if (!record(day)) { add(prefix, "A training day object is required."); continue; }
    keys(day, ["id", "name", "exercises"], prefix);
    if (!slug(day.id) || dayIds.has(day.id)) add(`${prefix}id`, "Use a unique training day identifier.");
    dayIds.add(day.id);
    if (!text(day.name, 140)) add(`${prefix}name`, "Enter a day name up to 140 characters.");
    if (!Array.isArray(day.exercises) || !day.exercises.length || day.exercises.length > 40) { add(`${prefix}exercises`, "Use 1 to 40 exercise slots."); continue; }
    for (const [index, slot] of day.exercises.entries()) {
      const sp = `${prefix}exercises.${index}.`;
      if (!record(slot)) { add(sp, "An exercise slot object is required."); continue; }
      keys(slot, ["id", "liftId", "supersetGroup", "sets", "repMin", "repMax", "effortRir", "restSeconds", "tempo", "notes"], sp);
      if (!slug(slot.id) || slotIds.has(slot.id)) add(`${sp}id`, "Use a slot identifier unique across the whole template.");
      slotIds.add(slot.id);
      if (!lifts.has(slot.liftId)) add(`${sp}liftId`, "Reference a lift defined in this template.");
      if (!text(slot.supersetGroup, 100, true)) add(`${sp}supersetGroup`, "Use a short group label or empty text.");
      if (!integer(slot.sets, 1, 30)) add(`${sp}sets`, "Choose 1 to 30 sets."); else setCount += slot.sets;
      if (!integer(slot.repMin, 1, 1000)) add(`${sp}repMin`, "Choose 1 to 1000 minimum reps.");
      if (!integer(slot.repMax, slot.repMin, 1000)) add(`${sp}repMax`, "Maximum reps must be at least the minimum.");
      if (slot.effortRir !== undefined && (typeof slot.effortRir !== "number" || !Number.isFinite(slot.effortRir) || slot.effortRir < 0 || slot.effortRir > 10)) add(`${sp}effortRir`, "Choose 0 to 10 reps in reserve.");
      if (slot.restSeconds !== undefined && !integer(slot.restSeconds, 0, 3600)) add(`${sp}restSeconds`, "Choose 0 to 3600 seconds rest.");
      if (slot.tempo !== undefined && !text(slot.tempo, 80, true)) add(`${sp}tempo`, "Use tempo text up to 80 characters.");
      if (slot.notes !== undefined && !text(slot.notes, 2000, true)) add(`${sp}notes`, "Use notes up to 2000 characters.");
      const combinedNotes = [slot.notes, lifts.get(slot.liftId)?.notes].filter(note => typeof note === "string" && note.length).join(" ");
      if (combinedNotes.length > 4000) add(`${sp}notes`, "Combined lift and slot notes must not exceed 4000 characters.");
    }
  }
  if (setCount > 10000) add("days", "Use at most 10000 sets per template.");
  return issues;
}

export class TemplateValidationError extends Error {
  constructor(issues) { super(issues.map(issue => `${issue.path}: ${issue.message}`).join("\n")); this.name = "TemplateValidationError"; this.issues = issues; }
}

export function compileTemplate(template, setup) {
  const issues = validateTemplate(template);
  if (issues.length) throw new TemplateValidationError(issues);
  if (!record(setup)) throw new TemplateValidationError([{ path: "setup", message: "Program setup is required." }]);
  const name = setup.name ?? template.title; const unit = setup.unit ?? template.unit;
  const cycles = setup.cycles ?? template.cycles; const weekdays = setup.weekdays ?? template.weekdays;
  if (!text(name, 140)) issues.push({ path: "name", message: "Enter a program name up to 140 characters." });
  if (!dateValid(setup.startDate)) issues.push({ path: "startDate", message: "Choose a valid start date." });
  if (!["lb", "kg"].includes(unit)) issues.push({ path: "unit", message: "Choose lb or kg." });
  if (!integer(cycles, 1, 52)) issues.push({ path: "cycles", message: "Choose 1 to 52 repeat cycles." });
  if (!weekdaysValid(weekdays)) issues.push({ path: "weekdays", message: "Choose weekdays without duplicates." });
  else if (weekdays.length !== template.days.length) issues.push({ path: "weekdays", message: "Choose one weekday for each training day." });
  if (dateValid(setup.startDate)) {
    const latest = new Date(`${setup.startDate}T12:00:00Z`); latest.setUTCDate(latest.getUTCDate() + template.days.length * cycles * 7);
    if (!Number.isFinite(latest.getTime()) || latest.getUTCFullYear() > 9999) issues.push({ path: "startDate", message: "The schedule extends beyond the supported calendar." });
  }
  const lifts = new Map(template.lifts.map(lift => [lift.id, lift]));
  const slots = new Map(template.days.flatMap(day => day.exercises.map(slot => [slot.id, slot])));
  const loads = setup.loads ?? {};
  if (!record(loads)) issues.push({ path: "loads", message: "Loads must be keyed by exercise slot." });
  else for (const [id, load] of Object.entries(loads)) {
    const slot = slots.get(id);
    if (!slot || typeof load !== "number" || !Number.isFinite(load) || load < 0 || load > 1000000 || (lifts.get(slot.liftId).loadMode === "bodyweight" && load !== 0)) {
      issues.push({ path: `loads.${id}`, message: "Use a nonnegative working load for a known slot; bodyweight slots remain unloaded." });
    }
  }
  if (issues.length) throw new TemplateValidationError(issues);
  const id = () => crypto.randomUUID();
  const historyKeys = new Map(template.lifts.map(lift => [lift.id, id()]));
  const document = { schemaVersion: 1, name: name.trim(), description: template.description, unit, cycles, weekdays: [...weekdays], startDate: setup.startDate,
    weeks: [{ id: id(), name: "Week 1", block: "", deload: false, days: template.days.map(day => ({ id: id(), name: day.name, exercises: day.exercises.map(slot => {
      const lift = lifts.get(slot.liftId);
      const notes = [slot.notes, lift.loadMode === "working" && !Object.hasOwn(loads, slot.id) ? "Choose your working weight before logging." : undefined].filter(Boolean).join(" ");
      return { id: id(), historyKey: historyKeys.get(lift.id), name: lift.name, progressionKey: id(), baseLoad: loads[slot.id] ?? 0, trainingMax: 0,
        supersetGroup: slot.supersetGroup, notes: [slot.notes, lift.notes].filter(Boolean).join(" "), rule: null,
        sets: Array.from({ length: slot.sets }, () => ({ id: id(), role: "work", repMin: slot.repMin, repMax: slot.repMax, loadMode: lift.loadMode, load: 0,
          effortKind: slot.effortRir === undefined ? "none" : "rir", effort: slot.effortRir ?? 0, restSeconds: slot.restSeconds ?? 120, tempo: slot.tempo ?? "", notes })) };
    }) })) }] };
  if (JSON.stringify(document).length > 2000000) throw new TemplateValidationError([{ path: "days", message: "The expanded program must be smaller than 2 MB. Reduce repeated sets or notes." }]);
  return document;
}

export function previewTemplate(template) {
  const issues = validateTemplate(template); if (issues.length) throw new TemplateValidationError(issues);
  const lifts = new Map(template.lifts.map(lift => [lift.id, lift]));
  return { id: template.id, revision: template.revision, title: template.title, cycles: template.cycles, weekdays: template.weekdays,
    workouts: template.days.length * template.cycles,
    days: template.days.map(day => ({ name: day.name, sets: day.exercises.reduce((sum, slot) => sum + slot.sets, 0), exercises: day.exercises.map(slot => ({
      name: lifts.get(slot.liftId).name, group: slot.supersetGroup, sets: slot.sets, reps: `${slot.repMin}–${slot.repMax}`, loadMode: lifts.get(slot.liftId).loadMode,
    })) })) };
}
