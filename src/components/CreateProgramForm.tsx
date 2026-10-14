"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { applySbsCycleToSnapshot, snapshotUsesSbs } from "@/features/program-defaults/defaults";
import type { ProgramDefault } from "@/features/program-defaults/types";
import type { SharedProgramSnapshot } from "@/features/shared-programs/types";
import { validateProgramTemplate, type ProgramTemplate } from "@/features/program-templates/template";
import { SimpleProgramSetup } from "./SimpleProgramSetup";

type CreateProgramFormProps = Readonly<{
  programDefaults?: readonly ProgramDefault[];
  initialSnapshot?: SharedProgramSnapshot;
  initialSnapshotLabel?: string;
  submitEndpoint?: string;
  submitMode?: "create-program" | "snapshot-only";
  /** Latest training max per lift (keyed by lowercased exercise name) to pre-fill. */
  latestMaxes?: Readonly<Record<string, number>>;
  programTemplates?: readonly ProgramTemplate[];
  initialTemplateId?: string;
  startDate?: string;
  userId?: number;
}>;

function buildExpectedMaxesFromSnapshot(
  snapshot: SharedProgramSnapshot,
  latestMaxes: Readonly<Record<string, number>> = {},
): Record<string, number | ""> {
  const maxes: Record<string, number | ""> = {};
  for (const day of snapshot.days) {
    for (const exercise of day.exercises) {
      // Bodyweight lifts have no training max — don't prefill or send one.
      if (exercise.progressionType === "bodyweight") continue;
      maxes[exercise.key] = latestMaxes[exercise.name.trim().toLowerCase()] ?? "";
    }
  }
  return maxes;
}

function countSnapshotLifts(snapshot: SharedProgramSnapshot): number {
  return snapshot.days.reduce((total, day) => total + day.exercises.length, 0);
}

export function CreateProgramForm({
  programDefaults = [],
  initialSnapshot,
  initialSnapshotLabel = "Loaded definition",
  submitEndpoint = "/api/programs",
  submitMode = "create-program",
  latestMaxes = {},
  programTemplates = [],
  initialTemplateId,
  startDate = "",
  userId,
}: CreateProgramFormProps) {
  const [name, setName] = useState(initialSnapshot?.name ?? "");
  const [numWeeks, setNumWeeks] = useState(initialSnapshot?.numWeeks ?? 7);
  const templates = submitMode === "create-program" ? programTemplates : [];
  const [pendingTemplate, setPendingTemplate] = useState<ProgramTemplate | null>(null);
  const choices = pendingTemplate && !templates.some(template => template.id === pendingTemplate.id) ? [pendingTemplate, ...templates] : templates;
  const [selectedDefaultId, setSelectedDefaultId] = useState(initialSnapshot ? "loaded" : initialTemplateId ? `template:${initialTemplateId}` : templates[0] ? `template:${templates[0].id}` : "blank");
  const [sourceLocked, setSourceLocked] = useState(false);
  const [sourceReady, setSourceReady] = useState(!userId || !!initialSnapshot || submitMode !== "create-program");
  const lockSource = useCallback(() => setSourceLocked(true), []);
  const unlockSource = useCallback(() => setSourceLocked(false), []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        if (userId && !initialSnapshot && submitMode === "create-program") {
          const id = sessionStorage.getItem(`magni.program-setup.pending.${userId}`);
          const raw = id ? sessionStorage.getItem(`magni.program-setup.v1.${userId}.${id}`) : null;
          if (raw) {
            const saved = JSON.parse(raw);
            if (saved.version === 1 && saved.template?.id === id && saved.attempt && validateProgramTemplate(saved.template).length === 0) {
              setPendingTemplate(saved.template); setSelectedDefaultId(`template:${id}`);
            }
          }
        }
      } catch { /* Recover in memory if browser storage is unavailable. */ }
      setSourceReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [userId, initialSnapshot, submitMode]);
  const [expectedMaxes, setExpectedMaxes] = useState<Record<string, number | "">>(
    initialSnapshot ? buildExpectedMaxesFromSnapshot(initialSnapshot, latestMaxes) : {},
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // SBS runs as three 7-week cycles (same lifts, heavier loads at lower reps).
  const [sbsCycle, setSbsCycle] = useState(1);
  const router = useRouter();
  const selectedTemplate = choices.find(template => `template:${template.id}` === selectedDefaultId);
  const unavailableTemplate = selectedDefaultId.startsWith("template:") && !selectedTemplate;
  const selectedDefault = programDefaults.find((programDefault) => programDefault.id === selectedDefaultId);
  const baseSnapshot = selectedDefault?.snapshot ?? (selectedDefaultId === "loaded" ? initialSnapshot : undefined);
  const showsCycleChoice = baseSnapshot ? snapshotUsesSbs(baseSnapshot) : false;
  const cycledSnapshot =
    baseSnapshot && showsCycleChoice ? applySbsCycleToSnapshot(baseSnapshot, sbsCycle) : baseSnapshot;
  const selectedSnapshot = cycledSnapshot
    ? { ...cycledSnapshot, name, numWeeks }
    : undefined;

  const sourceButtonClass = (selected: boolean) =>
    `touch-target rounded-xl border px-3 py-2 text-left text-sm font-semibold transition-colors ${
      selected
        ? "border-brand-line bg-brand-soft text-brand-strong"
        : "border-line bg-surface text-foreground active:bg-surface-muted"
    }`;

  function selectDefault(value: string) {
    setSelectedDefaultId(value);
    setSbsCycle(1);

    if (value === "loaded" && initialSnapshot) {
      setName(initialSnapshot.name);
      setNumWeeks(initialSnapshot.numWeeks);
      setExpectedMaxes(buildExpectedMaxesFromSnapshot(initialSnapshot, latestMaxes));
      return;
    }

    const programDefault = programDefaults.find((item) => item.id === value);
    if (!programDefault) {
      setName("");
      setNumWeeks(7);
      setExpectedMaxes({});
      return;
    }

    setName(programDefault.snapshot.name);
    setNumWeeks(programDefault.snapshot.numWeeks);
    setExpectedMaxes(buildExpectedMaxesFromSnapshot(programDefault.snapshot, latestMaxes));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      if (submitMode === "snapshot-only" && !selectedSnapshot) {
        throw new Error("Choose a program default to publish");
      }

      if (submitMode === "create-program") {
        if (!name.trim()) {
          throw new Error("Enter a program name.");
        }
        if (!Number.isInteger(numWeeks) || numWeeks < 1 || numWeeks > 104) {
          throw new Error("Weeks must be a whole number between 1 and 104.");
        }
        // Blank training maxes are allowed (they default to 100 server-side), but
        // the form warns about that visibly — see the Training Maxes fieldset.
      }

      const maxesPayload: Record<string, number> | undefined = (() => {
        const entries = Object.entries(expectedMaxes)
          .filter(([, v]) => typeof v === "number")
          .map(([k, v]) => [k, v as number]);
        return entries.length > 0 ? Object.fromEntries(entries) : undefined;
      })();

      const payload =
        submitMode === "snapshot-only"
          ? { snapshot: selectedSnapshot }
          : { name, numWeeks, ...(selectedSnapshot ? { snapshot: selectedSnapshot } : {}), ...(maxesPayload ? { expectedMaxes: maxesPayload } : {}) };
      const response = await fetch(submitEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { id?: number; error?: string };

      if (!response.ok) {
        throw new Error(body.error ?? "Could not create program");
      }

      if (submitMode === "create-program") {
        if (!body.id) {
          throw new Error(body.error ?? "Could not create program");
        }

        router.push(`/programs/${body.id}`);
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create program");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <fieldset disabled={sourceLocked || !sourceReady} className="flex min-w-0 flex-col gap-2">
        {choices.length > 0 ? <label className="flex min-w-0 flex-col gap-2 text-sm font-semibold">Choose a program
          <select value={selectedDefaultId} onChange={event => selectDefault(event.target.value)} className="touch-target min-w-0 w-full rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-brand">
            {unavailableTemplate && <option value={selectedDefaultId} disabled>Unavailable program</option>}
            <optgroup label="Ready programs">{choices.map(template => <option key={template.id} value={`template:${template.id}`}>{template.title}</option>)}</optgroup>
            {initialSnapshot && <option value="loaded">{initialSnapshotLabel}</option>}
            {programDefaults.length > 0 && <optgroup label="Original training systems">{programDefaults.map(programDefault => <option key={programDefault.id} value={programDefault.id}>{programDefault.label}</option>)}</optgroup>}
            <option value="blank">Blank Custom</option>
          </select>
        </label> : <><legend className="mb-2 text-sm font-semibold">Choose a program</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {choices.map(template => <button key={template.id} type="button" aria-pressed={selectedDefaultId === `template:${template.id}`} onClick={() => selectDefault(`template:${template.id}`)} className={sourceButtonClass(selectedDefaultId === `template:${template.id}`)}>{template.title}</button>)}
          {initialSnapshot ? (
            <button
              type="button"
              aria-pressed={selectedDefaultId === "loaded"}
              onClick={() => selectDefault("loaded")}
              className={sourceButtonClass(selectedDefaultId === "loaded")}
            >
              {initialSnapshotLabel}
            </button>
          ) : null}
          {programDefaults.map((programDefault) => (
            <button
              key={programDefault.id}
              type="button"
              aria-pressed={selectedDefaultId === programDefault.id}
              onClick={() => selectDefault(programDefault.id)}
              className={sourceButtonClass(selectedDefaultId === programDefault.id)}
            >
              {programDefault.label}
            </button>
          ))}
          <button type="button" aria-pressed={selectedDefaultId === "blank"} onClick={() => selectDefault("blank")} className={sourceButtonClass(selectedDefaultId === "blank")}>Blank Custom</button>
        </div></>}
      </fieldset>

      {unavailableTemplate ? <ErrorBanner message="This program is unavailable. Choose another program above; nothing has been created." /> : selectedTemplate ? <SimpleProgramSetup key={selectedTemplate.id} template={selectedTemplate} startDate={startDate} userId={userId} onLock={lockSource} onUnlock={unlockSource} /> : <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
      <ErrorBanner message={error} />

      {selectedSnapshot ? (
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-line bg-surface p-3 text-center">
          <span className="font-display text-sm font-semibold">{selectedSnapshot.numWeeks} weeks</span>
          <span className="font-display text-sm font-semibold">{selectedSnapshot.days.length} days</span>
          <span className="font-display text-sm font-semibold">{countSnapshotLifts(selectedSnapshot)} lifts</span>
        </div>
      ) : null}

      {submitMode === "create-program" && !selectedSnapshot ? (
        <p className="rounded-xl border border-line bg-surface-muted px-3 py-2.5 text-xs leading-5 text-muted">
          A blank program starts empty. After you create it, you&rsquo;ll add training days and
          exercises in the editor.
        </p>
      ) : null}

      {showsCycleChoice ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">SBS cycle</legend>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((cycle) => (
              <button
                key={cycle}
                type="button"
                aria-pressed={sbsCycle === cycle}
                onClick={() => setSbsCycle(cycle)}
                className={sourceButtonClass(sbsCycle === cycle)}
              >
                Cycle {cycle}
              </button>
            ))}
          </div>
          <p className="text-xs leading-5 text-muted">
            Three 7-week blocks: each later cycle runs heavier at lower reps. Start at Cycle 1; move
            up on the training maxes you earn.
          </p>
        </fieldset>
      ) : null}

      <label className="flex flex-col gap-1 text-sm font-medium">
        Program name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          placeholder="SBS Hypertrophy"
          className="touch-target rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-brand"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Weeks
        <input
          type="number"
          value={numWeeks}
          onChange={(event) => setNumWeeks(Number(event.target.value))}
          min={1}
          max={104}
          className="touch-target rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-brand"
        />
      </label>

      {selectedSnapshot && Object.keys(expectedMaxes).length > 0 ? (
        <fieldset className="flex flex-col gap-3 rounded-xl border border-line p-3">
          <legend className="text-sm font-medium">Training Maxes</legend>
          {Object.values(expectedMaxes).some((value) => typeof value === "number") ? (
            <p className="-mt-1 text-xs text-muted">
              Pre-filled from your latest maxes where we recognized the lift — edit any.
            </p>
          ) : null}
          {Object.values(expectedMaxes).some((value) => typeof value !== "number" || value <= 0) ? (
            <p className="rounded-lg border border-warn-line bg-warn-soft px-2.5 py-1.5 text-xs leading-5 text-warn-ink">
              Lifts left blank will use a default training max of 100 — fill them in for accurate weights.
            </p>
          ) : null}
          {selectedSnapshot.days.map((day) => (
            <div key={day.key} className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">{day.name}</span>
              {day.exercises.map((exercise) => (
                <label key={exercise.key} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{exercise.name}</span>
                  {exercise.progressionType === "bodyweight" ? (
                    <span className="w-24 text-right text-xs font-semibold text-faint">BW · no max</span>
                  ) : (
                    <input
                      type="number"
                      value={expectedMaxes[exercise.key] ?? ""}
                      onChange={(event) => {
                        const rawValue: number | "" =
                          event.target.value === "" ? "" : Number(event.target.value);
                        setExpectedMaxes((prev) => {
                          const next = { ...prev, [exercise.key]: rawValue };
                          if (selectedSnapshot && rawValue !== "") {
                            for (const d of selectedSnapshot.days) {
                              for (const ex of d.exercises) {
                                if (ex.key !== exercise.key && ex.name === exercise.name) {
                                  next[ex.key] = rawValue;
                                }
                              }
                            }
                          }
                          return next;
                        });
                      }}
                      min={1}
                      step={0.1}
                      inputMode="decimal"
                      placeholder="Weight"
                      className="w-24 touch-target rounded-xl border border-line bg-surface px-2 text-sm outline-none focus:border-brand"
                    />
                  )}
                </label>
              ))}
            </div>
          ))}
        </fieldset>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="touch-target rounded-xl bg-brand px-4 text-base font-semibold text-white transition-colors active:bg-brand-strong disabled:opacity-50"
      >
        {submitting ? "Saving…" : submitMode === "snapshot-only" ? "Publish update" : "Create program"}
      </button>
    </form>}
    {templates.length > 0 && !sourceLocked && <Link href="/programs/editor/new" className="touch-target inline-flex items-center self-start text-sm font-semibold text-muted">Build a custom program in workspace</Link>}
    </div>
  );
}
