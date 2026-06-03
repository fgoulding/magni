"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReorderButton({
  endpoint,
  direction,
  label,
}: {
  endpoint: string;
  direction: "up" | "down";
  label: string;
}) {
  const [moving, setMoving] = useState(false);
  const [failed, setFailed] = useState(false);
  const router = useRouter();
  const Icon = direction === "up" ? ArrowUp : ArrowDown;

  async function move() {
    setMoving(true);
    setFailed(false);
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ move: direction }),
      });
      if (!response.ok) {
        setFailed(true); // leave the order as-is; don't refresh over a failed move
        return;
      }
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setMoving(false);
    }
  }

  const dir = direction === "up" ? "Move up" : "Move down";
  return (
    <button
      type="button"
      aria-label={failed ? `${dir} ${label} — failed, tap to retry` : `${dir} ${label}`}
      title={failed ? "Couldn't reorder — tap to retry" : undefined}
      disabled={moving}
      onClick={move}
      className={`touch-target inline-flex items-center justify-center rounded-xl border px-2 transition-colors active:bg-surface-muted disabled:opacity-50 ${
        failed ? "border-danger-line text-danger-ink" : "border-line bg-surface text-muted"
      }`}
    >
      <Icon aria-hidden="true" size={15} />
    </button>
  );
}
