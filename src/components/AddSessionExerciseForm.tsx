"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import type { WorkoutSet } from "@/components/workout-card-utils";

/** Adds an ad-hoc accessory exercise to the active session and reports the new sets. */
export function AddSessionExerciseForm({
  sessionId,
  onAdded,
  onError,
}: {
  sessionId: number;
  onAdded: (sets: WorkoutSet[]) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sets, setSets] = useState("3");
  const [reps, setReps] = useState("10");
  const [weight, setWeight] = useState("");
  const [adding, setAdding] = useState(false);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/sets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          sets: Number(sets) || 1,
          reps: Number(reps) || 1,
          weight: weight === "" ? 0 : Number(weight),
        }),
      });
      const body = (await response.json()) as { sets?: WorkoutSet[]; error?: string };
      if (!response.ok || !body.sets) throw new Error(body.error ?? "Could not add exercise");
      onAdded(body.sets);
      setOpen(false);
      setName("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not add exercise");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="px-4 pb-1 pt-2">
      {open ? (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-muted p-3">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Exercise name"
            aria-label="New exercise name"
            className="touch-target rounded-xl border border-line bg-surface px-3 text-base outline-none transition-colors focus:border-brand"
          />
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
              Sets
              <input
                type="number"
                min={1}
                value={sets}
                onChange={(event) => setSets(event.target.value)}
                aria-label="Sets"
                className="touch-target rounded-xl border border-line bg-surface px-2 text-center text-base font-normal outline-none focus:border-brand"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
              Reps
              <input
                type="number"
                min={1}
                value={reps}
                onChange={(event) => setReps(event.target.value)}
                aria-label="New exercise reps"
                className="touch-target rounded-xl border border-line bg-surface px-2 text-center text-base font-normal outline-none focus:border-brand"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
              Weight
              <input
                type="number"
                min={0}
                value={weight}
                onChange={(event) => setWeight(event.target.value)}
                placeholder="lb"
                aria-label="Weight"
                className="touch-target rounded-xl border border-line bg-surface px-2 text-center text-base font-normal outline-none focus:border-brand"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={adding || !name.trim()}
              onClick={submit}
              className="touch-target flex-1 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors active:bg-brand-strong disabled:opacity-50"
            >
              {adding ? "Adding…" : "Add to workout"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="touch-target rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-faint transition-colors active:bg-surface-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="touch-target flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-2.5 text-sm font-semibold text-muted transition-colors active:bg-surface-muted"
        >
          <Plus aria-hidden="true" size={16} />
          Add exercise
        </button>
      )}
    </div>
  );
}
