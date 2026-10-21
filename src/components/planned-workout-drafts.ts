import { createSetDraftStore } from "./set-draft-store";

export type ActualBaseline = { reps: number | null; weight: number | null };
export type SetDraft = { reps: string; weight: string; expectedActual?: ActualBaseline; intent?: "undo" | "retained" };
export type SetDrafts = Record<number, SetDraft>;
export const { isDraftVolatile, readDraftSnapshot, parseDrafts, writeDrafts, subscribeDrafts } =
  createSetDraftStore<SetDraft>("magni.planned-workout", "magni-planned-draft-changed");
