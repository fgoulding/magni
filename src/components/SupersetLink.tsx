"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SupersetLink({
  exerciseId,
  linkExerciseId,
  supersetGroup,
}: {
  exerciseId: number;
  linkExerciseId: number | null;
  supersetGroup: string | null;
}) {
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function toggle() {
    setSaving(true);
    try {
      const response = await fetch(`/api/exercises/${exerciseId}/superset`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkExerciseId: supersetGroup ? null : linkExerciseId,
        }),
      });
      if (response.ok) router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!linkExerciseId) return null;

  if (supersetGroup) {
    return (
      <button
        type="button"
        disabled={saving}
        onClick={toggle}
        className="touch-target rounded-lg border border-line bg-surface px-2 py-1 text-xs font-semibold text-muted transition-colors active:bg-surface-muted"
      >
        Unlink
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={saving}
      onClick={toggle}
      className="touch-target rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-500"
    >
      SS +
    </button>
  );
}
