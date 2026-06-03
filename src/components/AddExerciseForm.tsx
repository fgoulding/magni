"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Select } from "@/components/Select";
import { listTrainingTemplates } from "@/features/training-templates/registry";

const trainingTemplates = listTrainingTemplates();

export function AddExerciseForm({ dayId }: { dayId: number }) {
  const [name, setName] = useState("");
  const [trainingMax, setTrainingMax] = useState(100);
  const [category, setCategory] = useState("main");
  const [progressionType, setProgressionType] = useState("custom");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const response = await fetch(`/api/days/${dayId}/exercises`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, trainingMax, category, progressionType }),
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

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3 rounded-xl bg-surface-muted p-3">
      <h3 className="eyebrow text-[11px] text-brand-strong">Add exercise</h3>
      <ErrorBanner message={error} />
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
        placeholder="Squat"
        className="touch-target rounded-xl border border-line bg-surface px-3 text-base outline-none transition-colors focus:border-brand"
      />
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
          className="touch-target rounded-xl bg-foreground px-4 text-sm font-semibold text-white transition-opacity active:opacity-90 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </form>
  );
}
