import { userDateKey } from "@/lib/user-date";
import Link from "next/link";
import { getOccurrences, getOccurrence, occurrenceLiftPreview } from "@/features/programs/occurrences";
import { redirect } from "next/navigation";
import { SessionRecapView } from "@/components/SessionRecapView";
import { WorkoutCard } from "@/components/WorkoutCard";
import { WorkoutReuse } from "@/components/WorkoutReuse";
import {
  getProgramDayLiftPreview,
  type TodayLiftPreview,
} from "@/features/programs/program-service";
import { getSessionRecap } from "@/features/programs/training-stats";
import { getSettingNumber, requireUser } from "@/lib/auth";
import { parseDateKey, toLocalDateKey } from "@/lib/date-key";
import { db } from "@/lib/db";
import { CalendarNavigation } from "@/components/CalendarNavigation";
import { withCalendarReturn } from "@/features/calendar/navigation";
import { CalendarAgenda } from "@/components/CalendarAgenda";
import { latestCalendarOperation } from "@/features/calendar/calendar-service";

type CalendarPageProps = {
  searchParams?: Promise<{ month?: string | string[]; date?: string | string[]; train?: string | string[]; workout?: string | string[]; view?: string | string[]; compact?: string | string[] }>;
};

type HistoryRow = {
  id: number;
  program_id: number | null;
  day_id: number | null;
  program_definition_day_id: number | null;
  scheduled_date: string | null;
  date: string;
  week_number: number;
  day_number: number | null;
  status: "completed" | "skipped" | "in_progress";
  program_name: string;
  day_name: string;
};

type CalendarEvent = {
  key: string;
  date: string;
  kind: "completed" | "skipped" | "scheduled" | "in_progress";
  title: string;
  href: string;
  /** The logged session, for completed/skipped events (drives the recap). */
  sessionId?: number;
  occurrenceId?: number;
  programId?: number | null;
  dayId?: number | null;
  definitionDayId?: number | null;
  programName?: string;
  dayName?: string;
  currentWeek?: number;
  currentDay?: number;
  scheduledDate?: string;
  status: string;
  revision?: number;
  summary?: string;
};

type CalendarDayEventSummary = Readonly<{
  kind: CalendarEvent["kind"];
  count: number;
  label: string;
}>;

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

function parseMonth(value: string | string[] | undefined, now: Date): Date {
  const raw = Array.isArray(value) ? value[0] : value;
  const match = raw?.match(/^(\d{4})-(\d{2})$/);
  if (!match) return new Date(now.getFullYear(), now.getMonth(), 1);

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  return new Date(year, month - 1, 1);
}

function monthHref(monthStart: Date): string {
  const month = String(monthStart.getMonth() + 1).padStart(2, "0");
  return `/calendar?month=${monthStart.getFullYear()}-${month}`;
}

function calendarHref(monthStart: Date, train?: string): string {
  const base = monthHref(monthStart);
  return train ? `${base}&workout=${encodeURIComponent(train)}` : base;
}

function buildMonthDays(monthStart: Date): Date[] {
  const days: Date[] = [];
  const cursor = new Date(monthStart);

  while (cursor.getMonth() === monthStart.getMonth()) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function formatLiftDetail(lift: TodayLiftPreview): string {
  if (lift.detail) return lift.detail;
  if (lift.bodyweight) return `${lift.set_count}×${lift.reps} BW`;
  return `${lift.set_count}×${lift.reps} @ ${lift.weight} lb`;
}

function getHistoryEvents(userId: number, monthStart: Date, monthEnd: Date): CalendarEvent[] {
  const rows = db
    .prepare(
      `
        SELECT
          s.id,
          s.program_id,
          s.day_id,
          s.program_definition_day_id,
          s.scheduled_date,
          s.date,
          s.week_number,
          s.status,
          COALESCE(pdd.day_number, d.day_number) AS day_number,
          COALESCE(NULLIF(s.program_name, ''), p.name, '') AS program_name,
          COALESCE(NULLIF(s.day_name, ''), d.name, '') AS day_name
        FROM sessions s
        LEFT JOIN programs p ON p.id = s.program_id
        LEFT JOIN days d ON d.id = s.day_id
        LEFT JOIN program_definition_days pdd ON pdd.id = s.program_definition_day_id
        WHERE s.user_id = ?
          AND s.status IN ('completed', 'skipped', 'in_progress')
          AND s.occurrence_id IS NULL
          AND s.date BETWEEN ? AND ?
        ORDER BY s.date, s.id
      `,
    )
    .all(userId, toLocalDateKey(monthStart), toLocalDateKey(monthEnd)) as HistoryRow[];

  return rows.map((row) => ({
    key: `history-${row.id}`,
    date: row.date,
    kind: row.status,
    status: row.status,
    title: `${row.status === "completed" ? "Completed" : row.status === "in_progress" ? "In progress" : "Skipped"}: ${row.program_name} - ${row.day_name}`,
    href: `/calendar?month=${row.date.slice(0,7)}&workout=history-${row.id}`,
    sessionId: row.id,
    programId: row.program_id,
    dayId: row.day_id ?? row.program_definition_day_id,
    definitionDayId: row.program_definition_day_id,
    programName: row.program_name,
    dayName: row.day_name,
    currentWeek: row.week_number,
    currentDay: row.day_number ?? undefined,
    scheduledDate: row.scheduled_date ?? undefined,
  }));
}

function getScheduledEvents(userId: number, monthStart: Date, monthEnd: Date): CalendarEvent[] {
  return getOccurrences(userId, toLocalDateKey(monthStart), toLocalDateKey(monthEnd)).map(row => {
    const kind = row.status === "completed" || row.status === "skipped" ? row.status : "scheduled";
    return {
      key: `occurrence-${row.id}`, occurrenceId: row.id, date: kind === "completed" ? (row.performed_date ?? row.scheduled_date) : row.scheduled_date, kind,
      title: `${kind === "completed" ? "Completed" : kind === "skipped" ? "Skipped" : "Scheduled"}: ${row.program_name} - ${row.day_name}`,
      href: `/calendar?month=${(kind === "completed" ? (row.performed_date ?? row.scheduled_date) : row.scheduled_date).slice(0,7)}&workout=occurrence-${row.id}`, sessionId: row.session_id ?? undefined,
      programId: row.program_id, dayId: row.legacy_day_id ?? row.definition_day_id,
      definitionDayId: row.definition_day_id, programName: row.program_name, dayName: row.day_name,
      currentWeek: row.week_number, currentDay: row.day_number, scheduledDate: row.scheduled_date,
      status: row.status, revision: row.revision,
      summary: occurrenceLiftPreview(row).slice(0, 3).map(lift => `${lift.name} ${formatLiftDetail(lift)}`).join(" · "),
    };
  });
}

function eventDotClasses(kind: CalendarEvent["kind"]): string {
  if (kind === "scheduled" || kind === "in_progress") return "bg-brand";
  if (kind === "skipped") return "bg-muted";
  return "bg-success";
}

function eventKindLabel(kind: CalendarEvent["kind"]): string {
  if (kind === "in_progress") return "Active";
  if (kind === "completed") return "Done";
  if (kind === "skipped") return "Skip";
  return "Due";
}

function summarizeDayEvents(events: readonly CalendarEvent[]): CalendarDayEventSummary[] {
  const summaries = new Map<CalendarEvent["kind"], number>();
  for (const event of events) {
    summaries.set(event.kind, (summaries.get(event.kind) ?? 0) + 1);
  }

  return [...summaries.entries()].map(([kind, count]) => ({
    kind,
    count,
    label: `${count} ${eventKindLabel(kind)}`,
  }));
}

function modalEyebrow(kind: CalendarEvent["kind"]): string {
  if (kind === "in_progress") return "Workout in progress";
  if (kind === "completed") return "Completed workout";
  if (kind === "skipped") return "Skipped workout";
  return "Run from calendar";
}

function modalDateLine(event: CalendarEvent): string {
  if (event.kind === "in_progress") return `Started on ${event.date} · ${event.dayName}`;
  if (event.kind === "scheduled") return `Originally scheduled ${event.scheduledDate} · ${event.dayName}`;
  if (event.kind === "completed") return `Completed on ${event.date} · ${event.dayName}`;
  return `Skipped on ${event.date} · ${event.dayName}`;
}

function actionLabel(kind: CalendarEvent["kind"]): string {
  if (kind === "completed") return "Repeat workout";
  return "Do workout";
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  let user;

  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const params = await searchParams;
  const view = params?.view === "month" ? "month" : "week";
  const viewSuffix = view === "month" ? "&view=month" : "";
  const today = parseDateKey(userDateKey(user.id))!;
  const rawDate = Array.isArray(params?.date) ? params.date[0] : params?.date;
  const queryDate = rawDate ? parseDateKey(rawDate) : null;
  const monthStart = parseMonth(params?.month, queryDate ?? today);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const monthDays = buildMonthDays(monthStart);
  const rounding = getSettingNumber(user.id, "rounding", 2.5);
  // Ensure legacy sessions are linked before selecting standalone history.
  const scheduledEvents = getScheduledEvents(user.id, monthStart, monthEnd);
  const historyEvents = getHistoryEvents(user.id, monthStart, monthEnd);
  const events = [...historyEvents, ...scheduledEvents].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  const selectedWorkout = Array.isArray(params?.workout) ? params.workout[0] : (params?.workout ?? params?.train);
  const selectedEvent = events.find((event) => event.key === selectedWorkout);
  const sessionRecap =
    selectedEvent && (selectedEvent.kind === "completed" || selectedEvent.kind === "skipped") && selectedEvent.sessionId
      ? getSessionRecap(user.id, selectedEvent.sessionId)
      : null;
  // What's in the workout, so you can see it before choosing "Do workout".
  const selectedOccurrence = selectedEvent?.occurrenceId ? getOccurrence(user.id, selectedEvent.occurrenceId) : undefined;
  const selectedLifts = selectedOccurrence ? occurrenceLiftPreview(selectedOccurrence) :
    selectedEvent?.programId && selectedEvent.definitionDayId && selectedEvent.currentWeek
      ? getProgramDayLiftPreview(
          user.id,
          selectedEvent.programId,
          selectedEvent.definitionDayId,
          selectedEvent.currentWeek,
        )
      : [];
  const eventsByDate = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    eventsByDate.set(event.date, [...(eventsByDate.get(event.date) ?? []), event]);
  }
  const leadingBlanks = monthStart.getDay();
  const todayKey = toLocalDateKey(today);
  const selectedDate = queryDate ?? (selectedEvent ? parseDateKey(selectedEvent.date)! : (today.getMonth() === monthStart.getMonth() && today.getFullYear() === monthStart.getFullYear() ? today : monthStart));
  const selectedHref = `${monthHref(monthStart)}&date=${toLocalDateKey(selectedDate)}`;
  const returnTo = `${selectedHref}${viewSuffix}`;
  const weekStart = new Date(selectedDate);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekScheduled = getScheduledEvents(user.id, weekStart, weekEnd);
  const weekEvents = [...weekScheduled, ...getHistoryEvents(user.id, weekStart, weekEnd)].sort((a,b) => a.date.localeCompare(b.date));
  const visibleEvents = view === "week" ? weekEvents : events;


  return (
    <div className="safe-x flex flex-col gap-4 py-5">
      <CalendarNavigation returnTo={returnTo} />
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="display text-3xl">{view === "week" ? "Week" : MONTH_FORMATTER.format(monthStart)}</h1>
        <nav aria-label="Calendar view" className="inline-flex shrink-0 rounded-xl border border-line bg-surface p-1">
          <Link prefetch={false} href={selectedHref} scroll={false} aria-current={view === "week" ? "page" : undefined} className={`touch-target inline-flex items-center justify-center rounded-lg px-4 text-sm font-semibold ${view === "week" ? "bg-brand-soft text-brand-strong" : "text-muted"}`}>Week</Link>
          <Link prefetch={false} href={`${selectedHref}&view=month`} scroll={false} aria-current={view === "month" ? "page" : undefined} className={`touch-target inline-flex items-center justify-center rounded-lg px-4 text-sm font-semibold ${view === "month" ? "bg-brand-soft text-brand-strong" : "text-muted"}`}>Month</Link>
        </nav>
      </header>
      <section aria-label="Week calendar" hidden={view !== "week"}>
        <CalendarAgenda compact returnTo={returnTo} key={toLocalDateKey(weekStart)} events={weekEvents} weekStart={toLocalDateKey(weekStart)} today={todayKey} undoOperation={latestCalendarOperation(user.id)} />
      </section>

      <section aria-label="Month calendar" hidden={view !== "month"} className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
        <p className="border-b border-line px-3 py-2 text-sm text-muted">Open a workout dot, or tap a date to see its week.</p>
        <div className="grid grid-cols-7 border-b border-line bg-surface-muted">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="px-2 py-2 text-center text-xs font-semibold text-muted">
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: leadingBlanks }, (_, index) => (
            <div key={`blank-${index}`} className="min-h-24 border-b border-r border-line bg-surface-muted" />
          ))}
          {monthDays.map((date) => {
            const dateKey = toLocalDateKey(date);
            const dayEvents = eventsByDate.get(dateKey) ?? [];
            const summaries = summarizeDayEvents(dayEvents);
            const isToday = dateKey === todayKey;

            return (
              <div
                key={dateKey}
                className={`min-h-24 min-w-0 border-b border-r border-line ${isToday ? "bg-brand-soft" : ""}`}
              >
                <Link prefetch={false}
                  href={`${monthHref(monthStart)}&date=${dateKey}`}
                  scroll={false}
                  aria-label={`See week containing ${dateKey}`}
                  className={`touch-target flex w-full items-center justify-center text-sm font-display font-semibold ${
                    isToday ? "rounded-full bg-brand text-white" : "text-muted"
                  }`}
                >
                  {date.getDate()}
                </Link>
                <div className="flex flex-wrap justify-center gap-0" aria-label={`${dateKey} workouts`}>
                  {dayEvents.map((event) => (
                    <Link prefetch={false}
                      key={event.key}
                      href={`${calendarHref(monthStart, event.key)}${viewSuffix}`}
                      scroll={false}
                      title={event.title}
                      aria-label={`${event.title} on ${event.date}`}
                      className="touch-target inline-flex items-center justify-center rounded-full border border-transparent hover:border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${eventDotClasses(event.kind)}`} />
                    </Link>
                  ))}
                  {dayEvents.length === 0 ? null : (
                    <span className="sr-only">{summaries.map((summary) => summary.label).join(", ")}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="flex items-center gap-4 px-1">
        {[
          { label: "Done", cls: "bg-success" },
          { label: "Due", cls: "bg-brand" },
          { label: "Skipped", cls: "bg-muted" },
        ].map((item) => (
          <span key={item.label} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
            <span className={`h-2.5 w-2.5 rounded-full ${item.cls}`} aria-hidden="true" />
            {item.label}
          </span>
        ))}
      </div>

      {selectedEvent ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/35 px-3 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:items-center sm:py-3">
          <div role="dialog" aria-modal="true" aria-labelledby="calendar-workout-title" className="max-h-full w-full max-w-xl overflow-y-auto rounded-xl bg-surface shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <p className="eyebrow text-[11px] text-brand-strong">{modalEyebrow(selectedEvent.kind)}</p>
                <h2 id="calendar-workout-title" className="display mt-1 text-2xl">{selectedEvent.programName}</h2>
                <p className="mt-0.5 text-sm text-muted">{modalDateLine(selectedEvent)}</p>
              </div>
              <Link prefetch={false}
                href={returnTo}
                scroll={false}
                aria-label="Close workout"
                className="touch-target inline-flex shrink-0 items-center justify-center rounded-xl border border-line px-3 text-sm font-medium text-muted"
              >
                Close
              </Link>
            </div>
            {sessionRecap ? (
              <div className="px-4 pt-3">
                <SessionRecapView recap={sessionRecap} />
              </div>
            ) : null}
            {selectedEvent.sessionId && selectedEvent.kind === "in_progress" ? <Link prefetch={false} href={withCalendarReturn(`/workouts/${selectedEvent.sessionId}`, returnTo)} className="touch-target m-4 inline-flex items-center justify-center rounded-xl bg-brand px-4 py-3 font-semibold text-white">Resume workout</Link> : selectedEvent.sessionId && selectedEvent.kind !== "scheduled" ? (
              <section className="px-4 pb-4">
                <h3 className="display text-xl">Use this workout again</h3>
                <p className="my-3 text-sm text-muted">Repeat the saved sets as a separate workout. The original program and its progression stay unchanged.</p>
                <WorkoutReuse sessionId={selectedEvent.sessionId} name={[selectedEvent.programName,selectedEvent.dayName].filter(Boolean).join(" · ")} today={todayKey} returnTo={returnTo}/>
                <Link prefetch={false} href={withCalendarReturn(`/workouts/${selectedEvent.sessionId}`, returnTo)} className="touch-target mt-3 inline-flex items-center text-sm font-semibold text-brand-strong">View history and corrections</Link>
              </section>
            ) : selectedEvent.programId && selectedEvent.dayId && selectedEvent.currentWeek && selectedEvent.currentDay ? (
              <WorkoutCard
                occurrenceId={selectedEvent.kind === "scheduled" ? selectedEvent.occurrenceId : undefined}
                programId={selectedEvent.programId}
                dayId={selectedEvent.dayId}
                definitionDayId={selectedEvent.definitionDayId ?? undefined}
                programName={selectedEvent.programName ?? "Workout"}
                dayName={selectedEvent.dayName ?? "Workout"}
                currentWeek={selectedEvent.currentWeek}
                currentDay={selectedEvent.currentDay}
                scheduledDate={selectedEvent.kind === "scheduled" ? selectedEvent.scheduledDate : undefined}
                startLabel={actionLabel(selectedEvent.kind)}
                showSkip={selectedEvent.kind !== "completed"}
                rounding={rounding}
                liftsLabel="In this workout"
                nextLifts={
                  sessionRecap ? undefined : selectedLifts.map((lift) => ({ name: lift.name, detail: formatLiftDetail(lift) }))
                }
              />
            ) : (
              <div className="px-4 pb-4">
                <Link prefetch={false}
                  href={withCalendarReturn(selectedEvent.sessionId ? `/workouts/${selectedEvent.sessionId}` : "/workouts", returnTo)}
                  className="touch-target inline-flex w-full items-center justify-center rounded-xl bg-foreground px-4 text-sm font-medium text-background"
                >
                  View history
                </Link>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {visibleEvents.length === 0 ? (
        <section className="rounded-xl border border-line bg-surface p-4 text-sm leading-6 text-muted shadow-sm">
          No workouts scheduled for this {view}.
        </section>
      ) : null}
    </div>
  );
}
