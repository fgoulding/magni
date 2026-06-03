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
  const [error, setError] = useState("");
  const router = useRouter();

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === initialName) {
      setName(initialName);
      setError("");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/exercises/${exerciseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setName(initialName); // revert the optimistic value so the field matches the DB
        setError(body.error ?? "Couldn't rename exercise");
        return;
      }
      router.refresh();
    } catch {
      setName(initialName);
      setError("Couldn't rename — check your connection");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
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
            setError("");
            (event.target as HTMLInputElement).blur();
          }
        }}
        disabled={saving}
        aria-invalid={error ? true : undefined}
        className="touch-target w-full rounded-md bg-transparent p-0 font-semibold outline-none focus:text-brand-strong"
      />
      {error ? (
        <p role="alert" className="mt-1 text-xs font-medium text-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
