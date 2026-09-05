"use client";

import { useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Select } from "@/components/Select";

export function SettingsForm({ initialRounding, initialTimezone }: { initialRounding: number; initialTimezone: string }) {
  const [rounding, setRounding] = useState(initialRounding);
  const [timezone, setTimezone] = useState(initialTimezone);
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
        body: JSON.stringify({ rounding, timezone }),
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
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Training timezone
        <input value={timezone} onChange={event => setTimezone(event.target.value)} list="timezones" className="touch-target rounded-xl border border-line bg-surface px-3 font-normal focus:border-brand" />
        <datalist id="timezones">
          {["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "Europe/London", "Europe/Paris", "Asia/Tokyo", "Australia/Sydney", "UTC"].map(zone => <option key={zone} value={zone} />)}
        </datalist>
      </label>
      <button type="button" className="touch-target rounded-xl border border-line px-3 text-sm font-semibold" onClick={() => setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone)}>Use device timezone</button>
      <p className="text-sm text-muted">Today and workout dates use this timezone. Traveling does not move your schedule.</p>
      <button
        type="submit"
        disabled={submitting}
        className="touch-target rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition-colors active:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
