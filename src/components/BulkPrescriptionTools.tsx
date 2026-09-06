"use client";

import { useState } from "react";
import type { ProgramDocumentV1 } from "@/features/program-editor/document";
import { fillSelectedPrescriptions, selectedPrescriptionTargets } from "@/features/program-editor/operations";

const control = "touch-target w-full rounded-xl border border-line bg-surface px-3 py-2 text-foreground outline-none focus:border-brand";
const button = "touch-target rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold disabled:opacity-50";

export function BulkPrescriptionTools({ document, weekIndex, dayIndex, exerciseIndex, onChange }: {
  document: ProgramDocumentV1; weekIndex: number; dayIndex: number; exerciseIndex: number;
  onChange: (update: (document: ProgramDocumentV1) => void) => void;
}) {
  const [scope, setScope] = useState<"exercise" | "day" | "week" | "program" | "selected">("exercise");
  const [selected, setSelected] = useState<string[]>([]);
  const [minimum, setMinimum] = useState(8);
  const [maximum, setMaximum] = useState(12);
  const [rest, setRest] = useState(120);
  const [error, setError] = useState("");
  const week = document.weeks[weekIndex];
  const day = week.days[dayIndex];
  const source = day.exercises[exerciseIndex];
  const selectedWeeks = document.weeks.filter(week => selected.includes(week.id));
  const targets = selectedPrescriptionTargets(document, source, selected);
  const bulkExercises = scope === "exercise" ? [source] : scope === "day" ? day.exercises
    : (scope === "week" ? [week] : scope === "selected" ? selectedWeeks : document.weeks)
      .flatMap(week => week.days.flatMap(day => day.exercises));
  const count = bulkExercises.reduce((total, exercise) => total + exercise.sets.filter(set => set.role !== "warmup").length, 0);
  const valid = Number.isInteger(minimum) && minimum >= 1 && Number.isInteger(maximum) && maximum >= minimum && maximum <= 1000
    && Number.isInteger(rest) && rest >= 0 && rest <= 3600;

  function apply() {
    const ids = new Set(bulkExercises.map(exercise => exercise.id));
    onChange(document => {
      for (const week of document.weeks) for (const day of week.days) for (const exercise of day.exercises) {
        if (ids.has(exercise.id)) for (const set of exercise.sets) if (set.role !== "warmup") {
          set.repMin = minimum; set.repMax = maximum; set.restSeconds = rest;
        }
      }
    });
    setError("");
  }

  function fill() {
    // Validate the whole operation before recording an undo entry or changing
    // any target. Missing designated sets must never be silently retargeted.
    try {
      fillSelectedPrescriptions(structuredClone(document), source.id, selected);
      onChange(document => { fillSelectedPrescriptions(document, source.id, selected); });
      setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not fill these weeks."); }
  }

  return <details className="rounded-xl border border-line p-3">
    <summary className="touch-target cursor-pointer text-sm font-semibold">Bulk edit and fill weeks</summary>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <label className="text-sm font-semibold">Apply to<select className={control} value={scope} onChange={event => setScope(event.target.value as typeof scope)}>
        <option value="exercise">This exercise</option><option value="day">This day</option><option value="week">This week</option><option value="selected">Selected weeks</option><option value="program">Entire program</option>
      </select></label>
      {([
        ["Bulk minimum reps", minimum, setMinimum], ["Bulk maximum reps", maximum, setMaximum], ["Bulk rest (seconds)", rest, setRest],
      ] as const).map(([label, value, update]) => <label key={label} className="text-sm font-semibold">{label}<input className={control} type="number" inputMode="numeric" value={value} onChange={event => update(Number(event.target.value))} /></label>)}
    </div>
    <p className="mt-2 text-sm text-muted">Updates {count} work, top, back-off and AMRAP sets. Warm-ups keep their targets. Undo restores the whole edit.</p>
    {!valid ? <p className="mt-2 text-sm text-danger-ink">Use whole reps from 1–1,000, maximum at least minimum, and rest from 0–3,600 seconds.</p> : null}
    <button className={`${button} mt-3`} disabled={!valid || !count} onClick={apply}>Apply bulk edit</button>
    <fieldset className="mt-4 border-t border-line pt-3">
      <legend className="text-sm font-semibold">Select weeks for bulk edit or fill</legend>
      <div className="mt-2 grid gap-1 sm:grid-cols-2 xl:grid-cols-3">{document.weeks.map((week, index) => <label key={week.id} className="touch-target flex min-w-0 items-center gap-2 rounded-xl bg-surface-muted px-3 py-2 text-sm">
        <input aria-label={`Select ${week.name || `Week ${index + 1}`}`} type="checkbox" checked={selected.includes(week.id)} onChange={event => setSelected(current => event.target.checked ? [...current, week.id] : current.filter(id => id !== week.id))} />
        <span className="min-w-0 break-words">{week.block ? `${week.block} · ` : ""}{week.name || `Week ${index + 1}`}{week.deload ? " · Deload" : ""}</span>
      </label>)}</div>
      <div className="mt-2 flex gap-2"><button className={button} onClick={() => setSelected(document.weeks.map(week => week.id))}>Select all weeks</button><button className={button} onClick={() => setSelected([])}>Clear selection</button></div>
    </fieldset>
    <div className="mt-4 border-t border-line pt-3">
      <p className="font-semibold">Fill from {source.name || "this exercise"}</p>
      <p className="mt-1 text-sm text-muted">Replace all set prescriptions, including warm-ups, in {targets.length} other appearance(s) sharing this lift’s progression. Loads, reps, effort, rest, tempo and set notes copy from {week.name} · {day.name}. Progression rules and other lifts stay as configured.</p>
      {targets.length ? <ul aria-label="Fill preview" className="mt-2 space-y-1 text-sm text-muted">{targets.map(({ week, day, exercise }) => <li key={exercise.id}>{week.name} · {day.name} · {exercise.name}</li>)}</ul> : null}
      {error ? <p role="alert" className="mt-2 text-sm text-danger-ink">{error}</p> : null}
      <button className={`${button} mt-3`} disabled={!targets.length} onClick={fill}>Fill selected weeks from this exercise</button>
    </div>
  </details>;
}
