"use client";

import { useState } from "react";

export type TmUpdatedSet = { id: number; training_max: number; calculated_weight: number };

/**
 * Editable "TM" chip shown in the workout card. Saving overrides the training max
 * for this exercise in the current workout (session-scoped) and hands the
 * recomputed sets back so the card can re-price the remaining sets immediately.
 */
export function WorkoutTmEditor({
  sessionId,
  exerciseName,
  value,
  onPreview,
  onUpdated,
}: {
  sessionId: number;
  exerciseName: string;
  value: number;
  /** Fired on every valid edit so the card can re-price the weight live. */
  onPreview?: (trainingMax: number) => void;
  onUpdated: (sets: TmUpdatedSet[]) => void;
}) {
  const [val, setVal] = useState(String(value));
  const [saving, setSaving] = useState(false);

  async function save() {
    const parsed = Number(val);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setVal(String(value));
      return;
    }
    const next = Math.round(parsed * 10) / 10;
    if (next === value) {
      setVal(String(next));
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/training-max`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseName, trainingMax: next }),
      });
      if (!response.ok) {
        setVal(String(value));
        return;
      }
      const body = (await response.json()) as { sets: TmUpdatedSet[] };
      setVal(String(next));
      onUpdated(body.sets);
    } catch {
      setVal(String(value));
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="ml-auto mt-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-surface/80 px-2.5 py-1 font-display text-xs tracking-tight text-muted">
      TM
      <input
        type="number"
        inputMode="decimal"
        min={1}
        step={0.1}
        value={val}
        onChange={(event) => {
          setVal(event.target.value);
          const parsed = Number(event.target.value);
          if (onPreview && Number.isFinite(parsed) && parsed > 0) {
            onPreview(Math.round(parsed * 10) / 10);
          }
        }}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            (event.target as HTMLInputElement).blur();
          }
          if (event.key === "Escape") {
            setVal(String(value));
            (event.target as HTMLInputElement).blur();
          }
        }}
        disabled={saving}
        aria-label={`Training max for ${exerciseName}`}
        className="w-14 bg-transparent text-center text-foreground outline-none focus:text-brand-strong"
      />
    </span>
  );
}
