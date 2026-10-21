"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { AgendaEvent } from "./CalendarAgenda";
import type { CalendarConflict } from "@/features/calendar/calendar-service";

export type CalendarAction = { event: AgendaEvent; type: "move" | "duplicate"; date: string; conflicts?: CalendarConflict[] };
export type CalendarCommand = { body: string; context: CalendarAction | null };
export class CalendarCommandConflict extends Error {}

const changed = "magni-calendar-command";
const inFlight = new Set<number>();
const key = (userId: number) => `magni.calendar.pending:${userId}`;
const unavailable = "storage-unavailable";
function read(userId: number) { try { return localStorage.getItem(key(userId)); } catch { return unavailable; } }
function decode(snapshot: string | null): CalendarCommand | null {
  if (!snapshot) return null;
  const value = JSON.parse(snapshot) as CalendarCommand;
  const body = JSON.parse(value.body);
  if (!body || !["move", "duplicate", "skip"].includes(body.type) || typeof body.requestKey !== "string" || !Number.isSafeInteger(body.occurrenceId) || !Number.isSafeInteger(body.revision)) throw new Error("Invalid pending calendar change");
  return { body: value.body, context: value.context ?? null };
}
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener); window.addEventListener(changed, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(changed, listener); };
}
function notify() { window.dispatchEvent(new Event(changed)); }

/** One durable command and synchronous request lock per signed-in owner, shared by calendar surfaces. */
export function useCalendarCommand(userId: number) {
  const snapshot = useSyncExternalStore(subscribe, () => read(userId), () => null);
  const busy = useSyncExternalStore(subscribe, () => inFlight.has(userId), () => false);
  const state = useMemo(() => {
    try { return { pending: decode(snapshot), storageError: "" }; }
    catch { return { pending: null, storageError: "The pending calendar change could not be read. Restore device storage before making another change." }; }
  }, [snapshot]);
  return {
    ...state, busy,
    current: () => decode(read(userId)),
    persist(command: CalendarCommand | null, acknowledged?: CalendarCommand) {
      const current = decode(read(userId));
      if (command) {
        if (current && current.body !== command.body) throw new CalendarCommandConflict("Confirm another calendar change before making this one.");
        localStorage.setItem(key(userId), JSON.stringify(command));
      } else {
        // Another tab can acknowledge this request and then create a new one.
        // A late response only clears its own exact command.
        if (!acknowledged || current?.body !== acknowledged.body) return;
        localStorage.removeItem(key(userId));
      }
      notify();
    },
    async withTabLock<T>(work: () => Promise<T>): Promise<T> {
      if (!navigator.locks) return work();
      return navigator.locks.request(key(userId), { ifAvailable: true }, lock => {
        if (!lock) throw new Error("Another tab is confirming a calendar change. Retry when it finishes.");
        return work();
      });
    },
    acquire() { if (inFlight.has(userId)) return false; inFlight.add(userId); notify(); return true; },
    release() { inFlight.delete(userId); notify(); },
  };
}
