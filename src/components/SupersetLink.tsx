"use client";

import { Link2, Unlink2 } from "lucide-react";
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

  const base =
    "touch-target inline-flex items-center justify-center rounded-xl border px-2 transition-colors active:bg-surface-muted disabled:opacity-50";

  // A member of a superset → can be unlinked.
  if (supersetGroup) {
    return (
      <button
        type="button"
        disabled={saving}
        onClick={toggle}
        aria-label={failed ? "Unlink superset — failed, tap to retry" : "Unlink from superset"}
        title={failed ? "Couldn't unlink — tap to retry" : "Unlink from superset"}
        className={`${base} ${failed ? "border-danger-line text-danger-ink" : "border-line bg-surface text-muted"}`}
      >
        <Unlink2 aria-hidden="true" size={15} />
      </button>
    );
  }

  // Standalone exercise with a neighbour below → can be supersetted with it.
  if (!linkExerciseId) return null;
  const label = linkName ? `Superset with ${linkName}` : "Superset with the next exercise";
  return (
    <button
      type="button"
      disabled={saving}
      onClick={toggle}
      aria-label={failed ? `${label} — failed, tap to retry` : label}
      title={failed ? "Couldn't link — tap to retry" : label}
      className={`${base} ${failed ? "border-danger-line text-danger-ink" : "border-brand-line bg-brand-soft text-brand-strong"}`}
    >
      <Link2 aria-hidden="true" size={15} />
    </button>
  );
}
