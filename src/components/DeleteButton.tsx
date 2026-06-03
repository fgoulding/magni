"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteButton({
  endpoint,
  label,
  redirectHref,
}: {
  endpoint: string;
  label: string;
  redirectHref?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function deleteItem() {
    setDeleting(true);
    setError("");

    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to delete ${label}`);
      }

      if (redirectHref) {
        router.push(redirectHref);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to delete ${label}`);
    } finally {
      setDeleting(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={deleting}
            onClick={deleteItem}
            className="touch-target rounded-xl bg-danger-ink px-3 text-xs font-semibold text-white transition-opacity active:opacity-90 disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => {
              setError("");
              setConfirming(false);
            }}
            className="touch-target rounded-xl border border-line bg-surface px-3 text-xs font-semibold transition-colors active:bg-surface-muted"
          >
            Cancel
          </button>
        </div>
        {error ? <p className="max-w-48 text-right text-xs font-medium text-danger-ink">{error}</p> : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="touch-target rounded-xl border border-line bg-surface px-3 text-xs font-semibold text-danger-ink transition-colors active:bg-danger-soft"
    >
      Delete {label}
    </button>
  );
}
