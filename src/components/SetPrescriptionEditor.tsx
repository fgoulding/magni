"use client";
import { ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react";
import type { ProgramSetV1 } from "@/features/program-editor/document";

const control = "touch-target w-full rounded-xl border border-line bg-surface px-3 py-2 text-foreground outline-none focus:border-brand";
const button = "touch-target inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-semibold disabled:opacity-40";
const roles = { warmup: "Warm-up", work: "Work set", top: "Top set", backoff: "Back-off", amrap: "AMRAP" };
export function SetPrescriptionEditor({ set, index, count, unit, workingLoad, onChange, onMove, onCopy, onRemove }: {
  set: ProgramSetV1; index: number; count: number; unit: "lb" | "kg"; workingLoad: number;
  onChange: (change: Partial<ProgramSetV1>) => void; onMove: (offset: number) => void; onCopy: () => void; onRemove: () => void;
}) {
  return <fieldset className="min-w-0 rounded-xl border border-line p-3">
    <legend className="display px-1 text-lg">Set {index + 1} · {roles[set.role]}</legend>
    <div className="grid grid-cols-2 gap-2">
      <label className="text-sm font-semibold">Minimum reps<input aria-label={`Set ${index + 1} minimum reps`} className={control} type="number" inputMode="numeric" value={set.repMin} onChange={event => onChange({ repMin: Number(event.target.value) })} /></label>
      <label className="text-sm font-semibold">Maximum reps<input aria-label={`Set ${index + 1} maximum reps`} className={control} type="number" inputMode="numeric" value={set.repMax} onChange={event => onChange({ repMax: Number(event.target.value) })} /></label>
      {set.loadMode !== "working" && set.loadMode !== "bodyweight" ? <label className="col-span-2 text-sm font-semibold">{set.loadMode === "percent" ? "Percent of max" : `Set load (${unit})`}<input className={control} type="number" step="any" inputMode="decimal" value={set.load} onChange={event => onChange({ load: Number(event.target.value) })} /></label> : null}
    </div>
    <p className="mt-2 text-xs leading-5 text-muted">{set.loadMode === "working" ? `${workingLoad} ${unit} working load` : set.loadMode === "bodyweight" ? "Bodyweight" : set.loadMode === "added" ? `Bodyweight + ${set.load} ${unit}` : set.loadMode === "percent" ? `${set.load}% of explicit max` : `${set.load} ${unit} fixed`}{set.effortKind !== "none" ? ` · ${set.effortKind.toUpperCase()} ${set.effort}` : ""} · {set.restSeconds}s rest{set.tempo ? ` · ${set.tempo}` : ""}</p>
    <details className="mt-1"><summary className="touch-target cursor-pointer text-sm font-semibold text-brand-strong">Set details</summary>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm font-semibold">Set role<select className={control} value={set.role} onChange={event => onChange({ role: event.target.value as ProgramSetV1["role"] })}>{Object.entries(roles).map(([key,name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <label className="text-sm font-semibold">Load basis<select className={control} value={set.loadMode} onChange={event => onChange({ loadMode: event.target.value as ProgramSetV1["loadMode"] })}><option value="working">Working load</option><option value="fixed">Fixed load</option><option value="percent">% of explicit max</option><option value="bodyweight">Bodyweight</option><option value="added">Bodyweight + load</option></select></label>
        <label className="text-sm font-semibold">Rest (seconds)<input className={control} type="number" inputMode="numeric" value={set.restSeconds} onChange={event => onChange({ restSeconds: Number(event.target.value) })} /></label>
        <label className="text-sm font-semibold">Effort<select className={control} value={set.effortKind} onChange={event => onChange({ effortKind: event.target.value as ProgramSetV1["effortKind"] })}><option value="none">No target</option><option value="rpe">RPE</option><option value="rir">Reps in reserve</option></select></label>
        {set.effortKind !== "none" ? <label className="text-sm font-semibold">Effort target<input className={control} type="number" step="any" inputMode="decimal" value={set.effort} onChange={event => onChange({ effort: Number(event.target.value) })} /></label> : null}
        <label className="text-sm font-semibold">Tempo<input className={control} value={set.tempo} onChange={event => onChange({ tempo: event.target.value })} /></label>
        <label className="col-span-2 text-sm font-semibold">Set notes<input className={control} value={set.notes} onChange={event => onChange({ notes: event.target.value })} /></label>
      </div>
      <div className="mt-3 flex gap-2">
        <button className={button} aria-label={`Move set ${index + 1} earlier`} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={16} /></button>
        <button className={button} aria-label={`Move set ${index + 1} later`} disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown size={16} /></button>
        <button className={button} onClick={onCopy}><Copy size={15} />Copy set</button>
        <button className={button} aria-label={`Remove set ${index + 1}`} onClick={onRemove}><Trash2 size={16} /></button>
      </div>
    </details>
  </fieldset>;
}
