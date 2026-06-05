"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Select } from "@/components/Select";
import { listTrainingTemplates } from "@/features/training-templates/registry";

const templates = listTrainingTemplates();

/**
 * Inline editor for an exercise's lift type (category) and progression. Changing
 * either re-plans the exercise's week loading on the server; logged sessions are
 * untouched. Replaces the old static "main · sbs" label.
 */
export function ExerciseTypeEditor({
  exerciseId,
  category,
  progressionType,
}: {
  exerciseId: number;
  category: string;
  progressionType: string;
}) {
  const [cat, setCat] = useState(category);
  const [prog, setProg] = useState(progressionType);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const selected = templates.find((template) => template.id === prog);

  async function save(nextCat: string, nextProg: string) {
    const prevCat = cat;
    const prevProg = prog;
    setCat(nextCat);
    setProg(nextProg);
    setError("");
    setSaving(true);
    try {
      const response = await fetch(`/api/exercises/${exerciseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: nextCat, progressionType: nextProg }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setCat(prevCat);
        setProg(prevProg);
        setError(body.error ?? "Couldn't update — try a different combination.");
        return;
      }
      router.refresh();
    } catch {
      setCat(prevCat);
      setProg(prevProg);
      setError("Couldn't update — check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-1.5 flex max-w-[17rem] flex-col gap-1.5">
      <Select
        value={cat}
        onChange={(event) => save(event.target.value, prog)}
        disabled={saving}
        aria-label="Lift type"
        className="py-1.5 text-sm"
      >
        <option value="main">Main</option>
        <option value="aux">Aux</option>
        <option value="accessory">Accessory</option>
      </Select>
      <Select
        value={prog}
        onChange={(event) => save(cat, event.target.value)}
        disabled={saving}
        aria-label="Progression"
        className="py-1.5 text-sm"
      >
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}
          </option>
        ))}
      </Select>
      {selected ? <p className="text-xs leading-5 text-muted">{selected.description}</p> : null}
      {error ? <p className="text-xs font-medium text-danger-ink">{error}</p> : null}
    </div>
  );
}
