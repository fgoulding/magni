"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2, Undo2 } from "lucide-react";
import { createDay, createExercise, createSet, createWeek, validateDocument, validateDraftStructure, type ProgramDocumentV1, type ProgramExerciseV1 } from "@/features/program-editor/document";
import { cloneExercise as copyExercise, cloneDay as copyDay, cloneWeek as copyWeek, applySharedConfiguration, makePreset, PRESETS, type PresetId } from "@/features/program-editor/operations";
import { SetPrescriptionEditor } from "@/components/SetPrescriptionEditor";
import { ProgressionRuleEditor } from "@/components/ProgressionRuleEditor";
import type { EditorDraft } from "@/features/program-editor/repository";

const control = "touch-target w-full rounded-xl border border-line bg-surface px-3 py-2 text-foreground outline-none focus:border-brand";
const button = "touch-target inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold disabled:opacity-50";
type SaveState = "saved" | "unsaved" | "saving" | "failed" | "conflict";

function reorder<T>(rows: T[], index: number, offset: number) {
  if (index + offset < 0 || index + offset >= rows.length) return;
  [rows[index], rows[index + offset]] = [rows[index + offset], rows[index]];
}

function EditorField({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) {
 return <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">{label}<input className={control} value={value} onChange={event => onChange(event.target.value)} /></label>;
}
function EditorNumber({label,value,onChange}:{label:string;value:number;onChange:(value:number)=>void}) {
 return <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">{label}<input className={control} type="number" step="any" inputMode="decimal" value={value} onChange={event => onChange(Number(event.target.value))} /></label>;
}
function EditorIcon({label,children,onClick,disabled=false}:{label:string;children:React.ReactNode;onClick:()=>void;disabled?:boolean}) {
 return <button type="button" className={button} aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}
type WorkspaceProps = { userId: number; draftId: string; initialDocument: ProgramDocumentV1; initialRevision: number; activatedProgramId: number | null };
const subscribeHydration = () => () => {};
export function ProgramWorkspace(props: WorkspaceProps) {
 const mounted = useSyncExternalStore(subscribeHydration, () => true, () => false);
 return mounted ? <HydratedWorkspace {...props} /> : <p role="status" className="safe-x py-8 text-muted">Opening your program…</p>;
}
function HydratedWorkspace({ userId, draftId, initialDocument, initialRevision, activatedProgramId }: WorkspaceProps) {
  const storageKey = `magni:program-draft:${userId}:${draftId}`;
  const [restored] = useState(() => {
    try {
      const pending = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (pending && validateDraftStructure(pending.document).length === 0 && Number.isInteger(pending.revision)) {
        if (JSON.stringify(pending.document) !== JSON.stringify(initialDocument)) return {
          document: pending.document as ProgramDocumentV1,
          conflict: pending.revision !== initialRevision,
          error: pending.revision !== initialRevision ? "The server draft changed while local work was pending. Keep your work as a copy or load the server version." : "",
          pending: true,
        };
      }
      return { document: initialDocument, conflict: false, error: "", pending: false };
    } catch { return { document: initialDocument, conflict: false, error: "A saved device draft could not be read. The server version is available.", pending: false }; }
  });
  const router = useRouter();
  const [document, setDocument] = useState(restored.document);
  const [saveState, setSaveState] = useState<SaveState>(restored.conflict ? "conflict" : restored.pending || !initialRevision ? "unsaved" : "saved");
  const [error, setError] = useState(restored.error);
  const [tab, setTab] = useState<"structure" | "sets" | "progression" | "preview">("structure");
  const [weekIndex, setWeekIndex] = useState(0);
  const [dayIndex, setDayIndex] = useState(0);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [undoCount, setUndoCount] = useState(0);
  const [activating, setActivating] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [activeId, setActiveId] = useState(activatedProgramId);
  const [reuseDay, setReuseDay] = useState("");
  const [preset, setPreset] = useState<PresetId>("double");
  const [copying, setCopying] = useState(false);
  const [bulkScope, setBulkScope] = useState<"exercise" | "day" | "week" | "program">("exercise");
  const [bulkMin, setBulkMin] = useState(8);
  const [bulkMax, setBulkMax] = useState(12);
  const [bulkRest, setBulkRest] = useState(120);
  const copyAttempt = useRef<{id:string;document:ProgramDocumentV1;revision:number}|null>(null);
  const draft = useRef(restored.document);
  const revision = useRef(initialRevision);
  const lastSaved = useRef(initialRevision ? JSON.stringify(initialDocument) : "");
  const undoStack = useRef<ProgramDocumentV1[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  const conflict = useRef(restored.conflict);
  const week = document.weeks[weekIndex] ?? document.weeks[0];
  const day = week?.days[dayIndex] ?? week?.days[0];
  const exercise = day?.exercises[exerciseIndex] ?? day?.exercises[0];
  const wi = Math.max(0, document.weeks.indexOf(week));
  const di = Math.max(0, week?.days.indexOf(day) ?? 0);
  const ei = Math.max(0, day?.exercises.indexOf(exercise) ?? 0);
  const issues = validateDocument(document);

  function persistPending(value: ProgramDocumentV1) {
    try { localStorage.setItem(storageKey, JSON.stringify({ document: value, revision: revision.current })); }
    catch { setError("Device storage is unavailable. Save successfully before leaving this page."); }
  }

  async function save(): Promise<boolean> {
    if (saving.current) return saving.current;
    if (conflict.current) return false;
    const operation = async () => {
      while (JSON.stringify(draft.current) !== lastSaved.current) {
        const sent = JSON.stringify(draft.current);
        setSaveState("saving");
        try {
          const response = await fetch(`/api/program-drafts/${draftId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: revision.current, document: JSON.parse(sent) }) });
          const body = await response.json() as EditorDraft & { error?: string };
          if (!response.ok) {
            if (response.status === 409) { conflict.current = true; setSaveState("conflict"); }
            else setSaveState("failed");
            throw new Error(body.error ?? "Could not save this draft.");
          }
          if (!Number.isInteger(body.revision) || body.revision < 1) throw new Error("Save response was incomplete. Retry to verify your draft.");
          revision.current = body.revision;
          lastSaved.current = sent;
          if (JSON.stringify(draft.current) === sent) {
            localStorage.removeItem(storageKey);
            setSaveState("saved");
          } else persistPending(draft.current);
          setError("");
        } catch (failure) {
          if (!conflict.current) setSaveState("failed");
          setError(failure instanceof Error ? failure.message : "Save failed. Changes remain on this device.");
          return false;
        }
      }
      return true;
    };
    saving.current = operation();
    try { return await saving.current; } finally { saving.current = null; }
  }

  function change(update: (value: ProgramDocumentV1) => void, remember = true) {
    if (remember) {
      undoStack.current = [...undoStack.current.slice(-39), structuredClone(draft.current)];
      setUndoCount(undoStack.current.length);
    }
    const next = structuredClone(draft.current);
    update(next);
    draft.current = next;
    setDocument(next);
    persistPending(next);
    setSaveState(conflict.current ? "conflict" : "unsaved");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(); }, 500);
  }
  function editExercise(update: (value: ProgramExerciseV1) => void) { change(value => update(value.weeks[wi].days[di].exercises[ei])); }
  function editShared(update: (value: ProgramExerciseV1) => void) {
    change(value => { const source = value.weeks[wi].days[di].exercises[ei]; update(source); applySharedConfiguration(value, source); });
  }
  function applyBulk() {
    change(value => {
      const targets = bulkScope === "exercise" ? [value.weeks[wi].days[di].exercises[ei]]
        : bulkScope === "day" ? value.weeks[wi].days[di].exercises
        : bulkScope === "week" ? value.weeks[wi].days.flatMap(day => day.exercises)
        : value.weeks.flatMap(week => week.days.flatMap(day => day.exercises));
      for (const target of targets) for (const set of target.sets) if (set.role !== "warmup") { set.repMin = bulkMin; set.repMax = bulkMax; set.restSeconds = bulkRest; }
    });
  }
  function exportFile() {
    const blob = new Blob([JSON.stringify(draft.current, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = window.document.createElement("a");
    link.href = url; link.download = `${draft.current.name || "program"}.magni.json`; link.click(); URL.revokeObjectURL(url);
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("Program files must be smaller than 2 MB.");
      const imported = JSON.parse(await file.text()); const invalid = validateDocument(imported);
      if (invalid.length) throw new Error(`Check this program file: ${invalid.slice(0,3).map(issue => issue.message).join(" ")}`);
      change(value => Object.assign(value, imported)); setWeekIndex(0); setDayIndex(0); setExerciseIndex(0); setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not read this program file."); }
  }

  useEffect(() => {
    if ((restored.pending || initialRevision === 0) && !restored.conflict) timer.current = setTimeout(() => { void save(); }, 500);
    const retry = () => { void save(); };
    window.addEventListener("online", retry);
    return () => { if (timer.current) clearTimeout(timer.current); window.removeEventListener("online", retry); };
    // The draft identity is remounted by the route; other values are read from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  async function duplicate() {
    if (copying) return;
    setCopying(true);
    const latestCopy = () => ({ ...structuredClone(draft.current), name: `${draft.current.name || "Program"} copy` });
    if (!copyAttempt.current) copyAttempt.current = { id: crypto.randomUUID(), document: latestCopy(), revision: 0 };
    const attempt = copyAttempt.current;
    try {
      // Retry the exact uncertain write first. Once acknowledged, bring the same
      // copy up to date with edits made while its earlier response was lost.
      for (;;) {
        const response = await fetch(`/api/program-drafts/${attempt.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: attempt.revision, document: attempt.document }) });
        const body = await response.json();
        if (!response.ok || !Number.isInteger(body.revision) || body.revision < 1) throw new Error(body.error ?? "Could not save a copy.");
        attempt.revision = body.revision;
        const latest = latestCopy();
        if (JSON.stringify(latest) === JSON.stringify(attempt.document)) break;
        attempt.document = latest;
      }
      router.push(`/programs/editor/${attempt.id}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save a copy. Retry to save the same copy safely."); }
    finally { setCopying(false); }
  }
  async function activate() {
    setShowIssues(true);
    if (issues.length) { setTab("preview"); return; }
    setActivating(true);
    try {
      if (!await save()) return;
      const response = await fetch(`/api/program-drafts/${draftId}/activate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: revision.current }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not activate this program.");
      if (!Number.isInteger(body.programId) || body.programId < 1) throw new Error("Activation response was incomplete. Retry to verify your program.");
      setActiveId(body.programId);
      setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Activation failed. Retry safely."); }
    finally { setActivating(false); }
  }


  return <div className="safe-x flex w-full flex-col gap-4 py-5 lg:w-[min(1100px,calc(100vw-2rem))] lg:self-center">
    <header className="flex items-center justify-between gap-2"><div><Link className="touch-target inline-flex items-center text-sm font-semibold text-muted" href="/programs">Back to programs</Link><h1 className="display text-4xl">Program workspace</h1></div>{<EditorIcon label={"Undo last edit"} onClick={() => { const previous = undoStack.current.pop(); if (previous) change(value => Object.assign(value, previous), false); setUndoCount(undoStack.current.length); }} disabled={!undoCount}><Undo2 size={19} /></EditorIcon>}</header>
    <div className="flex flex-wrap items-center justify-between gap-2"><p role="status" className={`text-sm font-semibold ${saveState === "saved" ? "text-success-ink" : saveState === "failed" || saveState === "conflict" ? "text-danger-ink" : "text-muted"}`}>{({ saved: "Draft saved", unsaved: "Unsaved changes", saving: "Saving…", failed: "Save failed — changes retained", conflict: "Conflicting edits — changes retained" })[saveState]}</p><div className="flex gap-2"><button className={button} onClick={() => { void save(); }}>Save now</button><button className={button} disabled={copying} onClick={() => { void duplicate(); }}><Copy size={16} />{copying ? "Copying…" : "Save as copy"}</button></div></div>
    {error ? <div role="alert" className="rounded-xl border border-danger-line bg-danger-soft p-3 text-sm text-danger-ink">{error}{saveState === "conflict" ? <button className={`${button} mt-2`} onClick={() => { localStorage.removeItem(storageKey); window.location.reload(); }}>Load server version and discard local edits</button> : null}</div> : null}
    {activeId ? <section className="rounded-xl border border-success-line bg-success-soft p-3"><p className="font-semibold text-success-ink">Program activated</p><p className="mt-1 text-sm text-muted">Your active version and started workouts are preserved. Further changes stay in this draft; save a copy to activate a separate program.</p><Link href="/today" className={`${button} mt-3`}>Train this program</Link></section> : null}
    {tab === "structure" ? <section className="card grid gap-3 p-4 sm:grid-cols-2">{<EditorField label={"Program name"} value={document.name} onChange={name => change(value => { value.name = name; })} />}<label className="flex flex-col gap-1 text-sm font-semibold">Units<select className={control} value={document.unit} onChange={event => change(value => { value.unit = event.target.value as "lb" | "kg"; for (const week of value.weeks) for (const day of week.days) for (const exercise of day.exercises) if (exercise.rule?.action && exercise.rule.action.variable !== "reps") exercise.rule.action.unit = value.unit; })}><option value="lb">Pounds (lb)</option><option value="kg">Kilograms (kg)</option></select><span className="text-xs font-normal leading-5 text-muted">Changing units keeps the entered numbers. Review loads before activation.</span></label></section> : <p className="truncate text-sm font-semibold text-muted">{document.name || "Untitled program"} · {document.unit}</p>}
    {tab === "structure" ? <details className="card p-4"><summary className="touch-target cursor-pointer text-sm font-semibold">Presets and program files</summary><div className="mt-3 flex flex-col gap-3"><label className="text-sm font-semibold">Optional starting structure<select className={control} value={preset} onChange={event => setPreset(event.target.value as PresetId)}>{PRESETS.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><p className="text-sm text-muted">{PRESETS.find(item => item.id === preset)?.description} Applying a preset or importing replaces this draft’s content. Undo restores it.</p><button className={button} onClick={() => { change(value => Object.assign(value, makePreset(preset, value.startDate))); setWeekIndex(0); setDayIndex(0); setExerciseIndex(0); }}>Apply preset</button><div className="flex flex-wrap gap-2"><button className={button} onClick={exportFile}>Export program file</button><label className={`${button} cursor-pointer`}>Import program file<input aria-label="Import program file" className="sr-only" type="file" accept=".json,application/json" onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ""; }} /></label></div><p className="text-sm text-muted">Magni program files contain the structure, prescriptions and versioned rules. They do not contain workout history.</p></div></details> : null}
    <nav aria-label="Program workspace sections" className="grid grid-cols-2 gap-2 sm:grid-cols-4">{([["structure", "Structure"], ["sets", "Prescriptions"], ["progression", "Progression & preview"], ["preview", "Review & activate"]] as const).map(([id, title]) => <button key={id} className={`${button} ${tab === id ? "border-brand-line bg-brand-soft text-brand-strong" : ""}`} aria-pressed={tab === id} onClick={() => setTab(id)}>{title}</button>)}</nav>
    {tab !== "preview" ? <section className="grid grid-cols-2 gap-2"><label className="text-sm font-semibold">Week<select className={control} value={wi} onChange={event => { setWeekIndex(Number(event.target.value)); setDayIndex(0); setExerciseIndex(0); }}>{document.weeks.map((week, index) => <option key={week.id} value={index}>{week.name || `Week ${index + 1}`}{week.deload ? " · Deload" : ""}</option>)}</select></label><label className="text-sm font-semibold">Day<select className={control} value={di} onChange={event => { setDayIndex(Number(event.target.value)); setExerciseIndex(0); }}>{week?.days.map((day, index) => <option key={day.id} value={index}>{day.name || `Day ${index + 1}`}</option>)}</select></label></section> : null}

    {tab === "structure" ? <div className="grid gap-4 lg:grid-cols-2">
      <section className="card flex flex-col gap-3 p-4"><h2 className="display text-2xl">Weeks and blocks</h2>{week ? <>{<EditorField label={"Week name"} value={week.name} onChange={name => change(value => { value.weeks[wi].name = name; })} />}{<EditorField label={"Block name"} value={week.block} onChange={name => change(value => { value.weeks[wi].block = name; })} />}<label className="touch-target flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={week.deload} onChange={event => change(value => { value.weeks[wi].deload = event.target.checked; })} />Deload week — hold progression</label><div className="flex flex-wrap gap-2"><button className={button} onClick={() => { change(value => value.weeks.splice(wi + 1, 0, copyWeek(value.weeks[wi]))); setWeekIndex(wi + 1); setDayIndex(0); }}><Copy size={16} />Copy week</button>{<EditorIcon label={"Move week earlier"} onClick={() => { change(value => reorder(value.weeks, wi, -1)); setWeekIndex(wi - 1); }} disabled={wi === 0}><ArrowUp size={16} /></EditorIcon>}{<EditorIcon label={"Move week later"} onClick={() => { change(value => reorder(value.weeks, wi, 1)); setWeekIndex(wi + 1); }} disabled={wi >= document.weeks.length - 1}><ArrowDown size={16} /></EditorIcon>}{<EditorIcon label={"Remove week"} onClick={() => { change(value => value.weeks.splice(wi, 1)); setWeekIndex(0); }} disabled={document.weeks.length === 1}><Trash2 size={16} /></EditorIcon>}</div></> : null}<button className={button} onClick={() => { change(value => value.weeks.push({ ...createWeek(`Week ${value.weeks.length + 1}`), days: [createDay()] })); setWeekIndex(document.weeks.length); setDayIndex(0); }}><Plus size={16} />Add week</button>{<EditorNumber label={"Repeat cycles"} value={document.cycles} onChange={cycles => change(value => { value.cycles = cycles; })} />}<p className="text-sm text-muted">Copies keep each lift’s progression shared. Prescriptions are editable separately in each week.</p></section>
      <section className="card flex flex-col gap-3 p-4"><h2 className="display text-2xl">Training days</h2>{day ? <>{<EditorField label={"Day name"} value={day.name} onChange={name => change(value => { value.weeks[wi].days[di].name = name; })} />}<div className="flex flex-wrap gap-2"><button className={button} onClick={() => { change(value => value.weeks[wi].days.splice(di + 1, 0, copyDay(value.weeks[wi].days[di]))); setDayIndex(di + 1); }}><Copy size={16} />Copy day</button>{<EditorIcon label={"Move day earlier"} onClick={() => { change(value => reorder(value.weeks[wi].days, di, -1)); setDayIndex(di - 1); }} disabled={di === 0}><ArrowUp size={16} /></EditorIcon>}{<EditorIcon label={"Move day later"} onClick={() => { change(value => reorder(value.weeks[wi].days, di, 1)); setDayIndex(di + 1); }} disabled={di >= week.days.length - 1}><ArrowDown size={16} /></EditorIcon>}{<EditorIcon label={"Remove day"} onClick={() => { change(value => value.weeks[wi].days.splice(di, 1)); setDayIndex(0); }} disabled={false}><Trash2 size={16} /></EditorIcon>}</div></> : null}<button className={button} onClick={() => { change(value => value.weeks[wi].days.push(createDay(`Day ${value.weeks[wi].days.length + 1}`))); setDayIndex(week.days.length); }}><Plus size={16} />Add day</button><label className="text-sm font-semibold">Reuse a day<select className={control} value={reuseDay} onChange={event => setReuseDay(event.target.value)}><option value="">Choose an existing day</option>{document.weeks.flatMap((week, w) => week.days.map((day, d) => <option key={day.id} value={`${w}:${d}`}>{week.name} · {day.name}</option>))}</select></label><button disabled={!reuseDay} className={button} onClick={() => { const [w,d] = reuseDay.split(":").map(Number); change(value => value.weeks[wi].days.push(copyDay(value.weeks[w].days[d]))); setDayIndex(week.days.length); }}>Add reused day</button><button className={`${button} bg-brand-soft text-brand-strong`} onClick={() => setTab("sets")}>Edit this day’s exercises</button></section>
    </div> : null}

    {(tab === "sets" || tab === "progression") && day ? <div className="grid gap-4 lg:grid-cols-[260px_1fr]"><aside className="flex flex-wrap gap-2 self-start lg:card lg:flex-col lg:p-3"><h2 className="sr-only lg:not-sr-only lg:display lg:text-2xl">{day.name}</h2>{day.exercises.map((item, index) => <button key={item.id} className={`${button} justify-start ${ei === index ? "border-brand-line bg-brand-soft text-brand-strong" : ""}`} onClick={() => setExerciseIndex(index)}>{item.name || `Exercise ${index + 1}`}</button>)}<button className={button} onClick={() => { change(value => value.weeks[wi].days[di].exercises.push(createExercise())); setExerciseIndex(day.exercises.length); }}><Plus size={16} />Add exercise</button></aside>
      {exercise ? <section className="card flex min-w-0 flex-col gap-4 p-4">{<EditorField label={"Exercise name"} value={exercise.name} onChange={name => editExercise(value => { value.name = name; })} />}<div className="grid grid-cols-2 gap-2">{<EditorNumber label={`Working load (${document.unit})`} value={exercise.baseLoad} onChange={load => editShared(value => { value.baseLoad = load; })} />}{<EditorNumber label={`Explicit training max (${document.unit})`} value={exercise.trainingMax} onChange={max => editShared(value => { value.trainingMax = max; })} />}</div><p className="text-sm text-muted">Editing {week.name} · {day.name}. Set prescriptions below are overrides for this appearance.</p>
      {tab === "sets" ? <>
        <div className="flex flex-wrap gap-2">{<EditorIcon label={"Move exercise earlier"} onClick={() => { change(value => reorder(value.weeks[wi].days[di].exercises, ei, -1)); setExerciseIndex(ei - 1); }} disabled={ei === 0}><ArrowUp size={16} /></EditorIcon>}{<EditorIcon label={"Move exercise later"} onClick={() => { change(value => reorder(value.weeks[wi].days[di].exercises, ei, 1)); setExerciseIndex(ei + 1); }} disabled={ei >= day.exercises.length - 1}><ArrowDown size={16} /></EditorIcon>}<button className={button} onClick={() => { change(value => value.weeks[wi].days[di].exercises.splice(ei + 1, 0, copyExercise(exercise, false))); setExerciseIndex(ei + 1); }}>Copy exercise</button>{<EditorIcon label={"Remove exercise"} onClick={() => { change(value => value.weeks[wi].days[di].exercises.splice(ei, 1)); setExerciseIndex(0); }} disabled={false}><Trash2 size={16} /></EditorIcon>}</div>
        {<EditorField label={"Superset group (same name links exercises)"} value={exercise.supersetGroup} onChange={group => editExercise(value => { value.supersetGroup = group; })} />}
        <div className="grid gap-3 xl:grid-cols-2">{exercise.sets.map((set, index) => <SetPrescriptionEditor key={set.id} set={set} index={index} count={exercise.sets.length} unit={document.unit} workingLoad={exercise.baseLoad} onChange={patch => editExercise(value => { Object.assign(value.sets[index], patch); })} onMove={offset => editExercise(value => reorder(value.sets, index, offset))} onCopy={() => editExercise(value => value.sets.splice(index + 1, 0, { ...structuredClone(set), id: crypto.randomUUID() }))} onRemove={() => editExercise(value => value.sets.splice(index, 1))} />)}</div>
        <details className="rounded-xl border border-line p-3"><summary className="touch-target cursor-pointer text-sm font-semibold">Bulk edit work sets</summary><div className="mt-3 grid grid-cols-2 gap-2"><label className="text-sm font-semibold">Apply to<select className={control} value={bulkScope} onChange={event => setBulkScope(event.target.value as typeof bulkScope)}><option value="exercise">This exercise</option><option value="day">This day</option><option value="week">This week</option><option value="program">Entire program</option></select></label><EditorNumber label="Bulk minimum reps" value={bulkMin} onChange={setBulkMin} /><EditorNumber label="Bulk maximum reps" value={bulkMax} onChange={setBulkMax} /><EditorNumber label="Bulk rest (seconds)" value={bulkRest} onChange={setBulkRest} /></div><p className="mt-2 text-sm text-muted">Updates all work, top, back-off and AMRAP sets in the selected scope. Warm-ups keep their targets. Undo restores the whole edit.</p><button className={`${button} mt-3`} onClick={applyBulk}>Apply bulk edit</button></details>
        <button className={button} onClick={() => editExercise(value => value.sets.push(createSet()))}><Plus size={16} />Add set</button>{<EditorField label={"Exercise notes"} value={exercise.notes} onChange={notes => editExercise(value => { value.notes = notes; })} />}<button className={button} onClick={() => setTab("progression")}>Configure progression</button>
      </> : <>
        <label className="text-sm font-semibold">Progression sharing<select className={control} value={exercise.progressionKey} onChange={event => change(value => {
          const selected = value.weeks.flatMap(week => week.days.flatMap(day => day.exercises)).find(item => item.progressionKey === event.target.value);
          const target = value.weeks[wi].days[di].exercises[ei]; target.progressionKey = event.target.value;
          if (selected) applySharedConfiguration(value, selected);
        })}>{Array.from(new Map(document.weeks.flatMap(week => week.days.flatMap(day => day.exercises.map(item => [item.progressionKey, `${item.name || "Unnamed lift"} · ${week.name}`] as const)))).entries()).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><button className={button} onClick={() => editExercise(value => { value.progressionKey = crypto.randomUUID(); })}>Progress this appearance independently</button>
        <p className="text-sm text-muted">Load, max and rule changes apply to every appearance sharing this progression. Separate this appearance first to configure it differently.</p>
        <ProgressionRuleEditor key={exercise.id} rule={exercise.rule} onChange={rule => editShared(value => { value.rule = rule; })} sets={exercise.sets.map(set => ({ id: set.id, role: set.role, repMin: set.repMin, repMax: set.repMax, actualReps: null }))} state={{ load: exercise.baseLoad, trainingMax: exercise.trainingMax, reps: exercise.sets.find(set => set.role !== "warmup")?.repMin ?? 0, consecutiveFailures: 0, lastEvaluatedWeek: null }} unit={document.unit} week={wi + 1} isDeload={week.deload} />
      </>}
      {issues.filter(issue => issue.path.startsWith(`weeks.${wi}.days.${di}.exercises.${ei}`)).map(issue => <p className="text-sm text-danger-ink" key={issue.path + issue.message}>{issue.message}</p>)}
      </section> : <p className="card self-start p-5 text-sm text-muted">Add your first exercise. Start with its sets, then configure progression.</p>}
    </div> : null}

    {tab === "preview" ? <section className="card flex flex-col gap-4 p-4"><h2 className="display text-2xl">Review your program</h2><div className="grid grid-cols-2 gap-3"><label className="text-sm font-semibold">Start date<input type="date" className={control} value={document.startDate} onChange={event => change(value => { value.startDate = event.target.value; })} /></label>{<EditorNumber label={"Cycles"} value={document.cycles} onChange={cycles => change(value => { value.cycles = cycles; })} />}</div><fieldset><legend className="text-sm font-semibold">Training weekdays</legend><div className="mt-2 grid grid-cols-7 gap-1">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((name,index) => <button key={name} className={`touch-target rounded-xl border text-xs font-semibold ${document.weekdays.includes(index) ? "border-brand-line bg-brand-soft text-brand-strong" : "border-line"}`} aria-pressed={document.weekdays.includes(index)} onClick={() => change(value => { value.weekdays = value.weekdays.includes(index) ? value.weekdays.filter(day => day !== index) : [...value.weekdays,index].sort(); })}>{name}</button>)}</div></fieldset><p className="text-sm leading-6 text-muted">Day 1 starts on the first selected weekday on or after your start date. Program weeks advance through workout slots. {document.cycles} cycle(s), {document.weeks.reduce((sum,week) => sum + week.days.length,0) * document.cycles} workouts. Future loads depend on your results.</p>{document.weeks.map((week,index) => <div key={week.id} className="rounded-xl border border-line p-3"><h3 className="display text-xl">{week.block ? `${week.block} · ` : ""}{week.name}{week.deload ? " · Deload" : ""}</h3>{week.days.map(day => <div key={day.id} className="mt-3"><p className="font-semibold">{day.name}</p>{day.exercises.map(exercise => <p key={exercise.id} className="mt-1 text-sm text-muted">{exercise.name || "Unnamed exercise"} · {exercise.sets.length} sets · {exercise.sets.map(set => `${set.repMin}${set.repMax !== set.repMin ? `–${set.repMax}` : ""}`).join(" / ")} reps</p>)}</div>)}<button className={`${button} mt-3`} onClick={() => { setWeekIndex(index); setDayIndex(0); setTab("sets"); }}>Edit this week</button></div>)}{showIssues || issues.length ? <div aria-label="Program validation">{issues.map(issue => <p className="mt-1 text-sm text-danger-ink" key={issue.path + issue.message}>{issue.path.replace(/weeks\.(\d+)\.days\.(\d+)\.exercises\.(\d+)/, (_,w,d,e) => `Week ${Number(w)+1}, day ${Number(d)+1}, exercise ${Number(e)+1}`).replaceAll("."," · ")}: {issue.message}</p>)}</div> : null}<p className="text-sm text-muted">Activation saves an immutable version and schedules its workouts. Your draft remains available for further editing.</p><button className="touch-target rounded-xl bg-brand px-4 py-3 text-base font-semibold text-white disabled:opacity-50" disabled={activating || !!activeId} onClick={() => { void activate(); }}>{activating ? "Activating…" : activeId ? "Activated" : "Activate program"}</button></section> : null}
  </div>;
}
