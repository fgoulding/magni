"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";

export type ProgramHoldSummary = {
  id: number;
  startDate: string;
  endDate: string;
  reason: string;
};

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

export function ProgramHoldForm({
  programId,
  activeHold,
}: {
  programId: number;
  activeHold?: ProgramHoldSummary | null;
}) {
  return (
    <section id="run-hold" className="scroll-mt-5 rounded-xl border border-line bg-surface p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Pause this run</h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            Use this for vacation, no rack access, travel, or recovery. Other active runs keep moving.
          </p>
        </div>
      </div>
      <ProgramHoldControls programId={programId} activeHold={activeHold} />
    </section>
  );
}

export function ProgramHoldDialog({
  programId,
  programName,
  activeHold,
  triggerLabel,
  triggerClassName,
}: {
  programId: number;
  programName: string;
  activeHold?: ProgramHoldSummary | null;
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const titleId = `pause-run-title-${programId}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          triggerClassName ??
          "touch-target inline-flex items-center justify-center rounded-xl border border-line bg-surface px-3 text-sm font-medium text-foreground"
        }
      >
        {triggerLabel ?? (activeHold ? "Manage pause" : "Pause run")}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[70] flex items-end bg-black/35 p-3 sm:items-center sm:justify-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl bg-surface shadow-xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <p className="text-xs font-semibold uppercase text-faint">Run pause</p>
                <h2 id={titleId} className="mt-1 text-lg font-semibold">
                  {programName}
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
            <div className="px-4 pb-4 pt-3">
              <p className="text-sm leading-6 text-muted">
                Pause only this run. Calendar shifts future workouts forward; other programs keep their schedule.
              </p>
              <ProgramHoldControls programId={programId} activeHold={activeHold} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ProgramHoldControls({
  programId,
  activeHold,
}: {
  programId: number;
  activeHold?: ProgramHoldSummary | null;
}) {
  const defaults = useMemo(() => {
    const today = new Date();
    return {
      startDate: dateKey(today),
      endDate: dateKey(addDays(today, 13)),
    };
  }, []);
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function holdRun() {
    setSaving(true);
    setError("");

    try {
      const response = await fetch(`/api/programs/${programId}/holds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate, reason }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not hold run");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not hold run");
    } finally {
      setSaving(false);
    }
  }

  async function cancelHold() {
    setCanceling(true);
    setError("");

    try {
      const response = await fetch(`/api/programs/${programId}/holds/active`, {
        method: "DELETE",
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not resume run");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resume run");
    } finally {
      setCanceling(false);
    }
  }

  return (
    <>
      {activeHold ? (
        <div className="mt-3 rounded-xl border border-warn-line bg-warn-soft p-3">
          <p className="text-sm font-medium text-warn-ink">
            Held {activeHold.startDate} to {activeHold.endDate}
          </p>
          {activeHold.reason ? <p className="mt-1 text-xs text-warn-ink">{activeHold.reason}</p> : null}
          <button
            type="button"
            disabled={canceling}
            onClick={cancelHold}
            className="touch-target mt-3 rounded-xl border border-warn-line bg-surface px-3 text-sm font-medium text-warn-ink disabled:opacity-50"
          >
            {canceling ? "Resuming..." : "Resume run"}
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-medium text-muted">
              From
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-line px-3 text-sm text-foreground"
              />
            </label>
            <label className="text-xs font-medium text-muted">
              Until
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-line px-3 text-sm text-foreground"
              />
            </label>
          </div>
          <label className="text-xs font-medium text-muted">
            Note
            <input
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Vacation, no rack, travel"
              className="mt-1 h-11 w-full rounded-xl border border-line px-3 text-sm text-foreground"
            />
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={holdRun}
            className="touch-target rounded-xl bg-foreground px-3 text-sm font-medium text-background disabled:opacity-50"
          >
            {saving ? "Pausing..." : "Pause run"}
          </button>
        </div>
      )}

      <div className="mt-3">
        <ErrorBanner message={error} />
      </div>
    </>
  );
}
