"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SupersetLink({
  exerciseId,
  linkExerciseId,
  supersetGroup,
  linkName,
}: {
  exerciseId: number;
  linkExerciseId: number | null;
  supersetGroup: string | null;
  /** Name of the exercise this will be linked with — used for an accessible label. */
  linkName?: string | null;
}) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const router = useRouter();

  async function toggle() {
    setSaving(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/exercises/${exerciseId}/superset`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkExerciseId: supersetGroup ? null : linkExerciseId }),
      });
      if (!response.ok) {
        setFailed(true);
        return;
      }
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  // A superset links an exercise with the one below it; the last exercise has
  // nothing to link to, so no control is shown.
  if (!linkExerciseId) return null;

  if (supersetGroup) {
    return (
      <button
        type="button"
        disabled={saving}
        onClick={toggle}
        aria-label={failed ? "Unlink superset — failed, tap to retry" : "Unlink superset"}
        title={failed ? "Couldn't unlink — tap to retry" : undefined}
        className={`touch-target rounded-lg border px-2 py-1 text-xs font-semibold transition-colors active:bg-surface-muted ${
          failed ? "border-danger-line text-danger-ink" : "border-line bg-surface text-muted"
        }`}
      >
        Unlink
      </button>
    );
  }

  const link = linkName ? `Superset with ${linkName}` : "Superset with the next exercise";
  return (
    <button
      type="button"
      disabled={saving}
      onClick={toggle}
      aria-label={failed ? `${link} — failed, tap to retry` : link}
      title={failed ? "Couldn't link — tap to retry" : link}
      className={`touch-target rounded-md border px-2 py-1 text-xs font-semibold transition-colors active:bg-surface-muted ${
        failed ? "border-danger-line text-danger-ink" : "border-brand-line bg-brand-soft text-brand-strong"
      }`}
    >
      SS +
    </button>
  );
}
