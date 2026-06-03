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
  dayCount = 0,
}: {
  programId: number;
  initialScheduleWeekdays: readonly number[];
  dayCount?: number;
}) {
  const [selected, setSelected] = useState(() => new Set(initialScheduleWeekdays));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const isCompressedSchedule = dayCount > 0 && selected.size > dayCount;

  function toggle(day: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError("");

    try {
      const response = await fetch(`/api/programs/${programId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleWeekdays: sortedWeekdays(selected) }),
      });
      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(body.error ?? "Could not save schedule");
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save schedule");
    } finally {
      setSaving(false);
    }
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
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="touch-target rounded-xl bg-foreground px-3 text-sm font-semibold text-white transition-opacity active:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save schedule"}
        </button>
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

      <div className="mt-3">
        <ErrorBanner message={error} />
      </div>
    </section>
  );
}
