/** Storage plumbing shared by the planned and Quick loggers; draft semantics stay local. */
export function createSetDraftStore<T extends { reps: string; weight: string }>(prefix: string, event: string) {
  const volatile = new Map<number, string>();
  type Drafts = Record<number, T>;
  return {
    isDraftVolatile(sessionId?: number) { return sessionId != null && volatile.has(sessionId); },
    readDraftSnapshot(sessionId?: number): string | null {
      if (!sessionId || typeof window === "undefined") return null;
      if (volatile.has(sessionId)) return volatile.get(sessionId)!;
      try { return localStorage.getItem(`${prefix}.${sessionId}.draft.v1`); } catch { return null; }
    },
    parseDrafts(snapshot: string | null): Drafts {
      if (!snapshot) return {};
      try {
        const parsed = JSON.parse(snapshot);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        return Object.fromEntries(Object.entries(parsed).filter(([id, value]) =>
          /^\d+$/.test(id) && value && typeof value === "object" && "reps" in value && "weight" in value &&
          typeof value.reps === "string" && typeof value.weight === "string",
        )) as Drafts;
      } catch { return {}; }
    },
    writeDrafts(sessionId: number, drafts: Drafts): boolean {
      const snapshot = JSON.stringify(drafts);
      let persisted = true;
      try {
        const key = `${prefix}.${sessionId}.draft.v1`;
        if (Object.keys(drafts).length) localStorage.setItem(key, snapshot);
        else localStorage.removeItem(key);
        volatile.delete(sessionId);
      } catch { volatile.set(sessionId, snapshot); persisted = false; }
      window.dispatchEvent(new Event(event));
      return persisted;
    },
    subscribeDrafts(listener: () => void): () => void {
      window.addEventListener("storage", listener); window.addEventListener(event, listener);
      return () => { window.removeEventListener("storage", listener); window.removeEventListener(event, listener); };
    },
  };
}
