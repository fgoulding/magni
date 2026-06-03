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
  const router = useRouter();
  const Icon = direction === "up" ? ArrowUp : ArrowDown;

  async function move() {
    setMoving(true);
    try {
      await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ move: direction }),
      });
      router.refresh();
    } finally {
      setMoving(false);
    }
  }

  return (
    <button
      type="button"
      aria-label={`${direction === "up" ? "Move up" : "Move down"} ${label}`}
      disabled={moving}
      onClick={move}
      className="touch-target inline-flex items-center justify-center rounded-xl border border-line bg-surface px-2 text-muted transition-colors active:bg-surface-muted disabled:opacity-50"
    >
      <Icon aria-hidden="true" size={15} />
    </button>
  );
}
