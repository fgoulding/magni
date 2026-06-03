"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function TrainingMaxEditor({
  exerciseId,
  initialValue,
}: {
  exerciseId: number;
  initialValue: number;
}) {
  const [value, setValue] = useState(String(initialValue));
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function save() {
    const next = Number(value);
    if (!Number.isFinite(next) || next <= 0) {
      setValue(String(initialValue));
      return;
    }
    if (next === initialValue) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/exercises/${exerciseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trainingMax: next }),
      });
      if (response.ok) {
        router.refresh();
      } else {
        setValue(String(initialValue));
      }
    } catch {
      setValue(String(initialValue));
    } finally {
      setSaving(false);
    }
  }

  return (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          (event.target as HTMLInputElement).blur();
        }
        if (event.key === "Escape") {
          setValue(String(initialValue));
          (event.target as HTMLInputElement).blur();
        }
      }}
      disabled={saving}
      aria-label="Training max"
      className="w-12 rounded-md border border-line bg-surface px-1 py-0.5 text-center font-display text-sm tracking-tight text-foreground outline-none transition-colors focus:border-brand"
    />
  );
}
