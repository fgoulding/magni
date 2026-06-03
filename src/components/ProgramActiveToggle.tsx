"use client";

import { useState } from "react";

export function ProgramActiveToggle({
  programId,
  isActive,
  variant = "switch",
}: {
  programId: number;
  isActive: boolean;
  variant?: "switch" | "badge";
}) {
  const [active, setActive] = useState(isActive);
  const [toggling, setToggling] = useState(false);

  async function toggle() {
    setToggling(true);
    try {
      const response = await fetch(`/api/programs/${programId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !active }),
      });
      if (response.ok) {
        setActive(!active);
      }
    } finally {
      setToggling(false);
    }
  }

  if (variant === "badge") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
          active ? "bg-success-soft text-success-ink" : "bg-surface-muted text-faint"
        }`}
      >
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${active ? "bg-success" : "bg-faint"}`}
        />
        {active ? "Active" : "Inactive"}
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={toggling}
      onClick={toggle}
      className={`touch-target inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
        active
          ? "border-success-line bg-success-soft text-success-ink"
          : "border-line bg-surface text-muted"
      }`}
    >
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
          active ? "bg-success" : "bg-line"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform ${
            active ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </span>
      {active ? "Tracking" : "Stopped"}
    </button>
  );
}
