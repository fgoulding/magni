"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Copy, X } from "lucide-react";
import { calendarReturnHref } from "@/features/calendar/navigation";
import type { AgendaEvent } from "./CalendarAgenda";
import { CalendarCommandConflict, useCalendarCommand, type CalendarAction, type CalendarCommand } from "./calendar-pending-command";

const button = "touch-target inline-flex items-center justify-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold disabled:opacity-50";
const dateLabel = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const plus = (date: string, days: number) => { const result = new Date(`${date}T12:00:00Z`); result.setUTCDate(result.getUTCDate() + days); return result.toISOString().slice(0, 10); };

export function canMoveCalendarEvent(event: AgendaEvent) {
  return !!event.occurrenceId && (event.status === "scheduled" || event.status === "in_progress");
}
function sourceRevision(event: AgendaEvent, type: "move" | "duplicate") {
  return { occurrenceId: event.occurrenceId, revision: event.revision, ...(type === "move" && event.status === "in_progress" ? { sessionRevision: event.sessionRevision } : {}) };
}
function Sheet({ title, children, onClose, busy }: { title: string; children: ReactNode; onClose: () => void; busy: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { if (dialog?.open) dialog.close(); }; }, []);
  const dismiss = () => { if (busy) return; ref.current?.close(); onClose(); };
  return <dialog ref={ref} onCancel={event => { event.preventDefault(); dismiss(); }} aria-label={title} className="m-auto max-h-[85dvh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-4 text-foreground backdrop:bg-foreground/40">
    <div className="mb-4 flex items-center justify-between gap-3"><h2 className="display text-2xl">{title}</h2><button type="button" className={button} disabled={busy} onClick={dismiss} aria-label="Close calendar action"><X aria-hidden="true" size={18} /></button></div>{children}
  </dialog>;
}

/** Week grips, action menus and selected-workout Move use one request/retry path. */
export function useCalendarActions(userId: number, events: AgendaEvent[], weekStart: string, onSaved?: (body: Record<string, unknown>) => void) {
  const router = useRouter();
  const [action, setAction] = useState<CalendarAction | null>(null);
  const [menu, setMenu] = useState<AgendaEvent | null>(null);
  const command = useCalendarCommand(userId);
  const [loadingSession, setLoadingSession] = useState(false);
  const busy = command.busy || loadingSession;
  const blocked = busy || !!command.pending || !!command.storageError;
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const days = Array.from({ length: 7 }, (_, index) => plus(weekStart, index));
  const close = () => { if (!busy) { setAction(null); setMenu(null); setError(""); } };
  async function execute(pending: CalendarCommand) {
    if (loadingSession || !command.acquire()) return null;
    setError("");
    try {
      return await command.withTabLock(async () => {
      // No network write is allowed until the complete command is durable.
      try { command.persist(pending); }
      catch (error) { if (error instanceof CalendarCommandConflict) throw error; throw new Error("Device storage is unavailable. Enable it before saving a calendar change so a retry stays safe."); }
      const response = await fetch("/api/calendar/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: pending.body });
      const result = await response.json();
      if (!response.ok) {
        // The calendar transaction checks its receipt before validating the action.
        // A structured rejection therefore confirms this exact command did not commit.
        if ([400, 404, 409].includes(response.status) && typeof result?.error === "string") command.persist(null, pending);
        if (result?.conflicts && pending.context) setAction({ ...pending.context, conflicts: result.conflicts });
        throw new Error(result?.error || "Calendar change could not be saved.");
      }
      if (typeof result?.operationId !== "string" || !Array.isArray(result.changes)) throw new Error("Could not confirm the calendar change. Retry to recover it safely.");
      command.persist(null, pending);
      setMessage("Calendar saved. Workout details stayed with their workout.");
      setAction(null); setMenu(null);
      const body = JSON.parse(pending.body) as Record<string, unknown>;
      if (onSaved) onSaved(body); else router.refresh();
      return result;
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Connection lost. Try again to safely retry this change."); return null; }
    finally { command.release(); }
  }
  async function send(body: Record<string, unknown>, context = action) {
    try {
      if (busy) return null;
      if (command.current()) { setError("Confirm the previous calendar change before making another."); return null; }
      return await execute({ body: JSON.stringify({ ...body, requestKey: crypto.randomUUID() }), context });
    } catch { setError("The pending calendar change could not be read. Restore device storage before making another change."); return null; }
  }
  async function retry() {
    try { const pending = command.current(); if (pending) await execute(pending); }
    catch { setError("The pending calendar change could not be read. Restore device storage before making another change."); }
  }
  async function openMove(event: AgendaEvent, targetDate?: string) {
    if (blocked) return;
    setError("");
    let current = event;
    if (event.status === "in_progress") {
      setLoadingSession(true);
      try {
        if (!event.sessionId) throw new Error("Refresh the calendar before moving this workout.");
        const response = await fetch(`/api/sessions/${event.sessionId}`);
        const session = await response.json();
        if (!response.ok) throw new Error(session.error || "Could not load the workout. Try again.");
        if (session.id !== event.sessionId || session.status !== "in_progress" || !Number.isSafeInteger(session.revision)) throw new Error("This workout changed. Refresh the calendar before moving it.");
        current = { ...event, sessionRevision: session.revision, date: session.date };
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not load the workout. Try again.");
        return;
      } finally { setLoadingSession(false); }
    }
    setMenu(null);
    if (targetDate) chooseDate(current, "move", targetDate);
    else setAction({ event: current, type: "move", date: current.date });
  }
  function chooseDate(event: AgendaEvent, type: "move" | "duplicate", date: string) {
    if (blocked) return;
    const conflicts = events.filter(value => (type === "duplicate" || value.key !== event.key) && value.date === date)
      .map(value => ({ key: value.key, id: value.occurrenceId ?? null, date: value.date, name: value.dayName || "Workout", revision: value.revision ?? 0, canSwap: !!value.occurrenceId && value.status === "scheduled" }));
    if (conflicts.length) { setAction({ event, type, date, conflicts }); return; }
    const context = { event, type, date };
    setAction(context);
    void send({ type, ...sourceRevision(event, type), date }, context);
  }
  return { action, setAction, menu, setMenu, busy, blocked, error: error || command.storageError, setError, message, days, close, send, chooseDate, openMove, pending: command.pending, retry };
}

export function CalendarActionSheets({ controller }: { controller: ReturnType<typeof useCalendarActions> }) {
  const { action, setAction, menu, setMenu, busy, blocked, error, days, close, send, chooseDate, openMove, pending, retry } = controller;
  const pendingBody = pending ? JSON.parse(pending.body) as Record<string, unknown> : null;
  const recovery = pendingBody && <div className="my-3 rounded-xl border border-warn-line bg-warn-soft p-3"><p className="text-sm">Confirm the previous {String(pendingBody.type)}{typeof pendingBody.date === "string" ? ` to ${pendingBody.date}` : ""} before making another change.</p><button type="button" className={`${button} mt-2 bg-surface`} disabled={busy} onClick={() => void retry()}>Retry calendar change</button></div>;
  return <>
    {!action && !menu && recovery}
    {action && <Sheet title={`${action.type === "move" ? "Move" : "Duplicate"} ${action.event.dayName}`} onClose={close} busy={busy}>
      <p className="mb-3 text-sm text-muted">Week {action.event.currentWeek} · {action.event.programName}. {action.type === "duplicate" ? "Adds a new exposure to this run and reopens it if completed." : action.event.status === "in_progress" ? "Changes this workout’s training date. Its saved sets and original schedule stay unchanged." : "The workout and its sets stay together."}</p>
      {action.conflicts?.length ? <div className="flex flex-col gap-2">
        <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn-ink">{dateLabel(action.date)} already has {action.conflicts.map(row => row.name).join(", ")}.</p>
        <button type="button" className={`${button} bg-foreground text-background`} disabled={blocked} onClick={() => void send({ type: action.type, ...sourceRevision(action.event, action.type), date: action.date, collision: "move" })}>{action.type === "duplicate" ? "Duplicate" : "Move"} here · keep both</button>
        {action.type === "move" && action.event.status === "scheduled" && action.conflicts.filter(target => target.canSwap).map(target => <button type="button" key={target.key} className={button} disabled={blocked} onClick={() => void send({ type: "move", ...sourceRevision(action.event, "move"), date: action.date, collision: "swap", targetId: target.id, targetRevision: target.revision })}>Swap with {target.name}</button>)}
        <button type="button" className={button} disabled={blocked} onClick={() => setAction({ ...action, conflicts: undefined })}>Choose another date</button>
      </div> : <>
        <div className="grid grid-cols-2 gap-2">{days.map(date => <button type="button" key={date} className={button} disabled={blocked || (action.type === "move" && date === action.event.date)} onClick={() => chooseDate(action.event, action.type, date)}>{dateLabel(date)}</button>)}</div>
        <div className="mt-4 flex items-end gap-2"><label className="min-w-0 flex-1 text-sm font-semibold">Another date<input type="date" value={action.date} disabled={blocked} onChange={event => setAction({ ...action, date: event.target.value })} className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3" /></label><button type="button" className={`${button} bg-foreground text-background`} disabled={blocked || !action.date} onClick={() => chooseDate(action.event, action.type, action.date)}>Save date</button></div>
      </>}
      {recovery}
      {error && <p role="alert" className="mt-3 rounded-xl bg-danger-soft p-3 text-sm text-danger-ink">{error}</p>}
    </Sheet>}
    {menu && <Sheet title={`${menu.dayName} options`} onClose={close} busy={busy}><div className="flex flex-col gap-2">
      {canMoveCalendarEvent(menu) && <button type="button" className={button} disabled={blocked} onClick={() => void openMove(menu)}><ArrowRightLeft aria-hidden="true" size={16} />Move</button>}
      <button type="button" className={button} disabled={blocked} onClick={() => { setAction({ event: menu, type: "duplicate", date: plus(menu.date, 1) }); setMenu(null); }}><Copy aria-hidden="true" size={16} />Duplicate workout</button>
      {menu.status === "scheduled" && <button type="button" className={`${button} text-danger-ink`} disabled={blocked} onClick={() => void send({ type: "skip", occurrenceId: menu.occurrenceId, revision: menu.revision })}>Skip this workout</button>}
      {recovery}
      <p className="text-sm text-muted">Skipped workouts stay on their calendar date.</p>
      {error && <p role="alert" className="text-danger-ink">{error}</p>}
    </div></Sheet>}
  </>;
}

export function CalendarMoveButton({ userId, event, events, weekStart, returnTo }: { userId: number; event: AgendaEvent; events: AgendaEvent[]; weekStart: string; returnTo: string }) {
  const router = useRouter();
  const controller = useCalendarActions(userId, events, weekStart, body => {
    if (body.type !== "move") { router.refresh(); return; }
    const target = new URL(calendarReturnHref(returnTo) ?? "/calendar", "https://magni.invalid");
    target.searchParams.set("month", String(body.date).slice(0, 7));
    target.searchParams.set("date", String(body.date));
    target.searchParams.set("workout", `occurrence-${body.occurrenceId}`);
    router.replace(`${target.pathname}${target.search}`, { scroll: false });
    router.refresh();
  });
  return <>
    {canMoveCalendarEvent(event) && <button type="button" className={button} disabled={controller.blocked} onClick={click => {
      click.currentTarget.focus({ preventScroll: true });
      void controller.openMove(event);
    }}><ArrowRightLeft aria-hidden="true" size={16} />Move to date</button>}
    {controller.error && !controller.action ? <p role="alert" className="mt-2 text-sm text-danger-ink">{controller.error}</p> : null}
    <CalendarActionSheets controller={controller} />
  </>;
}

/** Keeps recovery reachable when the month view has no selected workout. */
export function CalendarPendingRecovery({ userId, events, weekStart }: { userId: number; events: AgendaEvent[]; weekStart: string }) {
  const controller = useCalendarActions(userId, events, weekStart);
  return <>{controller.error && !controller.action && <p role="alert" className="text-sm text-danger-ink">{controller.error}</p>}<CalendarActionSheets controller={controller} /></>;
}
