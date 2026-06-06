"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";

const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
] as const;

function sortedWeekdays(values: ReadonlySet<number>): number[] {
  return [...values].sort((a, b) => a - b);
}

export function ProgramScheduleForm({
  programId,
  initialScheduleWeekdays,
  initialStartDate,
  dayCount = 0,
}: {
  programId: number;
  initialScheduleWeekdays: readonly number[];
  initialStartDate?: string | null;
  dayCount?: number;
}) {
  const [selected, setSelected] = useState(() => new Set(initialScheduleWeekdays));
  const [startDate, setStartDate] = useState(initialStartDate ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const isCompressedSchedule = dayCount > 0 && selected.size > dayCount;

  // Auto-save the schedule start (the calendar anchor) on change.
  async function saveStartDate(value: string) {
    const previous = startDate;
    setStartDate(value);
    setError("");
    setSaving(true);
    try {
      const response = await fetch(`/api/programs/${programId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: value || null }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStartDate(previous);
        throw new Error(body.error ?? "Could not save start date");
      }
      router.refresh();
    } catch (err) {
      setStartDate(previous);
      setError(err instanceof Error ? err.message : "Couldn't save — check your connection");
    } finally {
      setSaving(false);
    }
  }

  // Auto-save on each toggle — matches the rest of the editor (no Save button).
  async function persist(next: Set<number>, previous: Set<number>) {
    setError("");
    setSaving(true);
    try {
      const response = await fetch(`/api/programs/${programId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleWeekdays: sortedWeekdays(next) }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setSelected(previous); // revert the optimistic toggle
        throw new Error(body.error ?? "Could not save schedule");
      }
      router.refresh();
    } catch (err) {
      setSelected(previous);
      setError(err instanceof Error ? err.message : "Couldn't save — check your connection");
    } finally {
      setSaving(false);
    }
  }

  function toggle(day: number) {
    const next = new Set(selected);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    setSelected(next); // optimistic
    void persist(next, selected);
  }

  return (
    <section className="card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="display text-lg">Schedule</h2>
          <p className="mt-0.5 text-xs text-muted">
            {selected.size > 0 ? `${selected.size} day${selected.size > 1 ? "s" : ""} each week` : "Unscheduled"}
          </p>
        </div>
        <span className="text-xs font-medium text-faint">{saving ? "Saving…" : "Tap days to schedule"}</span>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((day) => {
          const isSelected = selected.has(day.value);

          return (
            <button
              key={day.value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => toggle(day.value)}
              className={`touch-target rounded-xl border px-1 text-sm font-semibold transition-colors ${
                isSelected
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-surface text-muted active:bg-surface-muted"
              }`}
            >
              {day.label}
            </button>
          );
        })}
      </div>

      {isCompressedSchedule ? (
        <p className="mt-3 rounded-xl border border-warn-line bg-warn-soft px-3 py-2 text-xs leading-5 text-warn-ink">
          This schedule has more training days per week than the workout definition has days, so the cycle will be compressed into less than one week.
        </p>
      ) : null}

      <label className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
        <span className="text-sm font-medium">
          Starts on
          <span className="mt-0.5 block text-xs font-normal text-muted">Anchors the calendar projection.</span>
        </span>
        <input
          type="date"
          value={startDate}
          onChange={(event) => saveStartDate(event.target.value)}
          aria-label="Program start date"
          className="touch-target rounded-xl border border-line bg-surface px-3 text-base text-foreground outline-none transition-colors focus:border-brand"
        />
      </label>

      <div className="mt-3">
        <ErrorBanner message={error} />
      </div>
    </section>
  );
}
