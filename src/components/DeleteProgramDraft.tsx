"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

type Props = {
  userId: number;
  draftId: string;
  name: string;
  revision: number;
  redirectHref?: string;
  prepareDelete?: () => Promise<number | null>;
  onPendingChange?: (pending: boolean) => void;
};

export function DeleteProgramDraft({ userId, draftId, name, revision, redirectHref, prepareDelete, onPendingChange }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const attemptRevision = useRef<number | null>(null);

  async function remove() {
    setPending(true);
    onPendingChange?.(true);
    setError("");
    try {
      // A lost acknowledgement retries the same delete, without trying to save
      // to a draft the server may already have deleted.
      if (attemptRevision.current === null) {
        const readyRevision = prepareDelete ? await prepareDelete() : revision;
        if (readyRevision === null) throw new Error("Resolve the draft's save error before deleting.");
        attemptRevision.current = readyRevision;
      }
      const response = await fetch(`/api/program-drafts/${draftId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: attemptRevision.current }),
      });
      const body = await response.json();
      if (!response.ok) {
        attemptRevision.current = null;
        throw new Error(body.error ?? "Could not delete this draft.");
      }
      if (body.deleted !== true) throw new Error("Deletion response was incomplete. Retry to confirm.");
      try { localStorage.removeItem(`magni:program-draft:${userId}:${draftId}`); } catch { /* The server deletion prevents resurrection even without device storage. */ }
      if (redirectHref) router.push(redirectHref);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not delete this draft. Retry.");
      setPending(false);
      onPendingChange?.(false);
    }
  }

  if (!confirming) return <button type="button" className="touch-target inline-flex items-center justify-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold text-danger-ink" onClick={() => setConfirming(true)}><Trash2 aria-hidden="true" size={16} />Delete draft</button>;

  return <div role="group" aria-label="Delete draft confirmation" className="flex max-w-sm flex-col gap-2 rounded-xl border border-danger-line bg-danger-soft p-3">
    <p className="break-words text-sm font-semibold">Delete “{name || "Untitled program"}” draft?</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={pending} onClick={() => { void remove(); }} className="touch-target rounded-xl bg-danger-ink px-3 text-sm font-semibold text-background disabled:opacity-50">{pending ? "Deleting…" : "Delete draft"}</button>
      <button type="button" disabled={pending} onClick={() => { setConfirming(false); setError(""); }} className="touch-target rounded-xl border border-line bg-surface px-3 text-sm font-semibold">Cancel</button>
    </div>
    {error ? <p role="alert" className="text-sm text-danger-ink">{error}</p> : null}
  </div>;
}
