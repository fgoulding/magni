"use client";

import { useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Select } from "@/components/Select";

export function SettingsForm({ initialRounding }: { initialRounding: number }) {
  const [rounding, setRounding] = useState(initialRounding);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rounding }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not save settings");
      setMessage("Saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <ErrorBanner message={error} />
      {message ? <p className="text-sm font-semibold text-success-ink">{message}</p> : null}
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Weight rounding
        <Select
          value={rounding}
          onChange={(event) => setRounding(Number(event.target.value))}
          className="font-normal"
          aria-label="Weight rounding"
        >
          <option value={1}>1 lb</option>
          <option value={2.5}>2.5 lb</option>
          <option value={5}>5 lb</option>
          <option value={10}>10 lb</option>
        </Select>
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="touch-target rounded-xl bg-foreground px-4 text-sm font-semibold text-white transition-colors active:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
