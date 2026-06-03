"use client";

import { Gauge, X } from "lucide-react";
import { useState } from "react";
import type { LatestTrainingMax } from "@/features/programs/program-service";

export function TrainingMaxesModal({ maxes }: { maxes: readonly LatestTrainingMax[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="touch-target inline-flex items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-muted transition-colors active:bg-surface-muted"
      >
        <Gauge aria-hidden="true" size={16} className="text-brand-strong" />
        Maxes
      </button>

      {open ? (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/35 p-3 sm:items-center sm:justify-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="training-maxes-title"
            className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl bg-surface shadow-xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <p className="eyebrow text-[11px] text-brand-strong">Current</p>
                <h2 id="training-maxes-title" className="display mt-0.5 text-2xl">
                  Training Maxes
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="touch-target inline-flex shrink-0 items-center justify-center rounded-xl border border-line px-3 text-muted transition-colors active:bg-surface-muted"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <div className="px-4 py-4">
              {maxes.length === 0 ? (
                <p className="py-6 text-center text-sm leading-6 text-muted">
                  No training maxes yet. Create a program and they&apos;ll show up here as you train —
                  and carry into your next program automatically.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {maxes.map((max) => (
                    <li key={max.name} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0 truncate font-semibold">{max.name}</span>
                      <span className="shrink-0 font-display text-lg tracking-tight">
                        {max.trainingMax}
                        <span className="ml-0.5 text-xs font-semibold text-faint">lb</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-xs leading-5 text-faint">
                These are your latest per-lift maxes across all programs (matched by name). Edit a
                specific value from its program&apos;s editor.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
