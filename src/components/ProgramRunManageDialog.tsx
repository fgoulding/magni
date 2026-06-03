"use client";

import Link from "next/link";
import { useState } from "react";
import { ProgramHoldDialog, type ProgramHoldSummary } from "@/components/ProgramHoldForm";

export function ProgramRunManageDialog({
  programId,
  name,
  currentWeek,
  currentDay,
  dayCount,
  liftCount,
  scheduleLabel,
  lastSession,
  isActive,
  activeHold,
}: {
  programId: number;
  name: string;
  currentWeek: number;
  currentDay: number;
  dayCount: number;
  liftCount: number;
  scheduleLabel: string;
  lastSession: string | null;
  isActive: boolean;
  activeHold?: ProgramHoldSummary | null;
}) {
  const [open, setOpen] = useState(false);
  const titleId = `manage-run-title-${programId}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="touch-target inline-flex items-center justify-center text-sm font-medium text-muted"
      >
        Manage
      </button>

      {open ? (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/35 p-3 sm:items-center sm:justify-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl bg-surface shadow-xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <p className="text-xs font-semibold uppercase text-faint">Active run</p>
                <h2 id={titleId} className="mt-1 text-lg font-semibold">
                  {name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="touch-target inline-flex shrink-0 items-center justify-center rounded-xl border border-line px-3 text-sm font-medium text-muted"
              >
                Close
              </button>
            </div>

            <div className="flex flex-col gap-3 px-4 py-4">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-surface-muted p-3">
                  <p className="text-xs font-semibold uppercase text-faint">Position</p>
                  <p className="mt-1 font-medium">
                    Week {currentWeek} · Day {currentDay}
                  </p>
                </div>
                <div className="rounded-xl bg-surface-muted p-3">
                  <p className="text-xs font-semibold uppercase text-faint">Schedule</p>
                  <p className="mt-1 font-medium">{scheduleLabel}</p>
                </div>
              </div>

              <div className="rounded-xl bg-surface-muted p-3 text-sm text-muted">
                <div className="flex items-center justify-between gap-3">
                  <span>{dayCount} day{dayCount === 1 ? "" : "s"} · {liftCount} lifts</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${isActive ? "bg-success-soft text-success-ink" : "bg-surface-muted text-muted"}`}>
                    {isActive ? "Active" : "Inactive"}
                  </span>
                </div>
                {lastSession ? <p className="mt-2 text-xs text-faint">Last logged {lastSession}</p> : null}
                {activeHold ? (
                  <p className="mt-2 rounded-xl border border-warn-line bg-warn-soft px-3 py-2 text-xs text-warn-ink">
                    Paused {activeHold.startDate} to {activeHold.endDate}
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Link
                  href="/today"
                  className="touch-target inline-flex items-center justify-center rounded-xl bg-foreground px-3 text-sm font-medium text-white"
                >
                  Today
                </Link>
                <ProgramHoldDialog
                  programId={programId}
                  programName={name}
                  activeHold={activeHold}
                  triggerLabel={activeHold ? "Manage pause" : "Pause run"}
                  triggerClassName="touch-target inline-flex items-center justify-center rounded-xl border border-line bg-surface px-3 text-sm font-medium text-foreground"
                />
              </div>

              <Link
                href={`/programs/${programId}`}
                className="touch-target inline-flex items-center justify-center rounded-xl border border-line bg-surface px-3 text-sm font-medium text-foreground"
              >
                Edit program
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
