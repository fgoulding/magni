"use client";
import { useId, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Copy, Trash2 } from "lucide-react";
import type { ProgramSetV1 } from "@/features/program-editor/document";

const control = "touch-target min-w-0 w-full rounded-xl border border-line bg-surface px-3 py-2 text-foreground outline-none focus:border-brand";
const button = "touch-target inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-semibold active:bg-surface-muted disabled:opacity-40";
export const prescriptionColumns = "xl:grid-cols-[5rem_minmax(0,1.2fr)_minmax(0,1.4fr)_5.5rem_6rem]";
const roles = { warmup: "Warm-up", work: "Work set", top: "Top set", backoff: "Back-off", amrap: "AMRAP" };
export function SetPrescriptionEditor({ set, index, count, unit, workingLoad, onChange, onMove, onCopy, onRemove }: {
  set: ProgramSetV1; index: number; count: number; unit: "lb" | "kg"; workingLoad: number;
  onChange: (change: Partial<ProgramSetV1>) => void; onMove: (offset: number) => void; onCopy: () => void; onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const advancedSummary = [set.effortKind !== "none" ? `${set.effortKind.toUpperCase()} ${set.effort}` : "", set.tempo ? `Tempo ${set.tempo}` : "", set.notes].filter(Boolean).join(" · ");
  const loadBasis = set.loadMode === "working" ? "Working load" : set.loadMode === "percent" ? "% of explicit max" : set.loadMode === "added" ? `Added load (${unit})` : `Fixed load (${unit})`;
  return <fieldset aria-label={`Set ${index + 1}`} className="min-w-0 border-t border-line py-3">
    <div className={`grid min-w-0 grid-cols-2 items-start gap-3 ${prescriptionColumns}`}>
      <div className="min-w-0 self-center"><span className="font-semibold">Set {index + 1}</span><span className="block text-xs text-muted">{roles[set.role]}</span></div>
      <div className="col-span-2 grid min-w-0 grid-cols-2 gap-2 xl:col-span-1">
        <label className="min-w-0 text-sm font-semibold"><span className="xl:sr-only">Minimum reps</span><input aria-label={`Set ${index + 1} minimum reps`} className={control} type="number" inputMode="numeric" value={set.repMin} onChange={event => onChange({ repMin: Number(event.target.value) })} /></label>
        <label className="min-w-0 text-sm font-semibold"><span className="xl:sr-only">Maximum reps</span><input aria-label={`Set ${index + 1} maximum reps`} className={control} type="number" inputMode="numeric" value={set.repMax} onChange={event => onChange({ repMax: Number(event.target.value) })} /></label>
      </div>
      <div className="min-w-0">
        {set.loadMode === "working" || set.loadMode === "bodyweight" ? <div className="flex min-h-11 flex-col justify-center"><span className="font-semibold">{set.loadMode === "working" ? `${workingLoad} ${unit}` : "Bodyweight"}</span>{set.loadMode === "working" ? <span className="text-xs text-muted">Working load</span> : null}</div> : <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold"><span className="xl:sr-only">{set.loadMode === "percent" ? "Percent of max" : `Set load (${unit})`}</span><input aria-label={set.loadMode === "percent" ? `Set ${index + 1} percent of max` : `Set ${index + 1} load (${unit})`} className={control} type="number" step="any" inputMode="decimal" value={set.load} onChange={event => onChange({ load: Number(event.target.value) })} /><span className="text-xs font-normal text-muted">{loadBasis}</span></label>}
      </div>
      <label className="min-w-0 text-sm font-semibold"><span className="xl:sr-only">Rest (seconds)</span><input aria-label={`Set ${index + 1} rest (seconds)`} className={control} type="number" inputMode="numeric" value={set.restSeconds} onChange={event => onChange({ restSeconds: Number(event.target.value) })} /></label>
      <button type="button" aria-label={`Set ${index + 1} details`} aria-expanded={expanded} aria-controls={detailsId} className="touch-target col-start-2 row-start-1 inline-flex items-center justify-end gap-1 rounded-xl px-2 text-sm font-semibold text-muted active:bg-surface-muted xl:col-start-auto xl:row-start-auto xl:justify-center" onClick={() => setExpanded(value => !value)}>Details{expanded ? <ChevronUp aria-hidden="true" size={16} /> : <ChevronDown aria-hidden="true" size={16} />}</button>
    </div>
    {advancedSummary ? <p className="mt-2 break-words text-xs leading-5 text-muted">{advancedSummary}</p> : null}
    <div id={detailsId} hidden={!expanded}>
      {expanded ? <div className="mt-3 rounded-xl bg-surface-muted p-3">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <label className="text-sm font-semibold">Set role<select className={control} value={set.role} onChange={event => onChange({ role: event.target.value as ProgramSetV1["role"] })}>{Object.entries(roles).map(([key,name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <label className="text-sm font-semibold">Load basis<select className={control} value={set.loadMode} onChange={event => onChange({ loadMode: event.target.value as ProgramSetV1["loadMode"] })}><option value="working">Working load</option><option value="fixed">Fixed load</option><option value="percent">% of explicit max</option><option value="bodyweight">Bodyweight</option><option value="added">Bodyweight + load</option></select></label>
        <label className="text-sm font-semibold">Effort<select className={control} value={set.effortKind} onChange={event => onChange({ effortKind: event.target.value as ProgramSetV1["effortKind"] })}><option value="none">No target</option><option value="rpe">RPE</option><option value="rir">Reps in reserve</option></select></label>
        {set.effortKind !== "none" ? <label className="text-sm font-semibold">Effort target<input className={control} type="number" step="any" inputMode="decimal" value={set.effort} onChange={event => onChange({ effort: Number(event.target.value) })} /></label> : null}
        <label className="text-sm font-semibold">Tempo<input className={control} value={set.tempo} onChange={event => onChange({ tempo: event.target.value })} /></label>
        <label className="col-span-2 text-sm font-semibold xl:col-span-3">Set notes<input className={control} value={set.notes} onChange={event => onChange({ notes: event.target.value })} /></label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={button} aria-label={`Move set ${index + 1} earlier`} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp aria-hidden="true" size={16} /></button>
        <button type="button" className={button} aria-label={`Move set ${index + 1} later`} disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown aria-hidden="true" size={16} /></button>
        <button type="button" className={button} onClick={onCopy}><Copy aria-hidden="true" size={15} />Copy set</button>
        <button type="button" className={button} aria-label={`Remove set ${index + 1}`} onClick={onRemove}><Trash2 aria-hidden="true" size={16} /></button>
      </div>
      </div> : null}
    </div>
  </fieldset>;
}
