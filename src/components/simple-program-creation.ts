import type { ProgramDocumentV1 } from "@/features/program-editor/document";

/** Keep this object for the entire attempt, including an unknown network result. */
export type ProgramCreationAttempt = {
  id: string;
  document: ProgramDocumentV1;
  revision: number | null;
  programId: number | null;
  destination: "program" | "workspace";
};

export class ProgramCreationHttpError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

async function request(url: string, method?: "PUT" | "POST", body?: unknown) {
  const response = await fetch(url, method ? {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new ProgramCreationHttpError(result.error ?? "Could not finish creating this program.", response.status);
  return result;
}

async function reconcileOrThrow(attempt: ProgramCreationAttempt, error: unknown) {
  try { await reconcile(attempt); } catch (readError) {
    if (readError instanceof ProgramCreationHttpError && readError.status === 404 && attempt.revision !== null) {
      // GET hides deleted drafts as 404. An idempotent write with this exact
      // identity/document can confirm the tombstone (410), which guarantees a
      // delayed write cannot revive it. Never reset identity on a mere 404.
      try { await request(`/api/program-drafts/${attempt.id}`, "PUT", { document: attempt.document, expectedRevision: attempt.revision }); }
      catch (confirmation) { if (confirmation instanceof ProgramCreationHttpError && confirmation.status === 410) throw confirmation; }
    }
    throw error;
  }
}

async function reconcile(attempt: ProgramCreationAttempt) {
  const saved = await request(`/api/program-drafts/${attempt.id}`);
  if (stableJson(saved.document) !== stableJson(attempt.document)) {
    throw new Error("This draft changed elsewhere. Open it in the workspace to review before creating.");
  }
  if (!Number.isSafeInteger(saved.revision) || saved.revision < 1) throw new Error("Could not confirm the saved program.");
  attempt.revision = saved.revision;
  if (Number.isSafeInteger(saved.activatedProgramId) && saved.activatedProgramId > 0) attempt.programId = saved.activatedProgramId;
}

/** Existing owned endpoints make saving and activation separately idempotent.
 * A lost response is read back before continuing. Never renew IDs on retry. */
export async function finishProgramCreation(attempt: ProgramCreationAttempt): Promise<string> {
  const endpoint = `/api/program-drafts/${attempt.id}`;
  if (attempt.revision === null) {
    try {
      const saved = await request(endpoint, "PUT", { document: attempt.document, expectedRevision: 0 });
      if (!Number.isSafeInteger(saved.revision) || saved.revision < 1) throw new Error("Could not confirm the saved program.");
      attempt.revision = saved.revision;
    } catch (error) {
      await reconcileOrThrow(attempt, error);
    }
  }
  if (attempt.destination === "workspace") return `/programs/editor/${attempt.id}`;
  if (attempt.programId === null) {
    try {
      const active = await request(`${endpoint}/activate`, "POST", { expectedRevision: attempt.revision });
      if (!Number.isSafeInteger(active.programId) || active.programId < 1) throw new Error("Could not confirm the created program.");
      attempt.programId = active.programId;
    } catch (error) {
      await reconcileOrThrow(attempt, error);
      if (attempt.programId === null) throw error;
    }
  }
  return `/programs/${attempt.programId}`;
}
