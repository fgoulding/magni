"use client";

import { useState } from "react";
import type { ProgramDocumentV1, ProgramExerciseV1 } from "@/features/program-editor/document";

export function ReuseProgramExercise({ document, disabled, onReuse }: {
  document: ProgramDocumentV1;
  disabled: boolean;
  onReuse: (source: ProgramExerciseV1) => void;
}) {
  const [selected, setSelected] = useState("");
  const options = document.weeks.flatMap(week => week.days.flatMap(day => day.exercises.map(exercise => ({
    exercise, label: `${exercise.name || "Unnamed exercise"} · ${week.name} · ${day.name}`,
  }))));
  const source = options.find(option => option.exercise.id === selected)?.exercise;
  if (!options.length) return null;
  return <details className="rounded-xl border border-line p-3">
    <summary className="touch-target cursor-pointer text-sm font-semibold">Reuse an exercise</summary>
    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="min-w-0 flex-1 text-sm font-semibold">Exercise to reuse
        <select className="touch-target mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-foreground outline-none focus:border-brand" value={source ? selected : ""} onChange={event => setSelected(event.target.value)}>
          <option value="">Choose from this program</option>
          {options.map(option => <option key={option.exercise.id} value={option.exercise.id}>{option.label}</option>)}
        </select>
      </label>
      <button type="button" className="touch-target rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={disabled || !source} onClick={() => { if (source) { onReuse(source); setSelected(""); } }}>Add independent copy</button>
    </div>
    <p className="mt-2 text-sm text-muted">Copies the exercise, sets, notes and rule into this day. Its progress is tracked independently; later edits to the original stay separate.</p>
    {disabled ? <p className="mt-2 text-sm text-warn-ink">This day has reached the exercise limit.</p> : null}
  </details>;
}
