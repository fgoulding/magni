"use client";

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarStatus } from "./CalendarStatus";
import { withCalendarReturn } from "@/features/calendar/navigation";

export type CalendarDayEntry = {
  key: string; date: string; title: string; href: string; status: string;
  dayName?: string; programName?: string; occurrenceId?: number;
};

export function calendarDayLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

const action = "touch-target inline-flex items-center justify-center rounded-xl border border-line px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

function DayDialog({ date, events, returnTo, onClose, onOptions }: {
  date: string; events: CalendarDayEntry[]; returnTo?: string; onClose: () => void; onOptions?: (key: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const title = `Workouts on ${calendarDayLabel(date)}`;
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  // Close synchronously so focus returns to the date button before another
  // calendar action dialog opens or navigation removes this list.
  const dismiss = () => { ref.current?.close(); onClose(); };
  return <dialog ref={ref} aria-label={title} onCancel={event => { event.preventDefault(); dismiss(); }}
    className="m-auto max-h-[85dvh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-4 text-foreground backdrop:bg-foreground/40">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="display text-2xl">{title}</h2>
      <button type="button" className={action} aria-label="Close day workouts" onClick={dismiss}>Close</button>
    </div>
    <ul className="divide-y divide-line">
      {events.map(event => <li key={event.key} className="flex min-w-0 items-center gap-2 py-2">
        <Link prefetch={false} href={event.href} scroll={false} onClick={dismiss} aria-label={`${event.title} on ${date}`}
          className="touch-target flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 focus-visible:outline-2 focus-visible:outline-brand">
          <CalendarStatus status={event.status} />
          <span className="min-w-0">
            <span className="display block break-words text-xl">{event.dayName || "Quick workout"}</span>
            {event.programName && event.programName !== event.dayName ? <span className="block break-words text-sm text-muted">{event.programName}</span> : null}
          </span>
        </Link>
        {onOptions && event.occurrenceId ? <button type="button" className={`${action} shrink-0`} aria-label={`More options for ${event.dayName}`}
          onClick={() => { dismiss(); onOptions(event.key); }}><MoreHorizontal aria-hidden="true" size={18} /></button> : null}
      </li>)}
    </ul>
    <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
      <Link prefetch={false} onClick={dismiss} className={action} href={withCalendarReturn(`/workouts/new?date=${date}`, returnTo ?? null)}>Add workout</Link>
      <Link prefetch={false} onClick={dismiss} scroll={false} className={action} href={`/calendar?month=${date.slice(0, 7)}&date=${date}`}>See this week</Link>
    </div>
  </dialog>;
}

/** A bounded overview target with every workout available in its day list. */
export function CalendarDayButton({ date, events, returnTo, className, children, onOptions, disabled }: {
  date: string; events: CalendarDayEntry[]; returnTo?: string; className: string; children: ReactNode;
  onOptions?: (key: string) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={className} disabled={disabled} aria-label={`${events.length} workouts on ${calendarDayLabel(date)}`} aria-haspopup="dialog" onClick={event => {
      // Safari does not focus buttons on pointer taps. Native dialog restoration
      // needs the opening day to be focused before showModal captures it.
      event.currentTarget.focus({ preventScroll: true });
      setOpen(true);
    }}>{children}</button>
    {open ? <DayDialog date={date} events={events} returnTo={returnTo} onClose={() => setOpen(false)} onOptions={onOptions} /> : null}
  </>;
}
