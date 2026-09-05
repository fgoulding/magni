export type ActualBaseline = { reps: number | null; weight: number | null };
export type SetDraft = { reps: string; weight: string; expectedActual?: ActualBaseline };
export type SetDrafts = Record<number, SetDraft>;
const draftEvent = "magni-planned-draft-changed";
const volatileDrafts = new Map<number, string>();

export function isDraftVolatile(sessionId?: number): boolean {
  return sessionId != null && volatileDrafts.has(sessionId);
}

export function readDraftSnapshot(sessionId?: number): string | null {
  if (!sessionId || typeof window === "undefined") return null;
  if (volatileDrafts.has(sessionId)) return volatileDrafts.get(sessionId)!;
  try { return localStorage.getItem(`magni.planned-workout.${sessionId}.draft.v1`); } catch { return null; }
}

export function parseDrafts(snapshot: string | null): SetDrafts {
  if (!snapshot) return {};
  try {
    const parsed = JSON.parse(snapshot);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([id, value]) =>
      /^\d+$/.test(id) && value && typeof value === "object" && "reps" in value && "weight" in value &&
      typeof value.reps === "string" && typeof value.weight === "string",
    )) as SetDrafts;
  } catch { return {}; }
}

export function writeDrafts(sessionId: number, drafts: SetDrafts): boolean {
  let persisted = true;
  try {
    const key = `magni.planned-workout.${sessionId}.draft.v1`;
    if (Object.keys(drafts).length) localStorage.setItem(key, JSON.stringify(drafts));
    else localStorage.removeItem(key);
    volatileDrafts.delete(sessionId);
  } catch {
    volatileDrafts.set(sessionId, JSON.stringify(drafts));
    persisted = false;
  }
  window.dispatchEvent(new Event(draftEvent));
  return persisted;
}

export function subscribeDrafts(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  window.addEventListener(draftEvent, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(draftEvent, listener);
  };
}
