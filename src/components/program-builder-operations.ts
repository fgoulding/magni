import { createExercise, type ProgramDayV1, type ProgramDocumentV1, type ProgramExerciseV1 } from "@/features/program-editor/document";
import { applySharedConfiguration, cloneExercise } from "@/features/program-editor/operations";

export function newBuilderExercise() {
  return { ...createExercise(), baseLoad: 0, trainingMax: 0 };
}
export function addBuilderSuperset(day: ProgramDayV1) {
  const groups = new Set(day.exercises.map(exercise => exercise.supersetGroup));
  let label = "A";
  for (let n = 0; groups.has(label); n++) label = String.fromCharCode(66 + n);
  day.exercises.push(...[newBuilderExercise(), newBuilderExercise()].map(exercise => ({ ...exercise, supersetGroup: label })));
}
export function compactPrescription(exercise: ProgramExerciseV1) {
  const first = exercise.sets[0];
  if (!first || first.role !== "work" || !["working", "bodyweight"].includes(first.loadMode) || exercise.rule?.condition.type === "designated_set") return null;
  const comparable = (set: typeof first) => JSON.stringify({ ...set, id: "" });
  return exercise.sets.every(set => comparable(set) === comparable(first)) ? first : null;
}
export function resizeBuilderSets(exercise: ProgramExerciseV1, count: number) {
  const set = compactPrescription(exercise);
  if (!set) throw new Error("Edit individual sets to preserve their prescriptions.");
  if (!Number.isInteger(count) || count < 1 || count > 30) return;
  while (exercise.sets.length < count) exercise.sets.push({ ...structuredClone(set), id: crypto.randomUUID() });
  exercise.sets.length = count;
}
export function builderGroups(day: ProgramDayV1) {
  const groups: { id: string; label: string; exercises: ProgramExerciseV1[] }[] = [];
  for (const exercise of day.exercises) {
    // Non-adjacent authored groups remain in their authored positions.
    const previous = groups.at(-1);
    if (exercise.supersetGroup && previous?.label === exercise.supersetGroup) previous.exercises.push(exercise);
    else groups.push({ id: exercise.id, label: exercise.supersetGroup, exercises: [exercise] });
  }
  return groups;
}
export function moveBuilderGroup(day: ProgramDayV1, index: number, offset: number) {
  const groups = builderGroups(day);
  const to = index + offset;
  if (to < 0 || to >= groups.length) return;
  [groups[index], groups[to]] = [groups[to], groups[index]];
  day.exercises = groups.flatMap(group => group.exercises);
}
export function updateBuilderLoad(document: ProgramDocumentV1, id: string, load: number) {
  const exercise = document.weeks.flatMap(week => week.days.flatMap(day => day.exercises)).find(exercise => exercise.id === id);
  if (!exercise) return;
  exercise.baseLoad = load;
  applySharedConfiguration(document, exercise);
}
export function previewBuilderSchedule(document: ProgramDocumentV1) {
  const date = new Date(`${document.startDate}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || !document.weekdays.length || !Number.isInteger(document.cycles) || document.cycles < 1 || document.cycles > 52) return [];
  const weekdays = new Set(document.weekdays);
  const days = document.weeks.flatMap(week => week.days);
  const slots: { date: string; name: string }[] = [];
  for (let cycle = 0; cycle < document.cycles; cycle++) for (const day of days) {
    let guard = 0;
    while (!weekdays.has(date.getUTCDay()) && guard++ < 7) date.setUTCDate(date.getUTCDate() + 1);
    if (guard > 7) return [];
    slots.push({ date: date.toISOString().slice(0, 10), name: day.name });
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return slots;
}

export function copyBuilderExercise(day: ProgramDayV1, exerciseId: string) {
  if (day.exercises.length >= 40) return;
  const source = day.exercises.find(exercise => exercise.id === exerciseId);
  const group = builderGroups(day).find(group => group.exercises.some(exercise => exercise.id === exerciseId));
  if (!source || !group) return;
  const lastIndex = day.exercises.indexOf(group.exercises.at(-1)!);
  const copy = { ...cloneExercise(source, false), supersetGroup: "" };
  day.exercises.splice(lastIndex + 1, 0, copy);
  return copy.id;
}
