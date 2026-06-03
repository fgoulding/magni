"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(body.error ?? "Authentication failed");
      }

      router.push("/today");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4">
      <div>
        <p className="eyebrow text-xs text-brand-strong">Magni</p>
        <h1 className="display mt-1.5 text-4xl">{mode === "login" ? "Log in" : "Create account"}</h1>
        <p className="mt-1.5 text-sm leading-6 text-muted">
          Use this self-hosted workout planner on your iPhone.
        </p>
      </div>

      <ErrorBanner message={error} />

      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Email
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
          className="touch-target rounded-xl border border-line bg-surface px-3 text-base font-normal outline-none transition-colors focus:border-brand"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Password
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={6}
          required
          className="touch-target rounded-xl border border-line bg-surface px-3 text-base font-normal outline-none transition-colors focus:border-brand"
        />
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="touch-target rounded-xl bg-brand px-4 text-base font-semibold text-white transition-colors active:bg-brand-strong disabled:opacity-50"
      >
        {submitting ? "Working…" : mode === "login" ? "Log in" : "Create account"}
      </button>

      <p className="text-center text-sm text-muted">
        {mode === "login" ? (
          <>
            Need an account?{" "}
            <Link href="/register" className="font-semibold text-brand-strong">
              Register
            </Link>
          </>
        ) : (
          <>
            Already registered?{" "}
            <Link href="/login" className="font-semibold text-brand-strong">
              Log in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
