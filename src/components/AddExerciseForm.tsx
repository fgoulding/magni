"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Select } from "@/components/Select";
import { listTrainingTemplates } from "@/features/training-templates/registry";

const trainingTemplates = listTrainingTemplates();

export function AddExerciseForm({ dayId }: { dayId: number }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [trainingMax, setTrainingMax] = useState(100);
  const [bwSets, setBwSets] = useState(3);
  const [bwReps, setBwReps] = useState(10);
  const [category, setCategory] = useState("main");
  const [progressionType, setProgressionType] = useState("custom");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const selectedTemplate = trainingTemplates.find((template) => template.id === progressionType);
  const isBodyweight = progressionType === "bodyweight";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const response = await fetch(`/api/days/${dayId}/exercises`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Bodyweight has no training max; send a nominal placeholder (the column
        // is NOT NULL CHECK(> 0)) plus its configured sets × reps. UI shows "BW".
        body: JSON.stringify({
          name,
          trainingMax: isBodyweight ? 1 : trainingMax,
          category,
          progressionType,
          ...(isBodyweight ? { sets: bwSets, reps: bwReps } : {}),
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not add exercise");
      setName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add exercise");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="touch-target mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line bg-surface px-3 py-2.5 text-sm font-semibold text-muted transition-colors active:bg-surface-muted"
      >
        <Plus aria-hidden="true" size={16} />
        Add exercise
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3 rounded-xl bg-surface-muted p-3">
      <div className="flex items-center justify-between">
        <h3 className="eyebrow text-[11px] text-brand-strong">Add exercise</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="touch-target text-xs font-semibold text-faint transition-colors active:text-foreground"
        >
          Cancel
        </button>
      </div>
      <ErrorBanner message={error} />
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
        placeholder="Squat"
        className="touch-target rounded-xl border border-line bg-surface px-3 text-base outline-none transition-colors focus:border-brand"
      />
      {isBodyweight ? (
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
            Sets
            <input
              type="number"
              min={1}
              value={bwSets}
              onChange={(event) => setBwSets(Number(event.target.value))}
              className="touch-target rounded-xl border border-line bg-surface px-3 text-base text-foreground outline-none transition-colors focus:border-brand"
              aria-label="Sets"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
            Reps
            <input
              type="number"
              min={1}
              value={bwReps}
              onChange={(event) => setBwReps(Number(event.target.value))}
              className="touch-target rounded-xl border border-line bg-surface px-3 text-base text-foreground outline-none transition-colors focus:border-brand"
              aria-label="Reps"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
            Type
            <Select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              aria-label="Category"
            >
              <option value="main">Main</option>
              <option value="aux">Aux</option>
              <option value="accessory">Accessory</option>
            </Select>
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            value={trainingMax}
            onChange={(event) => setTrainingMax(Number(event.target.value))}
            min={1}
            step={0.1}
            inputMode="decimal"
            className="touch-target rounded-xl border border-line bg-surface px-3 text-base outline-none transition-colors focus:border-brand"
            aria-label="Training max"
          />
          <Select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label="Category"
          >
            <option value="main">Main</option>
            <option value="aux">Aux</option>
            <option value="accessory">Accessory</option>
          </Select>
        </div>
      )}
      <div className="flex gap-2">
        <Select
          value={progressionType}
          onChange={(event) => setProgressionType(event.target.value)}
          wrapperClassName="min-w-0 flex-1"
          aria-label="Progression"
        >
          {trainingTemplates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </Select>
        <button
          type="submit"
          disabled={submitting}
          className="touch-target rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition-opacity active:opacity-90 disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {selectedTemplate ? (
        <p className="-mt-1 text-xs leading-5 text-muted">{selectedTemplate.description}</p>
      ) : null}
    </form>
  );
}
