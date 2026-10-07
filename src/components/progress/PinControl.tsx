"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProgressHome } from "@/features/progress/types";
import { progressButton } from "./ProgressChrome";
import { progressRequest } from "./request";

export function PinControl({ exerciseId, name, pinned, pins }: { exerciseId: string; name: string; pinned: boolean; pins: { id: string; name: string }[] }) {
  const router = useRouter();
  const [isPinned, setPinned] = useState(pinned);
  const [replacement, setReplacement] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(replaceExerciseId?: string) {
    setBusy(true); setError("");
    try {
      const home = await progressRequest<ProgressHome>("/api/progress/pins", { exerciseId, pinned: !isPinned, ...(replaceExerciseId ? { replaceExerciseId } : {}) });
      setPinned(home.pinned.some(pin => pin.id === exerciseId)); setChoosing(false); router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update pins. Please retry."); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-3">
    {!choosing && <button type="button" disabled={busy} className={`${progressButton} self-start`} onClick={() => !isPinned && pins.length >= 4 ? setChoosing(true) : void save()}>{busy ? "Saving…" : isPinned ? "Unpin exercise" : "Pin exercise"}</button>}
    {choosing && <fieldset disabled={busy} className="card p-4"><legend className="px-1 font-semibold">Choose a pin to replace</legend><p className="text-sm text-muted">Your overview holds four pins. Replace one with {name}.</p><div className="mt-3 flex flex-col gap-1">{pins.map(pin => <label key={pin.id} className="touch-target flex cursor-pointer items-center gap-3 rounded-lg py-2"><input type="radio" name="replace-pin" value={pin.id} checked={replacement === pin.id} onChange={() => setReplacement(pin.id)} className="h-5 w-5 shrink-0 accent-brand" /><span className="break-words">{pin.name}</span></label>)}</div><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!replacement || busy} className={progressButton} onClick={() => replacement && void save(replacement)}>Replace selected pin</button><button type="button" className={progressButton} onClick={() => setChoosing(false)}>Cancel</button></div></fieldset>}
    {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
  </div>;
}
