import Link from "next/link";
import { redirect } from "next/navigation";
import { WorkoutCard } from "@/components/WorkoutCard";
import {
  getActiveProgramDaysForUser,
  getProgramRunHoldsForRange,
  isDateHeldForRun,
  type ProgramDaySummary,
} from "@/features/programs/program-service";
import { getSettingNumber, requireUser } from "@/lib/auth";
import { parseDateKey, toLocalDateKey } from "@/lib/date-key";
import { db } from "@/lib/db";

type CalendarPageProps = {
  searchParams?: Promise<{ month?: string | string[]; train?: string | string[]; workout?: string | string[] }>;
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
  status: "completed" | "skipped";
  program_name: string;
  day_name: string;
};

type CalendarEvent = {
  key: string;
  date: string;
  kind: "completed" | "skipped" | "scheduled";
  title: string;
  href: string;
  programId?: number | null;
  dayId?: number | null;
  definitionDayId?: number | null;
  programName?: string;
  dayName?: string;
  currentWeek?: number;
  currentDay?: number;
  scheduledDate?: string;
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

function addMonths(monthStart: Date, amount: number): Date {
  return new Date(monthStart.getFullYear(), monthStart.getMonth() + amount, 1);
}

function monthHref(monthStart: Date): string {
  const month = String(monthStart.getMonth() + 1).padStart(2, "0");
  return `/calendar?month=${monthStart.getFullYear()}-${month}`;
}

function calendarHref(monthStart: Date, train?: string): string {
  const base = monthHref(monthStart);
  return train ? `${base}&workout=${encodeURIComponent(train)}` : base;
}

function parseScheduleWeekdays(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6);
  } catch {
    return [];
  }
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
          AND s.status IN ('completed', 'skipped')
          AND s.date BETWEEN ? AND ?
        ORDER BY s.date, s.id
      `,
    )
    .all(userId, toLocalDateKey(monthStart), toLocalDateKey(monthEnd)) as HistoryRow[];

  return rows.map((row) => ({
    key: `history-${row.id}`,
    date: row.date,
    kind: row.status,
    title: `${row.status === "completed" ? "Completed" : "Skipped"}: ${row.program_name} - ${row.day_name}`,
    href: "/history",
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

function getScheduledEvents({
  userId,
  monthStart,
  monthEnd,
  loggedWorkoutKeys,
}: {
  userId: number;
  monthStart: Date;
  monthEnd: Date;
  loggedWorkoutKeys: ReadonlySet<string>;
}): CalendarEvent[] {
  const rows = getActiveProgramDaysForUser(userId, { scheduledOnly: true });
  const projectionStarts = rows
    .map((row) => parseDateKey(row.schedule_start_date))
    .filter((date): date is Date => date !== null);
  const holdRangeStart =
    projectionStarts.length > 0
      ? toLocalDateKey(projectionStarts.reduce((earliest, date) => (date < earliest ? date : earliest)))
      : toLocalDateKey(monthStart);
  const holdRangeEnd = toLocalDateKey(monthEnd);
  const programRunIds = [...new Set(rows.map((row) => row.program_run_id).filter((id): id is number => id !== null))];
  const holds =
    holdRangeStart <= holdRangeEnd
      ? getProgramRunHoldsForRange({
          userId,
          startDate: holdRangeStart,
          endDate: holdRangeEnd,
          programRunIds,
        })
      : [];

  const rowsByProgram = new Map<number, ProgramDaySummary[]>();
  for (const row of rows) {
    rowsByProgram.set(row.program_id, [...(rowsByProgram.get(row.program_id) ?? []), row]);
  }

  const events: CalendarEvent[] = [];
  const firstProjectionDate = monthStart;

  for (const programRows of rowsByProgram.values()) {
    const sortedProgramRows = programRows.toSorted((a, b) => a.day_number - b.day_number);
    const firstRow = sortedProgramRows[0];
    const scheduleWeekdays = parseScheduleWeekdays(firstRow.schedule_weekdays);
    if (scheduleWeekdays.length === 0) continue;

    let slotIndex = 0;
    const totalSlots = firstRow.num_weeks * sortedProgramRows.length;
    const projectionStart = parseDateKey(firstRow.schedule_start_date);
    if (!projectionStart || totalSlots <= 0) continue;

    for (const date of buildDateRange(projectionStart, monthEnd)) {
      if (slotIndex >= totalSlots) break;
      if (!scheduleWeekdays.includes(date.getDay())) continue;

      const dateKey = toLocalDateKey(date);
      if (isDateHeldForRun(holds, firstRow.program_run_id, dateKey)) continue;

      const day = sortedProgramRows[slotIndex % sortedProgramRows.length];
      const projectedWeek = Math.floor(slotIndex / sortedProgramRows.length) + 1;
      slotIndex += 1;
      if (date < firstProjectionDate) continue;
      if (loggedWorkoutKeys.has(workoutKey(dateKey, day.program_id, day.day_id))) continue;

      const eventKey = `scheduled-${day.program_id}-${day.day_id}-${dateKey}`;

      events.push({
        key: eventKey,
        date: dateKey,
        kind: "scheduled",
        title: `Scheduled: ${day.program_name} - ${day.day_name}`,
        href: calendarHref(monthStart, eventKey),
        programId: day.program_id,
        dayId: day.day_id,
        definitionDayId: day.definition_day_id,
        programName: day.program_name,
        dayName: day.day_name,
        currentWeek: projectedWeek,
        currentDay: day.day_number,
        scheduledDate: dateKey,
      });
    }
  }

  return events;
}

function workoutKey(date: string, programId: number | null | undefined, dayId: number | null | undefined): string {
  return `${date}:${programId ?? ""}:${dayId ?? ""}`;
}

function buildDateRange(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function eventDotClasses(kind: CalendarEvent["kind"]): string {
  if (kind === "scheduled") return "bg-brand";
  if (kind === "skipped") return "bg-muted";
  return "bg-success";
}

function eventKindLabel(kind: CalendarEvent["kind"]): string {
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
  if (kind === "completed") return "Completed workout";
  if (kind === "skipped") return "Skipped workout";
  return "Run from calendar";
}

function modalDateLine(event: CalendarEvent): string {
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
  const today = new Date();
  const monthStart = parseMonth(params?.month, today);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const monthDays = buildMonthDays(monthStart);
  const rounding = getSettingNumber(user.id, "rounding", 2.5);
  const historyEvents = getHistoryEvents(user.id, monthStart, monthEnd);
  const loggedWorkoutKeys = new Set(
    historyEvents.map((event) => workoutKey(event.scheduledDate ?? event.date, event.programId, event.dayId)),
  );
  const events = [
    ...historyEvents,
    ...getScheduledEvents({ userId: user.id, monthStart, monthEnd, loggedWorkoutKeys }),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  const selectedWorkout = Array.isArray(params?.workout) ? params.workout[0] : (params?.workout ?? params?.train);
  const selectedEvent = events.find((event) => event.key === selectedWorkout);
  const eventsByDate = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    eventsByDate.set(event.date, [...(eventsByDate.get(event.date) ?? []), event]);
  }
  const hasEvents = events.length > 0;
  const leadingBlanks = monthStart.getDay();
  const todayKey = toLocalDateKey(today);

  return (
    <div className="safe-x flex flex-col gap-4 py-5">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow text-[11px] text-faint">Training calendar</p>
          <h1 className="display text-4xl">{MONTH_FORMATTER.format(monthStart)}</h1>
        </div>
        <div className="flex gap-2">
          <Link
            href={monthHref(addMonths(monthStart, -1))}
            aria-label="Previous month"
            className="touch-target inline-flex items-center justify-center rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-muted transition-colors active:bg-surface-muted"
          >
            Prev
          </Link>
          <Link
            href={monthHref(addMonths(monthStart, 1))}
            aria-label="Next month"
            className="touch-target inline-flex items-center justify-center rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-muted transition-colors active:bg-surface-muted"
          >
            Next
          </Link>
        </div>
      </header>

      <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
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
                className={`min-h-24 border-b border-r border-line p-1.5 ${isToday ? "bg-brand-soft" : ""}`}
              >
                <div
                  className={`flex h-6 w-6 items-center justify-center text-xs font-display font-semibold ${
                    isToday ? "rounded-full bg-brand text-white" : "text-muted"
                  }`}
                >
                  {date.getDate()}
                </div>
                <div className="mt-2 flex flex-wrap gap-1" aria-label={`${dateKey} workouts`}>
                  {dayEvents.map((event) => (
                    <Link
                      key={event.key}
                      href={calendarHref(monthStart, event.key)}
                      title={event.title}
                      aria-label={`${event.title} on ${event.date}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent hover:border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
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
              <Link
                href={monthHref(monthStart)}
                aria-label="Close workout"
                className="touch-target inline-flex shrink-0 items-center justify-center rounded-xl border border-line px-3 text-sm font-medium text-muted"
              >
                Close
              </Link>
            </div>
            {selectedEvent.programId && selectedEvent.dayId && selectedEvent.currentWeek && selectedEvent.currentDay ? (
              <WorkoutCard
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
              />
            ) : (
              <div className="px-4 pb-4">
                <Link
                  href="/history"
                  className="touch-target inline-flex w-full items-center justify-center rounded-xl bg-foreground px-4 text-sm font-medium text-background"
                >
                  View history
                </Link>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {!hasEvents ? (
        <section className="rounded-xl border border-line bg-surface p-4 text-sm leading-6 text-muted shadow-sm">
          No workouts on this calendar yet.
        </section>
      ) : null}
    </div>
  );
}
