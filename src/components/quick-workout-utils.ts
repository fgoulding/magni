"use client";
import { useMemo, useSyncExternalStore } from "react";
import { readResponseJson } from "./workout-card-utils";

const event = "magni-workout-draft";
const fallback = new Map<string, string>();
function read(key: string): string | null {
  if (fallback.has(key)) return fallback.get(key)!;
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: unknown): boolean {
  const text = JSON.stringify(value);
  let persisted = true;
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, text); fallback.delete(key); }
  catch { fallback.set(key, text); persisted = false; }
  window.dispatchEvent(new Event(event));
  return persisted;
}
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener); window.addEventListener(event, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(event, listener); };
}
export function useWorkoutDraft<T>(key: string, initial: T): [T, (value: T | null) => boolean] {
  const snapshot = useSyncExternalStore(subscribe, () => read(key), () => null);
  const parsed = useMemo(() => { try { return snapshot ? JSON.parse(snapshot) as T | null : null; } catch { return null; } }, [snapshot]);
  return [parsed ?? initial, (value) => write(key, value)];
}
export class WorkoutRequestError extends Error {
  constructor(public status: number, message: string, public confirmedRejection = false, public confirmedClientError = false) { super(message); this.name = "WorkoutRequestError"; }
}
export async function workoutRequest<T>(url: string, method: string, data?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const body = await readResponseJson<T & { error?: string }>(response);
  const confirmedClientError = response.status >= 400 && response.status < 500 && typeof body?.error === "string" && body.error.trim().length > 0;
  if (!response.ok || !body) throw new WorkoutRequestError(response.status, body?.error ?? "Could not confirm this change. Your edits remain available to retry.", response.status === 400 && confirmedClientError, confirmedClientError);
  return body;
}
export const workoutInput = "touch-target min-w-0 rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-brand";
export const workoutButton = "touch-target rounded-xl border border-line bg-surface px-3 text-sm font-semibold disabled:opacity-50";

export const workoutPrimaryButton = "touch-target rounded-xl border border-brand bg-brand px-3 text-base font-semibold text-white disabled:opacity-50";

/** Ad-hoc appearances retain their own identity even when they share a lift name. */
export function buildQuickGroups(sets: import("./workout-card-utils").WorkoutSet[]): import("./workout-card-utils").WorkoutGroup[] {
  const groups: import("./workout-card-utils").WorkoutGroup[] = [];
  let priorKey: string | undefined;
  for (const set of sets) {
    const key = (set as typeof set & { exercise_key?: string | null }).exercise_key ?? `legacy:${set.exercise_name}`;
    if (key === priorKey && groups.length > 0) groups.at(-1)!.sets.push(set);
    else groups.push({ index: groups.length, sets: [set], supersetGroup: set.superset_group });
    priorKey = key;
  }
  return groups;
}
