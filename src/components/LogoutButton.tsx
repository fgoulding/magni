"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function logout() {
    setSubmitting(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      disabled={submitting}
      onClick={logout}
      className="touch-target rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-foreground transition-colors active:bg-surface-muted disabled:opacity-50"
    >
      {submitting ? "Logging out…" : "Log out"}
    </button>
  );
}
