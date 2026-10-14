"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { compileProgramTemplate, validateProgramTemplate, type ProgramTemplate } from "@/features/program-templates/template";
import { validateDocument } from "@/features/program-editor/document";
import { parseDateKey } from "@/lib/date-key";
import { finishProgramCreation, ProgramCreationHttpError, type ProgramCreationAttempt } from "./simple-program-creation";

const control = "touch-target min-w-0 w-full rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-brand disabled:opacity-70";
const weekdays = [
  { value: 1, short: "Mon", name: "Monday" }, { value: 2, short: "Tue", name: "Tuesday" },
  { value: 3, short: "Wed", name: "Wednesday" }, { value: 4, short: "Thu", name: "Thursday" },
  { value: 5, short: "Fri", name: "Friday" }, { value: 6, short: "Sat", name: "Saturday" }, { value: 0, short: "Sun", name: "Sunday" },
];

export function SimpleProgramSetup({ template: initialTemplate, startDate, userId, onLock, onUnlock }: {
  template: ProgramTemplate;
  startDate: string;
  userId?: number;
  onLock?: () => void;
  onUnlock?: () => void;
}) {
  const router = useRouter();
  const [template, setTemplate] = useState(initialTemplate);
  const [name, setName] = useState(initialTemplate.title);
  const [date, setDate] = useState(startDate);
  const [weeks, setWeeks] = useState(String(template.cycles));
  const [days, setDays] = useState(template.weekdays);
  const [unit, setUnit] = useState(template.unit);
  const [loads, setLoads] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [destination, setDestination] = useState<"program" | "workspace">("program");
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(!userId);
  const pending = useRef(false);
  const attempt = useRef<ProgramCreationAttempt | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const errorPanel = useRef<HTMLDivElement>(null);
  const storageKey = userId ? `magni.program-setup.v1.${userId}.${initialTemplate.id}` : null;
  useEffect(() => {
    // Read browser-only recovery data after hydration. Keep actions disabled
    // until this read completes so a reload cannot start a competing attempt.
    const frame = requestAnimationFrame(() => {
      try {
        const raw = storageKey ? sessionStorage.getItem(storageKey) : null;
        if (raw) {
          const saved = JSON.parse(raw);
          const candidate = saved.attempt as ProgramCreationAttempt;
          if (saved.version === 1 && saved.template?.id === initialTemplate.id
            && validateProgramTemplate(saved.template).length === 0
            && candidate && /^[0-9a-f-]{36}$/i.test(candidate.id)
            && validateDocument(candidate.document).length === 0
            && (candidate.revision === null || Number.isSafeInteger(candidate.revision) && candidate.revision > 0)
            && (candidate.programId === null || Number.isSafeInteger(candidate.programId) && candidate.programId > 0)
            && ["program", "workspace"].includes(candidate.destination)) {
            attempt.current = candidate;
            setDestination(candidate.destination);
            if (candidate.revision !== null) setSavedDraftId(candidate.id);
            // The attempted document is authoritative. Cached display fields
            // cannot change its schedule or introduce invalid weekday values.
            const document = candidate.document;
            setTemplate(saved.template); setName(document.name); setDate(document.startDate); setWeeks(String(document.cycles));
            setDays(document.weekdays); setUnit(document.unit);
            const restoredLoads: Record<string, string> = {};
            (saved.template as ProgramTemplate).days.forEach((day, dayIndex) => day.exercises.forEach((slot, slotIndex) => {
              const rawLoad = saved.fields?.loads?.[slot.id];
              restoredLoads[slot.id] = typeof rawLoad === "string" && (rawLoad === "" || Number.isFinite(Number(rawLoad)) && Number(rawLoad) >= 0 && Number(rawLoad) <= 1000000)
                ? rawLoad : String(document.weeks[0]?.days[dayIndex]?.exercises[slotIndex]?.baseLoad ?? 0);
            }));
            setLoads(restoredLoads);
            setLocked(true); onLock?.();
            setError("Your previous setup is retained. Retry to finish safely; this will not create a second program.");
          }
        }
      } catch { /* Storage may be unavailable; the current tab still retains its attempt. */ }
      setStorageReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [storageKey, initialTemplate.id, onLock]);

  function retainAttempt() {
    if (!storageKey || !attempt.current) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, template, attempt: attempt.current, fields: { name, date, weeks, days, unit, loads } }));
      sessionStorage.setItem(`magni.program-setup.pending.${userId}`, template.id);
    }
    catch { /* Some browser privacy modes disable storage; preserve the in-memory attempt. */ }
  }
  function clearRecovery() {
    try {
      if (storageKey) sessionStorage.removeItem(storageKey);
      if (userId && sessionStorage.getItem(`magni.program-setup.pending.${userId}`) === template.id) sessionStorage.removeItem(`magni.program-setup.pending.${userId}`);
    } catch { /* Browser storage may be unavailable. */ }
  }
  const dateValid = !!parseDateKey(date);
  const weeksValid = /^\d+$/.test(weeks) && Number(weeks) >= 1 && Number(weeks) <= 52;
  let firstWorkout = "";
  if (dateValid && days.length === template.days.length) {
    const first = new Date(`${date}T12:00:00Z`);
    while (!days.includes(first.getUTCDay())) first.setUTCDate(first.getUTCDate() + 1);
    firstWorkout = first.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  }
  const groupedDays = template.days.map(day => ({ ...day, groups: [...new Set(day.exercises.map(exercise => exercise.supersetGroup))] }));
  const dailyPairs = groupedDays.map(day => day.groups.map(group => {
    const exercises = day.exercises.filter(exercise => exercise.supersetGroup === group);
    return group.trim() && exercises.length === 2 && exercises[0].sets === exercises[1].sets ? { group, rounds: exercises[0].sets } : null;
  }));
  const commonPairs = dailyPairs.every(pairs => pairs.every(Boolean) && JSON.stringify(pairs) === JSON.stringify(dailyPairs[0])) ? dailyPairs[0] : null;
  const rounds = commonPairs ? [...new Set(commonPairs.map(pair => pair!.rounds))].map(count => `${commonPairs.filter(pair => pair!.rounds === count).map(pair => pair!.group).join("/")}: ${count} rounds`).join(" · ") : "";

  function showError(message: string, field?: string) {
    setError(message);
    // Wait for conditional error text before moving focus; open native details
    // first so the invalid control is reachable on phones and with a keyboard.
    requestAnimationFrame(() => {
      const input = field ? form.current?.querySelector<HTMLElement>(`[id="${field}"]`) : null;
      if (input) {
        let ancestor = input.parentElement;
        while (ancestor) { if (ancestor instanceof HTMLDetailsElement) ancestor.open = true; ancestor = ancestor.parentElement; }
        input.focus();
      } else errorPanel.current?.focus();
    });
  }

  async function submit(destination: "program" | "workspace") {
    if (pending.current || !storageReady) return;
    setError(""); setErrors({});
    if (!attempt.current) {
      const invalid: Record<string, string> = {};
      if (!name.trim()) invalid["setup-name"] = "Enter a program name.";
      else if (name.trim().length > 140) invalid["setup-name"] = "Use a program name of 140 characters or fewer.";
      if (!dateValid) invalid["setup-date"] = "Choose a valid start date.";
      if (!weeksValid) invalid["setup-weeks"] = "Weeks must be a whole number from 1 to 52.";
      if (days.length !== template.days.length) invalid.weekdays = `Choose exactly ${template.days.length} training days for this program.`;
      for (const [id, value] of Object.entries(loads)) {
        if (value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1000000)) invalid[`setup-weight-${id}`] = "Enter a working weight from 0 to 1,000,000, or leave it blank.";
      }
      if (Object.keys(invalid).length) {
        setErrors(invalid);
        const [field, message] = Object.entries(invalid)[0];
        showError(message, field === "weekdays" ? undefined : field);
        return;
      }
      try {
        attempt.current = {
          id: crypto.randomUUID(), revision: null, programId: null, destination,
          document: compileProgramTemplate(template, {
            name: name.trim(), startDate: date, cycles: Number(weeks), weekdays: days, unit,
            loads: Object.fromEntries(Object.entries(loads).filter(([, value]) => value !== "").map(([id, value]) => [id, Number(value)])),
          }),
        };
      } catch (cause) { showError(cause instanceof Error ? cause.message : "Review your program setup."); return; }
      setDestination(destination); setLocked(true); onLock?.();
    }
    retainAttempt();
    pending.current = true; setBusy(true);
    try {
      const href = await finishProgramCreation(attempt.current);
      clearRecovery();
      router.push(href); router.refresh();
    } catch (cause) {
      if (cause instanceof ProgramCreationHttpError && cause.status === 410) {
        clearRecovery(); attempt.current = null; setLocked(false); setSavedDraftId(null); onUnlock?.();
        showError("The interrupted draft was deleted. Your setup is retained; review it and choose Create program when ready.");
        return;
      }
      retainAttempt();
      if (attempt.current.revision !== null) setSavedDraftId(attempt.current.id);
      showError(`${cause instanceof Error ? cause.message : "Could not finish creating this program."} Your setup is retained. Retry to finish safely.`);
    } finally { pending.current = false; setBusy(false); }
  }

  return <form ref={form} noValidate onSubmit={event => { event.preventDefault(); void submit("program"); }} className="flex min-w-0 flex-col gap-5">
    <section className="rounded-xl border border-brand-line bg-brand-soft p-4">
      <h2 className="display break-words text-2xl">{template.title}</h2>
      <p className="mt-1 text-sm font-semibold">{template.days.length} days a week{commonPairs ? ` · ${commonPairs.length} supersets a day` : ""}</p>
      {rounds && <p className="mt-1 text-sm text-muted">{rounds}</p>}
      <p className="mt-2 text-sm leading-6 text-muted">{template.description.split("\n\n")[0]}</p>
      {template.description.includes("\n\n") && <details className="mt-2"><summary className="touch-target cursor-pointer py-2 text-sm font-semibold">Training guidance</summary><p className="whitespace-pre-line text-sm leading-6 text-muted">{template.description.split("\n\n").slice(1).join("\n\n")}</p></details>}
    </section>
    {error && <div ref={errorPanel} role="alert" tabIndex={-1} className="rounded-xl border border-danger-line bg-danger-soft p-3 text-sm text-danger-ink outline-none focus:ring-2 focus:ring-danger-ink">{error}</div>}
    <fieldset disabled={locked || !storageReady} className="flex min-w-0 flex-col gap-4">
      <legend className="display mb-3 text-2xl">Your schedule</legend>
      <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold" htmlFor="setup-name">Program name
        <input id="setup-name" className={control} value={name} maxLength={140} onChange={event => setName(event.target.value)} aria-invalid={!!errors["setup-name"]} aria-describedby={errors["setup-name"] ? "setup-name-error" : undefined} />
        {errors["setup-name"] && <span id="setup-name-error" className="text-danger-ink">{errors["setup-name"]}</span>}
      </label>
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold" htmlFor="setup-date">Start date
          <input id="setup-date" type="date" className={control} value={date} onChange={event => setDate(event.target.value)} aria-invalid={!!errors["setup-date"]} aria-describedby={errors["setup-date"] ? "setup-date-error" : undefined} />
          {errors["setup-date"] && <span id="setup-date-error" className="text-danger-ink">{errors["setup-date"]}</span>}
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold" htmlFor="setup-weeks">Weeks
          <input id="setup-weeks" type="number" inputMode="numeric" min={1} max={52} step={1} className={control} value={weeks} onChange={event => setWeeks(event.target.value)} aria-invalid={!!errors["setup-weeks"]} aria-describedby={errors["setup-weeks"] ? "setup-weeks-error" : undefined} />
          {errors["setup-weeks"] && <span id="setup-weeks-error" className="text-danger-ink">{errors["setup-weeks"]}</span>}
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">Weight unit
          <select className={control} value={unit} onChange={event => setUnit(event.target.value as "lb" | "kg")}><option value="lb">lb</option><option value="kg">kg</option></select>
        </label>
      </div>
      <fieldset aria-describedby={errors.weekdays ? "setup-weekdays-error" : "setup-weekdays-hint"} className="min-w-0">
        <legend className="mb-2 text-sm font-semibold">Training days</legend>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">{weekdays.map(day => <button key={day.value} type="button" aria-label={day.name} aria-pressed={days.includes(day.value)} onClick={() => setDays(current => current.includes(day.value) ? current.filter(value => value !== day.value) : [...current, day.value].sort())} className={`touch-target min-w-0 rounded-xl border px-2 py-2 text-sm font-semibold ${days.includes(day.value) ? "border-brand-line bg-brand-soft text-brand-strong" : "border-line bg-surface text-muted"}`}>{day.short}</button>)}</div>
        <p id="setup-weekdays-hint" className="mt-2 text-sm text-muted">Choose {template.days.length} days. Day 1 starts on the first selected day.</p>
        {errors.weekdays && <p id="setup-weekdays-error" className="mt-2 text-sm text-danger-ink">{errors.weekdays}</p>}
      </fieldset>
      {firstWorkout && weeksValid && <p aria-live="polite" className="text-sm font-semibold text-muted">{Number(weeks) * template.days.length} workouts · first workout {firstWorkout}</p>}
    </fieldset>
    <details className="rounded-xl border border-line">
      <summary className="touch-target cursor-pointer px-4 py-3 font-semibold">Starting weights (optional)</summary>
      <div className="flex min-w-0 flex-col gap-3 px-4 pb-4">
        <p className="text-sm leading-6 text-muted">Enter working weights, or choose them when logging. These are starting weights, not training maxes. Each appearance is separate; changing one won’t change another day.</p>
        {groupedDays.map(day => <details key={day.id} className="min-w-0 rounded-xl border border-line bg-surface">
          <summary className="touch-target cursor-pointer break-words px-3 py-3 font-semibold">{day.name}</summary>
          <div className="flex min-w-0 flex-col gap-4 px-3 pb-3">
            <p className="text-sm text-muted">{day.exercises.reduce((count, exercise) => count + exercise.sets, 0)} working sets</p>
            {day.groups.map(group => <fieldset disabled={locked || !storageReady} key={group} className="flex min-w-0 flex-col gap-3">
              <legend className="eyebrow mb-2 text-sm text-brand-strong">{group ? `Superset ${group}` : "Exercises"}</legend>
              {day.exercises.filter(exercise => exercise.supersetGroup === group).map(exercise => {
                const lift = template.lifts.find(item => item.id === exercise.liftId)!;
                const id = `setup-weight-${exercise.id}`;
                return <div key={exercise.id} className="min-w-0">
                  <label htmlFor={lift.loadMode === "working" ? id : undefined} className="block break-words text-sm font-semibold">{lift.name}</label>
                  <p className="mt-1 text-sm text-muted">{exercise.sets} × {exercise.repMin === exercise.repMax ? exercise.repMin : `${exercise.repMin}–${exercise.repMax}`} reps</p>
                  {lift.loadMode === "bodyweight" ? <p className="mt-2 text-sm font-semibold text-muted">Bodyweight</p> : <div className="mt-2">
                    <span className="mb-1 block text-xs font-semibold text-muted">Working weight ({unit})</span>
                    <input id={id} aria-label={`${day.name}: ${lift.name} (${unit})`} type="number" inputMode="decimal" min={0} step="any" className={control} placeholder="Choose when logging" value={loads[exercise.id] ?? ""} onChange={event => setLoads(current => ({ ...current, [exercise.id]: event.target.value }))} aria-invalid={!!errors[id]} aria-describedby={errors[id] ? `${id}-error` : undefined} />
                    {errors[id] && <p id={`${id}-error`} className="mt-1 text-sm text-danger-ink">{errors[id]}</p>}
                  </div>}
                  {exercise.notes && <p className="mt-1.5 text-xs leading-5 text-muted">{exercise.notes}</p>}
                </div>;
              })}
            </fieldset>)}
          </div>
        </details>)}
      </div>
    </details>
    <div className="flex flex-col gap-2">
      <button type="submit" disabled={busy || !storageReady} className="touch-target rounded-xl bg-foreground px-4 py-3 font-semibold text-background disabled:opacity-50">{busy ? destination === "workspace" ? "Saving…" : "Creating…" : locked ? destination === "workspace" ? "Retry opening workspace" : "Retry creation" : "Create program"}</button>
      <p className="text-sm text-muted">Adds the workouts to your calendar. You can adjust the program later.</p>
      {!locked && <button type="button" disabled={!storageReady} onClick={() => void submit("workspace")} className="touch-target self-start rounded-xl px-2 py-2 text-sm font-semibold text-brand-strong">Customize in workspace</button>}
      {locked && !busy && savedDraftId && <Link href={`/programs/editor/${savedDraftId}`} className="touch-target inline-flex items-center self-start text-sm font-semibold text-brand-strong">Review saved draft in workspace</Link>}
      <span role="status" className="sr-only">{busy ? "Saving your setup. Please wait." : ""}</span>
    </div>
  </form>;
}
