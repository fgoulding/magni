"use client";
import { useState } from "react";
import type { ProgressPage, ProgressProgram } from "@/features/progress/types";
import { progressRequest } from "./request";
import { progressButton, progressInput } from "./ProgressChrome";

export function CandidateFilters({ disabled, initialUrl, onApply }: { disabled: boolean; initialUrl: string; onApply: (url: string) => void }) {
  const params = new URL(initialUrl, "https://magni.invalid").searchParams;
  const [from, setFrom] = useState(params.get("from") ?? ""), [to, setTo] = useState(params.get("to") ?? "");
  const [program, setProgram] = useState<{ id: string; name: string }>({ id: params.get("programId") ?? "", name: "Selected program" });
  const [programs, setPrograms] = useState<ProgressPage<ProgressProgram> | null>(null);
  const [trail, setTrail] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function loadPrograms(cursor = "", previous = false) {
    setBusy(true); setError("");
    try { setPrograms(await progressRequest<ProgressPage<ProgressProgram>>(`/api/progress/programs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`)); if (previous) setTrail(trail.slice(0, -1)); else if (cursor) setTrail([...trail, cursor]); }
    catch { setError("Could not load program choices. Open filters again to retry."); }
    finally { setBusy(false); }
  }
  return <details className="card px-4" onToggle={event => { if (event.currentTarget.open && !programs && !busy) void loadPrograms(); }}><summary className="touch-target cursor-pointer py-3 font-semibold">Filter past workouts</summary><form className="flex flex-col gap-3 pb-4" onSubmit={event => { event.preventDefault(); const url = new URL(initialUrl, "https://magni.invalid"); for (const [key, value] of Object.entries({ from, to, programId: program.id })) { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); } url.searchParams.delete("cursor"); onApply(url.pathname + url.search); }}>
    <fieldset disabled={disabled} className="grid min-w-0 gap-3 sm:grid-cols-2"><label className="min-w-0 text-sm text-muted">From date<input type="date" value={from} onChange={event => setFrom(event.target.value)} className={`${progressInput} mt-1`} /></label><label className="min-w-0 text-sm text-muted">To date<input type="date" value={to} onChange={event => setTo(event.target.value)} className={`${progressInput} mt-1`} /></label></fieldset>
    <label className="min-w-0 text-sm text-muted">Program filter<select disabled={disabled || busy} value={program.id} onChange={event => setProgram({ id: event.target.value, name: event.target.selectedOptions[0].text })} className={`${progressInput} mt-1`}><option value="">All programs</option><option value="0">Unplanned workouts</option>{program.id && program.id !== "0" && !programs?.items.some(item => String(item.id) === program.id) && <option value={program.id}>{program.name}</option>}{programs?.items.filter(item => item.id !== 0).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {(trail.length > 1 || programs?.nextCursor) && <div className="flex flex-wrap gap-2">{trail.length > 1 && <button type="button" className={progressButton} disabled={disabled || busy} onClick={() => loadPrograms(trail.at(-2)!, true)}>Previous programs</button>}{programs?.nextCursor && <button type="button" className={progressButton} disabled={disabled || busy} onClick={() => loadPrograms(programs.nextCursor!)}>Next programs</button>}</div>}
    {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
    <p className="text-sm text-muted">Changing filters keeps the records you selected on other pages.</p><button type="submit" disabled={disabled || busy} className={`${progressButton} self-start`}>Apply record filters</button>
  </form></details>;
}
