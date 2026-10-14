"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Copy, Plus, Trash2 } from "lucide-react";
import { createDay, createSet, createWeek, validateDocument, type ProgramDocumentV1, type ProgramExerciseV1, type ProgramSetV1 } from "@/features/program-editor/document";
import { applySharedConfiguration, cloneDay, cloneExercise, cloneWeek } from "@/features/program-editor/operations";
import { validateProgressionRule } from "@/features/program-editor/progression";
import { prescriptionColumns, SetPrescriptionEditor } from "./SetPrescriptionEditor";
import { ReuseProgramExercise } from "./ReuseProgramExercise";
import { ProgressionRuleEditor } from "./ProgressionRuleEditor";
import { copyBuilderExercise, addBuilderSuperset, builderGroups, compactPrescription, moveBuilderGroup, newBuilderExercise, previewBuilderSchedule, resizeBuilderSets, updateBuilderLoad } from "./program-builder-operations";

const control = "touch-target w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2 text-foreground outline-none focus:border-brand";
const button = "touch-target inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold active:bg-surface-muted disabled:opacity-50";
const primary = "touch-target inline-flex items-center justify-center rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background disabled:opacity-50";
const field = "flex min-w-0 flex-col gap-1 text-sm font-semibold";
const roleNames = { work: "Work set", warmup: "Warm-up", top: "Top set", backoff: "Back-off", amrap: "AMRAP" };

function NumberField({ label, value, onChange, optional = false, max, min = 0, integer = false, shortLabel }: { label: string; shortLabel?: string; value: number; onChange: (value: number) => void; optional?: boolean; max?: number; min?: number; integer?: boolean }) {
  return <label className={field}>{shortLabel ?? label}<input aria-label={shortLabel ? label : undefined} className={control} type="number" min={min} max={max} step={integer ? 1 : "any"} inputMode={integer ? "numeric" : "decimal"} value={optional && value === 0 ? "" : value} placeholder={optional ? "Optional" : undefined} onChange={event => onChange(Number(event.target.value))} /></label>;
}
function setSummary(set: ProgramSetV1, exercise: ProgramExerciseV1, unit: string) {
  const load = set.loadMode === "bodyweight" ? "Bodyweight" : set.loadMode === "percent" ? `${set.load}% of max` : set.loadMode === "working" ? exercise.baseLoad ? `${exercise.baseLoad} ${unit}` : "Choose weight when training" : `${set.load} ${unit}${set.loadMode === "added" ? " added" : " fixed"}`;
  return `${roleNames[set.role]} · ${set.repMin}${set.repMax !== set.repMin ? `–${set.repMax}` : ""} reps · ${load}`;
}
function cuePreview(...notes: string[]) {
  const sentences = notes.flatMap(note => note.split(/(?<=[.!?])\s+|\n+/)).map(sentence => sentence.trim()).filter(Boolean);
  const unique = Array.from(new Set(sentences));
  const text = unique.join(" ");
  return text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text;
}
function setDetails(set: ProgramSetV1, notes = true) {
  return [set.restSeconds ? `${set.restSeconds}s rest` : "No rest", set.effortKind !== "none" ? `${set.effortKind.toUpperCase()} ${set.effort}` : "", set.tempo ? `Tempo ${set.tempo}` : "", notes ? cuePreview(set.notes) : ""].filter(Boolean).join(" · ");
}
function progressionSummary(exercise: ProgramExerciseV1) {
  const rule = exercise.rule;
  if (!rule || validateProgressionRule(rule).length) return "";
  const { action, condition } = rule;
  const variable = action.variable === "trainingMax" ? "training max" : action.variable;
  const amount = `${action.amount >= 0 ? "+" : ""}${action.amount}${action.operation === "percent" ? "%" : ` ${action.unit}`}`;
  const when = condition.type === "designated_set" ? `after set ${exercise.sets.findIndex(set => set.id === condition.setId) + 1} reaches ${condition.targetReps} reps`
    : condition.type === "weekly" ? "on the first complete workout of each program week"
    : `when all work sets reach their ${condition.type === "all_work_sets" && condition.target === "minimum" ? "minimum" : "upper"} rep targets`;
  return `Progression: ${variable} ${amount} ${when}${action.timing === "weekly" && condition.type !== "weekly" ? ", at most once per program week" : ""}${rule.failureReset ? `; reset after ${rule.failureReset.afterFailures} misses` : ""}.`;
}
function advancedSummary(exercise: ProgramExerciseV1) {
  const compact = compactPrescription(exercise);
  return [compact ? setDetails(compact, false) : "", compact ? cuePreview(compact.notes, exercise.notes) : cuePreview(exercise.notes), progressionSummary(exercise)].filter(Boolean).join(" · ");
}

export type ProgramBuilderProps = {
  document: ProgramDocumentV1;
  onChange: (update: (value: ProgramDocumentV1) => void) => void;
  onActivate: () => void;
  activating: boolean;
  activeId: number | null;
  onAdvanced: () => void;
  onExport: () => void;
  activeReview?: React.ReactNode;
};
export function ProgramBuilder({ document, onChange, onActivate, activating, activeId, onAdvanced, onExport, activeReview }: ProgramBuilderProps) {
  const container = useRef<HTMLDivElement>(null);
  const disclosurePrefix = useId();
  const [closedGroups, setClosedGroups] = useState<Set<string>>(() => new Set());
  const focusTarget = useRef<string | null>(null);
  const [announcement, announce] = useState("");
  useLayoutEffect(() => {
    if (!focusTarget.current) return;
    const target = Array.from(container.current?.querySelectorAll<HTMLInputElement>("[data-builder-focus]") ?? []).find(input => input.dataset.builderFocus === focusTarget.current);
    if (target) {
      // A membership edit can move this input into a newly mounted exercise card.
      // Reveal its local details before restoring focus to the same field.
      let ancestor = target.parentElement;
      while (ancestor && ancestor !== container.current) {
        if (ancestor.tagName === "DETAILS") (ancestor as HTMLDetailsElement).open = true;
        ancestor = ancestor.parentElement;
      }
      target.focus(); focusTarget.current = null;
    }
  });
  const [selectedWeek, selectWeek] = useState(0);
  const [selectedDay, selectDay] = useState(0);
  const [reviewing, review] = useState(false);
  const wi = Math.min(selectedWeek, Math.max(0, document.weeks.length - 1));
  const week = document.weeks[wi];
  const di = Math.min(selectedDay, Math.max(0, (week?.days.length ?? 0) - 1));
  const day = week?.days[di];
  const issues = validateDocument(document);
  const schedule = previewBuilderSchedule(document);
  const groups = day ? builderGroups(day) : [];
  const editExercise = (id: string, update: (exercise: ProgramExerciseV1) => void, shared = false) => onChange(value => {
    const exercise = value.weeks[wi].days[di].exercises.find(exercise => exercise.id === id)!;
    update(exercise);
    if (shared) applySharedConfiguration(value, exercise);
  });
  const editSupersetGroup = (exerciseId: string, supersetGroup: string) => {
    if (!day) return;
    const prospective = structuredClone(day);
    const exercise = prospective.exercises.find(item => item.id === exerciseId);
    if (!exercise) return;
    exercise.supersetGroup = supersetGroup;
    const destination = builderGroups(prospective).find(group => group.exercises.some(item => item.id === exerciseId))!;
    const identity = JSON.stringify([day.id, destination.id]);
    focusTarget.current = `${exerciseId}:superset`;
    setClosedGroups(previous => { const next = new Set(previous); next.delete(identity); return next; });
    editExercise(exerciseId, value => { value.supersetGroup = supersetGroup; });
  };
  const addDay = () => { focusTarget.current = "day"; onChange(value => value.weeks[wi].days.push(createDay(`Day ${value.weeks[wi].days.length + 1}`))); selectDay(week.days.length); };
  return <div ref={container} className="flex min-w-0 flex-col gap-5"><p role="status" aria-live="polite" className="sr-only">{announcement}</p>
    <section className="flex min-w-0 flex-wrap items-end gap-3">
      <label className={`${field} min-w-48 flex-1`}>Program name<input className={control} value={document.name} onChange={event => onChange(value => { value.name = event.target.value; })} /></label>
      <label className={`${field} w-28`}>Units<select className={control} value={document.unit} onChange={event => onChange(value => { value.unit = event.target.value as "lb" | "kg"; for (const exercise of value.weeks.flatMap(week => week.days.flatMap(day => day.exercises))) if (exercise.rule?.action.variable !== "reps" && exercise.rule?.action) exercise.rule.action.unit = value.unit; })}><option value="lb">lb</option><option value="kg">kg</option></select></label>
      <button type="button" className={primary} onClick={() => review(value => !value)}>{reviewing ? "Back to editing" : activeId ? "Review & apply" : "Review & start"}</button>
    </section>
    <p className="text-xs text-muted">{activeId ? "Your changes stay in this draft until you review and apply them." : "Private draft · Workouts are scheduled only when you start this program."} Changing units keeps the entered numbers.</p>
    {reviewing ? <section className="card flex min-w-0 flex-col gap-4 p-4 sm:p-5">
      <h2 className="display text-3xl">Review your program</h2>
      {!!issues.length && <div aria-label="Program validation" className="rounded-xl border border-warn-line bg-warn-soft p-3 text-sm text-warn-ink"><p className="font-semibold">Before you start</p>{issues.map((issue, index) => <p key={index} className="mt-1">{issue.path.replace(/weeks\.(\d+)\.days\.(\d+)\.exercises\.(\d+)/, (_, w, d, e) => `Week ${Number(w) + 1}, day ${Number(d) + 1}, exercise ${Number(e) + 1}`).replaceAll(".", " · ")}: {issue.message}</p>)}</div>}
      {activeId ? activeReview : <>
        <div className="grid gap-3 sm:grid-cols-2"><label className={field}>Start date<input className={control} type="date" value={document.startDate} onChange={event => onChange(value => { value.startDate = event.target.value; })} /></label><NumberField label={document.weeks.length === 1 && document.weeks[0].days.length === document.weekdays.length ? "Weeks" : "Repeat cycles"} min={1} max={52} integer value={document.cycles} onChange={cycles => onChange(value => { value.cycles = cycles; })} /></div>
        <fieldset><legend className="text-sm font-semibold">Training weekdays</legend><div className="mt-2 flex flex-wrap gap-2">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name, index) => <button type="button" key={name} aria-pressed={document.weekdays.includes(index)} className={`${button} ${document.weekdays.includes(index) ? "border-brand-line bg-brand-soft text-brand-strong" : ""}`} onClick={() => onChange(value => { value.weekdays = value.weekdays.includes(index) ? value.weekdays.filter(day => day !== index) : [...value.weekdays, index].sort(); })}>{name}</button>)}</div></fieldset>
        {schedule.length ? <div className="rounded-xl bg-surface-muted p-3 text-sm"><p className="font-semibold">First workout: {schedule[0].name} · {schedule[0].date}</p><p className="mt-1 text-muted">{schedule.length} workouts through {schedule.at(-1)?.date}. Days follow your chosen weekdays in order.</p><details className="mt-2"><summary className="touch-target cursor-pointer font-semibold">View schedule</summary><ol className="space-y-1 py-2 text-muted">{schedule.map((slot, index) => <li key={index}>{slot.date} · {slot.name}</li>)}</ol></details></div> : null}
      </>}
      {document.weeks.map((week, weekIndex) => <div key={week.id} className="border-t border-line pt-3">{(document.weeks.length > 1 || week.block || week.deload) && <h3 className="display text-2xl">{week.name}{week.block ? ` · ${week.block}` : ""}{week.deload ? " · Deload" : ""}</h3>}{week.days.map((day, dayIndex) => <div key={day.id} className="mt-3"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="display text-xl">{day.name}</h4><button type="button" className={button} aria-label={`Edit ${day.name}`} onClick={() => { focusTarget.current = "day"; selectWeek(weekIndex); selectDay(dayIndex); review(false); }}>Edit day</button></div>{day.exercises.map(exercise => <div key={exercise.id} className="mt-2 text-sm"><p className="font-semibold">{exercise.supersetGroup ? `${exercise.supersetGroup} · ` : ""}{exercise.name || "Unnamed exercise"} · {exercise.sets.length} sets</p><p className="break-words text-muted">{Array.from(new Set(exercise.sets.map(set => `${setSummary(set, exercise, document.unit)}${compactPrescription(exercise) ? "" : ` · ${setDetails(set)}`}`))).join(" / ")}</p><p className="break-words text-xs text-muted">{advancedSummary(exercise)}</p></div>)}</div>)}</div>)}

      {!activeId && <button type="button" className={primary} disabled={activating || issues.length > 0} onClick={onActivate}>{activating ? "Starting…" : "Start program"}</button>}
    </section> : <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="hidden min-w-0 flex-col gap-3 lg:flex" aria-label="Program days">{document.weeks.map((week, w) => <div key={week.id}>{(document.weeks.length > 1 || week.block || week.deload) && <p className="eyebrow mb-2 break-words text-xs text-muted">{week.block ? `${week.block} · ` : ""}{week.name}{week.deload ? " · Deload" : ""}</p>}<div className="flex flex-col gap-1">{week.days.map((day, d) => <button key={day.id} type="button" aria-pressed={wi === w && di === d} className={`touch-target rounded-xl px-3 py-3 text-left text-sm font-semibold ${wi === w && di === d ? "bg-brand-soft text-brand-strong" : "text-muted"}`} onClick={() => { selectWeek(w); selectDay(d); }}>{day.name || `Day ${d + 1}`}<span className="mt-1 block text-xs font-normal text-muted">{day.exercises.length} exercises</span></button>)}</div></div>)}</aside>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="grid gap-3 lg:hidden">{document.weeks.length === 1 && (week?.block || week?.deload) && <p className="text-sm text-muted">{week.block}{week.deload ? `${week.block ? " · " : ""}Deload week — hold progression` : ""}</p>}{document.weeks.length > 1 && <label className={field}>Week<select className={control} value={wi} onChange={event => { selectWeek(Number(event.target.value)); selectDay(0); }}>{document.weeks.map((week, index) => <option key={week.id} value={index}>{week.block ? `${week.block} · ` : ""}{week.name}{week.deload ? " · Deload" : ""}</option>)}</select></label>}<label className={field}>Day<select className={control} value={di} onChange={event => selectDay(Number(event.target.value))}>{week?.days.map((day, index) => <option key={day.id} value={index}>{day.name || `Day ${index + 1}`}</option>)}</select></label></div>
        {day ? <><div className="flex flex-wrap items-end gap-2"><label className={`${field} min-w-40 flex-1`}>Day name<input data-builder-focus="day" className={control} value={day.name} onChange={event => onChange(value => { value.weeks[wi].days[di].name = event.target.value; })} /></label><button type="button" className={button} disabled={week.days.length >= 14} onClick={() => { focusTarget.current = "day"; onChange(value => value.weeks[wi].days.splice(di + 1, 0, { ...cloneDay(value.weeks[wi].days[di]), name: `${day.name.slice(0, 130)} copy` })); selectDay(di + 1); }}><Copy size={16} aria-hidden="true" />Copy day</button><button type="button" className={button} aria-label="Move day earlier" disabled={di === 0} onClick={() => { onChange(value => { const days = value.weeks[wi].days; [days[di], days[di - 1]] = [days[di - 1], days[di]]; }); selectDay(di - 1); announce("Day moved earlier."); }}><ArrowUp size={16} aria-hidden="true" /></button><button type="button" className={button} aria-label="Move day later" disabled={di === week.days.length - 1} onClick={() => { onChange(value => { const days = value.weeks[wi].days; [days[di], days[di + 1]] = [days[di + 1], days[di]]; }); selectDay(di + 1); announce("Day moved later."); }}><ArrowDown size={16} aria-hidden="true" /></button><button type="button" className={button} aria-label="Remove day" disabled={week.days.length <= 1} onClick={() => { onChange(value => value.weeks[wi].days.splice(di, 1)); selectDay(Math.max(0, di - 1)); }}><Trash2 size={16} aria-hidden="true" /></button></div>
        {groups.map((group, index) => {
          const identity = JSON.stringify([day.id, group.id]);
          const expanded = !closedGroups.has(identity);
          const label = group.label ? `Superset ${group.label}` : group.exercises[0].name || `Exercise ${index + 1}`;
          const panelId = `${disclosurePrefix}-${encodeURIComponent(day.id)}-${encodeURIComponent(group.id)}`;
          const heading = group.label ? `Superset ${group.label} · ${new Set(group.exercises.map(exercise => exercise.sets.length)).size === 1 ? `${group.exercises[0].sets.length} rounds` : `${group.exercises.map(exercise => exercise.sets.length).join(" / ")} sets`}` : `Exercise ${index + 1}`;
          return <section key={identity} className="card min-w-0 overflow-hidden" aria-label={group.label ? `Superset ${group.label}` : `Exercise ${index + 1}`}>
            <div className={`flex min-w-0 flex-wrap items-center gap-2 px-3 py-2 ${expanded ? "border-b border-line" : ""}`}>
              <h2 className="min-w-0 flex-1"><button type="button" className="touch-target flex w-full min-w-0 items-center gap-2 rounded-xl px-1 py-2 text-left active:bg-surface-muted" aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`} aria-expanded={expanded} aria-controls={panelId} onClick={() => setClosedGroups(previous => { const next = new Set(previous); if (next.has(identity)) next.delete(identity); else next.add(identity); return next; })}><span className="display min-w-0 flex-1 break-words text-xl">{heading}</span>{expanded ? <ChevronUp aria-hidden="true" size={18} className="shrink-0 text-muted" /> : <ChevronDown aria-hidden="true" size={18} className="shrink-0 text-muted" />}</button></h2>
              <div className="flex gap-1"><button type="button" className={button} aria-label={`Move ${group.label ? `superset ${group.label}` : `exercise ${index + 1}`} earlier`} disabled={index === 0} onClick={() => { onChange(value => moveBuilderGroup(value.weeks[wi].days[di], index, -1)); announce("Exercise group moved earlier."); }}><ArrowUp size={16} aria-hidden="true" /></button><button type="button" className={button} aria-label={`Move ${group.label ? `superset ${group.label}` : `exercise ${index + 1}`} later`} disabled={index === groups.length - 1} onClick={() => { onChange(value => moveBuilderGroup(value.weeks[wi].days[di], index, 1)); announce("Exercise group moved later."); }}><ArrowDown size={16} aria-hidden="true" /></button></div>
            </div>
            {!expanded && <div aria-label={`${label} summary`} className="flex min-w-0 flex-col gap-3 px-4 pb-4">{group.exercises.map(exercise => <div key={exercise.id} className="min-w-0"><p className="break-words text-sm font-semibold">{exercise.name || "Unnamed exercise"} · {exercise.sets.length} sets</p>{compactPrescription(exercise) ? <p className="mt-1 break-words text-sm text-muted">{setSummary(exercise.sets[0], exercise, document.unit)}</p> : <><p className="mt-1 text-xs font-semibold text-muted">Individual sets</p><ol className="mt-1 space-y-1 text-sm text-muted">{exercise.sets.map((set, setIndex) => <li key={set.id} className="break-words"><span>{setIndex + 1}. {setSummary(set, exercise, document.unit)}</span><span className="mt-0.5 block text-xs leading-5">{setDetails(set)}</span></li>)}</ol></>}<p className="mt-1 break-words text-xs leading-5 text-muted">{advancedSummary(exercise)}</p></div>)}</div>}
            <div id={panelId} hidden={!expanded}>
              {group.exercises.map((exercise, ei) => <BuilderExercise key={exercise.id} document={document} exercise={exercise} index={ei} wi={wi} edit={update => editExercise(exercise.id, update)} editShared={update => editExercise(exercise.id, update, true)} onLoad={load => onChange(value => updateBuilderLoad(value, exercise.id, load))} onSupersetGroup={group => editSupersetGroup(exercise.id, group)} onCopy={() => onChange(value => { focusTarget.current = copyBuilderExercise(value.weeks[wi].days[di], exercise.id) ?? null; })} onRemove={() => onChange(value => { value.weeks[wi].days[di].exercises = value.weeks[wi].days[di].exercises.filter(item => item.id !== exercise.id); })} />)}
            </div>
          </section>;
        })}
        {!day.exercises.length && <div className="rounded-2xl border border-dashed border-line p-6 text-sm text-muted">Add the first exercise, or pair two lifts in a superset.</div>}
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={day.exercises.length >= 40} onClick={() => { const exercise = newBuilderExercise(); focusTarget.current = exercise.id; onChange(value => value.weeks[wi].days[di].exercises.push(exercise)); }}><Plus size={16} aria-hidden="true" />Add exercise</button><button type="button" className={button} disabled={day.exercises.length > 38} onClick={() => onChange(value => { const day = value.weeks[wi].days[di]; addBuilderSuperset(day); focusTarget.current = day.exercises.at(-2)!.id; })}><Plus size={16} aria-hidden="true" />Add superset</button></div>
        <ReuseProgramExercise key={day.id} document={document} disabled={day.exercises.length >= 40} onReuse={source => {
          if (day.exercises.length >= 40) return;
          const copy = { ...cloneExercise(source, false), supersetGroup: "" };
          focusTarget.current = copy.id;
          onChange(value => { value.weeks[wi].days[di].exercises.push(copy); });
          announce(`${copy.name || "Exercise"} added as an independent copy.`);
        }} /></> : null}
        {week && <button type="button" className={`${button} self-start`} disabled={week.days.length >= 14} onClick={addDay}><Plus size={16} aria-hidden="true" />Add day</button>}
      </div>
    </div>}
    <details className="rounded-xl border border-line p-4"><summary className="touch-target cursor-pointer text-sm font-semibold">Program details & more weeks</summary><div className="mt-3 flex flex-col gap-4"><label className={field}>Program notes<textarea className={`${control} min-h-24`} value={document.description} onChange={event => onChange(value => { value.description = event.target.value; })} /></label><NumberField label={document.weeks.length === 1 ? "Repeat this week" : "Repeat cycles"} min={1} max={52} integer value={document.cycles} onChange={cycles => onChange(value => { value.cycles = cycles; })} />{week && <div className="grid gap-3 sm:grid-cols-2"><label className={field}>Week name<input className={control} value={week.name} onChange={event => onChange(value => { value.weeks[wi].name = event.target.value; })} /></label><label className={field}>Block name<input className={control} value={week.block} onChange={event => onChange(value => { value.weeks[wi].block = event.target.value; })} /></label><label className="touch-target flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={week.deload} onChange={event => onChange(value => { value.weeks[wi].deload = event.target.checked; })} />Deload week — hold progression</label></div>}<div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={document.weeks.length >= 52} onClick={() => { focusTarget.current = "day"; onChange(value => value.weeks.push({ ...createWeek(`Week ${value.weeks.length + 1}`), days: [createDay("Day 1")] })); selectWeek(document.weeks.length); selectDay(0); review(false); }}>Add different week</button>{week && <button type="button" className={button} disabled={document.weeks.length >= 52} onClick={() => { focusTarget.current = "day"; onChange(value => value.weeks.splice(wi + 1, 0, cloneWeek(value.weeks[wi]))); selectWeek(wi + 1); selectDay(0); review(false); }}>Copy week</button>}</div><p className="text-sm text-muted">Copied days and weeks share their lifts’ progression. Use Details to make an appearance independent.</p></div></details>
    <div className="flex flex-wrap gap-2">{!reviewing && <button type="button" className={primary} onClick={() => review(true)}>{activeId ? "Review & apply" : "Review & start"}</button>}<button type="button" className={button} onClick={onExport}>Export JSON</button><button type="button" className={button} onClick={onAdvanced}>Advanced editing</button></div>
  </div>;
}

function BuilderExercise({ document, exercise, index, wi, edit, editShared, onLoad, onSupersetGroup, onCopy, onRemove }: { document: ProgramDocumentV1; exercise: ProgramExerciseV1; index: number; wi: number; edit: (update: (value: ProgramExerciseV1) => void) => void; editShared: (update: (value: ProgramExerciseV1) => void) => void; onLoad: (load: number) => void; onSupersetGroup: (group: string) => void; onCopy: () => void; onRemove: () => void }) {
  const compact = compactPrescription(exercise);
  const shared = document.weeks.flatMap(week => week.days.flatMap(day => day.exercises)).filter(item => item.progressionKey === exercise.progressionKey);
  const first = shared[0] ?? exercise;
  const initialReps = (first.sets.find(set => set.role !== "warmup") ?? first.sets[0])?.repMin ?? 0;
  const designatedId = exercise.rule?.condition.type === "designated_set" ? exercise.rule.condition.setId : undefined;
  return <fieldset aria-label={`Exercise ${index + 1}: ${exercise.name || "Unnamed exercise"}`} className="flex min-w-0 flex-col gap-3 border-b border-line p-4 last:border-b-0">
    <label className={field}>Exercise name<input data-builder-focus={exercise.id} className={control} value={exercise.name} onChange={event => edit(value => { value.name = event.target.value; })} /></label>
    {compact ? <div className="grid min-w-0 grid-cols-2 items-end gap-3 xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1.5fr)_minmax(0,1fr)]">
      <NumberField label="Sets" integer min={1} max={30} value={exercise.sets.length} onChange={count => edit(value => resizeBuilderSets(value, count))} />
      <div className="min-w-0 xl:col-start-3 xl:row-start-1">{compact.loadMode === "working" ? <NumberField label={`Working weight (${document.unit})`} optional value={exercise.baseLoad} onChange={onLoad} /> : <div className="flex min-h-11 items-center text-sm font-semibold">Bodyweight</div>}</div>
      <fieldset className="col-span-2 min-w-0 xl:col-span-1 xl:col-start-2 xl:row-start-1"><legend className="mb-1 text-sm font-semibold">Reps</legend><div className="grid min-w-0 grid-cols-2 gap-2"><NumberField label="Minimum reps" shortLabel="Min" integer min={1} value={compact.repMin} onChange={reps => edit(value => { for (const set of value.sets) set.repMin = reps; })} /><NumberField label="Maximum reps" shortLabel="Max" integer min={1} value={compact.repMax} onChange={reps => edit(value => { for (const set of value.sets) set.repMax = reps; })} /></div></fieldset>
    </div> : <><p className="text-sm font-semibold">Individual sets · {exercise.sets.length} sets</p><ol className="space-y-1 text-sm text-muted">{exercise.sets.map((set, index) => <li key={set.id} className="pb-1"><span>{index + 1}. {setSummary(set, exercise, document.unit)}</span><span className="mt-0.5 block break-words text-xs leading-5">{setDetails(set)}</span></li>)}</ol></>}
    <p aria-label="Exercise cues" className="break-words text-xs leading-5 text-muted">{advancedSummary(exercise)}</p>
    {shared.length > 1 && <p className="text-xs text-muted">Working weight and progression are shared across {shared.length} appearances. Set prescriptions stay local.</p>}
    <details className="min-w-0"><summary className="touch-target cursor-pointer text-sm font-semibold">{compact ? "Details" : "Edit individual sets"}</summary><div className="mt-3 flex min-w-0 flex-col gap-4">
      {compact ? <div className="grid grid-cols-2 gap-3"><NumberField label="Rest (seconds)" integer max={3600} value={compact.restSeconds} onChange={seconds => edit(value => { for (const set of value.sets) set.restSeconds = seconds; })} /><label className={field}>Effort<select className={control} value={compact.effortKind} onChange={event => edit(value => { for (const set of value.sets) { set.effortKind = event.target.value as ProgramSetV1["effortKind"]; if (set.effortKind === "rpe" && set.effort < 1) set.effort = 8; } })}><option value="none">No target</option><option value="rir">Reps in reserve</option><option value="rpe">RPE</option></select></label>{compact.effortKind !== "none" && <NumberField label="Effort target" max={10} value={compact.effort} onChange={effort => edit(value => { for (const set of value.sets) set.effort = effort; })} />}<label className={field}>Tempo<input className={control} value={compact.tempo} onChange={event => edit(value => { for (const set of value.sets) set.tempo = event.target.value; })} /></label><label className={field}>Load basis<select className={control} value={compact.loadMode} onChange={event => edit(value => { for (const set of value.sets) set.loadMode = event.target.value as "working" | "bodyweight"; })}><option value="working">Working weight</option><option value="bodyweight">Bodyweight</option></select></label></div> : <NumberField label={`Working weight (${document.unit})`} optional value={exercise.baseLoad} onChange={onLoad} />}
      <label className={field}>Exercise notes<textarea className={control} value={exercise.notes} onChange={event => edit(value => { value.notes = event.target.value; })} /></label>
      <details className="min-w-0" open={!compact}><summary className="touch-target cursor-pointer text-sm font-semibold">Individual set prescriptions</summary><div><div aria-hidden="true" className={`hidden gap-3 pb-2 text-xs font-semibold text-muted xl:grid ${prescriptionColumns}`}><span>Set</span><span>Reps (min–max)</span><span>Load</span><span>Rest (sec)</span><span /></div>{exercise.sets.map((set, index) => <SetPrescriptionEditor key={set.id} set={set} index={index} count={exercise.sets.length} unit={document.unit} workingLoad={exercise.baseLoad} onChange={patch => edit(value => Object.assign(value.sets[index], patch))} onMove={offset => edit(value => { [value.sets[index], value.sets[index + offset]] = [value.sets[index + offset], value.sets[index]]; })} onCopy={() => edit(value => { if (value.sets.length < 30) value.sets.splice(index + 1, 0, { ...structuredClone(set), id: crypto.randomUUID() }); })} onRemove={() => { if (set.id !== designatedId) edit(value => value.sets.splice(index, 1)); }} />)}{designatedId && <p className="text-sm text-muted">The designated progression set is protected from removal. Choose another target in Progression first.</p>}<button type="button" className={button} disabled={exercise.sets.length >= 30} onClick={() => edit(value => value.sets.push(createSet()))}>Add set</button></div></details>
      <details className="min-w-0"><summary className="touch-target cursor-pointer text-sm font-semibold">Progression</summary><div className="mt-3 flex min-w-0 flex-col gap-3"><NumberField label={`Explicit training max (${document.unit})`} value={exercise.trainingMax} onChange={max => editShared(value => { value.trainingMax = max; })} />{shared.length > 1 && <><p className="text-sm text-muted">Changes apply to: {document.weeks.flatMap(week => week.days.flatMap(day => day.exercises.filter(item => item.progressionKey === exercise.progressionKey).map(item => `${week.name} · ${day.name} · ${item.name}`))).join("; ")}.</p><button type="button" className={button} onClick={() => edit(value => { value.progressionKey = crypto.randomUUID(); })}>Progress this appearance independently</button></>}<ProgressionRuleEditor rule={exercise.rule} onChange={rule => editShared(value => { value.rule = rule; })} sets={exercise.sets} initialReps={initialReps} state={{ load: exercise.baseLoad, trainingMax: exercise.trainingMax, reps: initialReps, consecutiveFailures: 0, lastEvaluatedWeek: null }} unit={document.unit} week={wi + 1} isDeload={document.weeks[wi].deload} /></div></details>
      <label className={field}>Superset group<input data-builder-focus={`${exercise.id}:superset`} className={control} value={exercise.supersetGroup} onChange={event => onSupersetGroup(event.target.value)} /></label><div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={onCopy}><Copy size={16} aria-hidden="true" />Copy exercise</button><button type="button" className={`${button} text-danger-ink`} onClick={onRemove}><Trash2 size={16} aria-hidden="true" />Remove exercise</button></div>
    </div></details>
  </fieldset>;
}
