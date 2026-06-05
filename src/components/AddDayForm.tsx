"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";

export function AddDayForm({ programId }: { programId: number }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const response = await fetch(`/api/programs/${programId}/days`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not add day");
      setName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add day");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="card flex flex-col gap-3 p-4">
      <h2 className="display text-lg">Add day</h2>
      <ErrorBanner message={error} />
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          placeholder="Lower"
          className="touch-target min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-base outline-none transition-colors focus:border-brand"
        />
        <button
          type="submit"
          disabled={submitting}
          className="touch-target rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition-opacity active:opacity-90 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </form>
  );
}
