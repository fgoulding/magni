import { createBlankDocument, createDay, createExercise, type ProgramDayV1, type ProgramDocumentV1, type ProgramExerciseV1, type ProgramWeekV1 } from "./document";
import type { ProgressionRuleV1 } from "./progression";

export const PRESETS = [
  { id: "linear", title: "All-set linear", description: "Three straight sets; add load when every set reaches its target." },
  { id: "double", title: "Double progression", description: "Three sets of 8–12; add 2.5 when all reach 12." },
  { id: "percentage", title: "Percentage blocks", description: "Three build weeks, a deload, and repeating cycles." },
  { id: "top-backoff", title: "Top set and back-offs", description: "A top-set rule, lighter back-offs, and effort targets." },
  { id: "reset", title: "Repeated-failure reset", description: "All-set progression with a 10% reset after three misses." },
  { id: "manual-ab", title: "Manual A/B supersets", description: "Repeating days, paired exercises, and manual load control." },
] as const;
export type PresetId = typeof PRESETS[number]["id"];

export function cloneExercise(source: ProgramExerciseV1, share = true): ProgramExerciseV1 {
  const copied = structuredClone(source);
  copied.id = crypto.randomUUID();
  if (!share) copied.progressionKey = crypto.randomUUID();
  const ids = new Map(copied.sets.map(set => [set.id, crypto.randomUUID()]));
  copied.sets = copied.sets.map(set => ({ ...set, id: ids.get(set.id)! }));
  if (copied.rule?.condition?.type === "designated_set") copied.rule.condition.setId = ids.get(copied.rule.condition.setId) ?? "";
  return copied;
}
export function cloneDay(source: ProgramDayV1): ProgramDayV1 {
  return { ...structuredClone(source), id: crypto.randomUUID(), exercises: source.exercises.map(exercise => cloneExercise(exercise)) };
}
export function cloneWeek(source: ProgramWeekV1): ProgramWeekV1 {
  return { ...structuredClone(source), id: crypto.randomUUID(), name: `${source.name} copy`, days: source.days.map(cloneDay) };
}

/** Shared state and rule configuration follow one lift; set overrides stay local. */
export function applySharedConfiguration(document: ProgramDocumentV1, source: ProgramExerciseV1) {
  const condition = source.rule?.condition;
  const target = condition?.type === "designated_set" ? source.sets.find(set => set.id === condition.setId) : undefined;
  const designatedIndex = target ? source.sets.filter(set => set.role === target.role).findIndex(set => set.id === target.id) : -1;
  for (const week of document.weeks) for (const day of week.days) for (const exercise of day.exercises) {
    if (exercise.progressionKey !== source.progressionKey) continue;
    exercise.baseLoad = source.baseLoad;
    exercise.trainingMax = source.trainingMax;
    exercise.rule = structuredClone(source.rule);
    if (exercise.rule?.condition?.type === "designated_set") exercise.rule.condition.setId = exercise.sets.filter(set => set.role === target?.role)[designatedIndex]?.id ?? "";
  }
}

export function makePreset(id: PresetId, startDate: string): ProgramDocumentV1 {
  const document = createBlankDocument();
  document.startDate = startDate;
  document.name = PRESETS.find(preset => preset.id === id)?.title ?? "Custom program";
  document.cycles = 4;
  const exercise = createExercise("Dumbbell row");
  const rule: ProgressionRuleV1 = { version: 1, condition: { type: "all_work_sets", target: "minimum" }, action: { variable: "load", unit: "lb", operation: "add", amount: 2.5, rounding: { mode: "nearest", quantum: 2.5 }, timing: "per_exposure" }, skipPolicy: "hold", partialPolicy: "hold" };
  exercise.rule = rule;
  if (id === "double") rule.condition = { type: "double_progression" };
  else for (const set of exercise.sets) set.repMin = set.repMax = 5;
  if (id === "reset") rule.failureReset = { afterFailures: 3, percent: 10, rounding: { mode: "down", quantum: 2.5 } };
  document.weeks[0].days[0].exercises = [exercise];
  if (id === "top-backoff") {
    exercise.name = "Squat";
    exercise.baseLoad = 135;
    exercise.sets[0].role = "top";
    exercise.sets[0].repMin = 5; exercise.sets[0].repMax = 8;
    exercise.sets[0].effortKind = "rpe"; exercise.sets[0].effort = 8;
    for (const set of exercise.sets.slice(1)) { set.role = "backoff"; set.loadMode = "fixed"; set.load = 115; set.repMin = set.repMax = 8; set.effortKind = "rir"; set.effort = 2; }
    rule.condition = { type: "designated_set", setId: exercise.sets[0].id, targetReps: 8 };
  }
  if (id === "percentage") {
    exercise.name = "Squat"; exercise.trainingMax = 200;
    rule.condition = { type: "weekly" }; rule.action.variable = "trainingMax"; rule.action.timing = "weekly"; rule.action.amount = 5;
    for (const set of exercise.sets) { set.loadMode = "percent"; set.load = 65; }
    document.weeks[0].block = "Build";
    document.weeks = [0,1,2,3].map(index => {
      const week = cloneWeek(document.weeks[0]); week.name = `Week ${index + 1}`; week.deload = index === 3; week.block = index === 3 ? "Deload" : "Build";
      for (const set of week.days[0].exercises[0].sets) { set.load = [65,70,75,50][index]; set.repMin = set.repMax = index === 3 ? 5 : 8 - index; }
      return week;
    });
    document.cycles = 2;
  }
  if (id === "manual-ab") {
    exercise.rule = null; exercise.name = "Pull-up"; exercise.supersetGroup = "A";
    for (const set of exercise.sets) { set.loadMode = "bodyweight"; set.repMin = 6; set.repMax = 10; }
    const push = createExercise("Push-up"); push.supersetGroup = "A";
    for (const set of push.sets) { set.loadMode = "bodyweight"; set.repMin = 8; set.repMax = 15; }
    document.weeks[0].days[0].exercises.push(push);
    const dayB = createDay("Day B"); const squat = createExercise("Goblet squat"); const row = createExercise("Dumbbell row");
    squat.supersetGroup = row.supersetGroup = "B"; dayB.exercises = [squat, row]; document.weeks[0].days.push(dayB);
  }
  return document;
}
