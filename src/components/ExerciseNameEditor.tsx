"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ExerciseNameEditor({
  exerciseId,
  initialName,
}: {
  exerciseId: number;
  initialName: string;
}) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === initialName) {
      setName(initialName);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/exercises/${exerciseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (response.ok) router.refresh();
    } catch {
      setName(initialName);
    } finally {
      setSaving(false);
    }
  }

  return (
    <input
      value={name}
      onChange={(event) => setName(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          save();
        }
        if (event.key === "Escape") {
          setName(initialName);
          (event.target as HTMLInputElement).blur();
        }
      }}
      disabled={saving}
      className="touch-target w-full rounded-md bg-transparent p-0 font-semibold outline-none focus:text-brand-strong"
    />
  );
}
