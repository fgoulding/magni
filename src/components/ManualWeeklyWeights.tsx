"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Per-week weight editor for manual (custom) exercises. Each week pre-fills from
 * the previous week (change one and later weeks that matched it follow along),
 * and the value the editor opened with stays in grey ("was 432") so an accidental
 * overtype is recoverable. Saves on blur, like the rest of the editor.
 */
export function ManualWeeklyWeights({ exerciseId }: { exerciseId: number }) {
  const [weights, setWeights] = useState<number[] | null>(null);
  const [opened, setOpened] = useState<number[]>([]); // values on load — the recovery reference
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const router = useRouter();

  useEffect(() => {
    let active = true;
    fetch(`/api/exercises/${exerciseId}/weekly-weights`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { weights?: number[] } | null) => {
        if (active && data?.weights) {
          setWeights(data.weights);
          setOpened(data.weights);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [exerciseId]);

  function setWeek(index: number, value: number) {
    setWeights((prev) => {
      if (!prev) return prev;
      const previousValue = prev[index];
      const next = [...prev];
      next[index] = value;
      // Fill-down: later weeks still holding the old (inherited) value follow along.
      for (let later = index + 1; later < next.length; later += 1) {
        if (next[later] === previousValue) next[later] = value;
        else break;
      }
      return next;
    });
  }

  async function save() {
    if (!weights) return;
    setStatus("saving");
    try {
      const response = await fetch(`/api/exercises/${exerciseId}/weekly-weights`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weights }),
      });
      if (!response.ok) throw new Error("save failed");
      setStatus("saved");
      router.refresh();
    } catch {
      setStatus("error");
    }
  }

  if (!weights) return null;

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-faint">Weekly weight (lb)</span>
        <span className="text-[10px] text-faint">
          {status === "saving"
            ? "Saving…"
            : status === "saved"
              ? "Saved"
              : status === "error"
                ? "Couldn't save"
                : "Edit any week"}
        </span>
      </div>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {weights.map((weight, index) => (
          <div key={index} className="flex items-center gap-2.5">
            <span className="w-14 shrink-0 text-xs text-muted">Week {index + 1}</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={0.5}
              value={weight}
              onChange={(event) => setWeek(index, Number(event.target.value))}
              onBlur={save}
              aria-label={`Week ${index + 1} weight`}
              className="touch-target w-24 rounded-xl border border-line bg-surface px-3 text-base text-foreground outline-none transition-colors focus:border-brand"
            />
            {opened[index] !== undefined && opened[index] !== weight ? (
              <span className="text-xs text-faint">was {opened[index]}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
