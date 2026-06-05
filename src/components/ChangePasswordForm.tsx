"use client";

import { useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setError("New passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not change password");
      setMessage("Password changed.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change password");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "touch-target rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-brand-line";

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <ErrorBanner message={error} />
      {message ? <p className="text-sm font-semibold text-success-ink">{message}</p> : null}
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Current password
        <input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        New password
        <input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          required
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Confirm new password
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          required
          className={inputClass}
        />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="touch-target rounded-xl bg-foreground px-4 text-sm font-semibold text-white transition-colors active:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}
