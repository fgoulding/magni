import Link from "next/link";
import { CalendarDays, ChevronRight, Dumbbell, LineChart } from "lucide-react";
import { redirect } from "next/navigation";
import { ProgramHoldDialog } from "@/components/ProgramHoldForm";
import { WorkoutCard } from "@/components/WorkoutCard";
import {
  getProgramLibrary,
  getTodayWorkoutDashboard,
  type TodayLiftPreview,
  type TodayWorkoutSummary,
} from "@/features/programs/program-service";
import { requireUser } from "@/lib/auth";
import { toLocalDateKey } from "@/lib/date-key";

function formatLift(lift: TodayLiftPreview): string {
  return `${lift.set_count}×${lift.reps} @ ${lift.weight} lb`;
}

function finishedMessage(status: TodayWorkoutSummary["today_session_status"]): string {
  if (status === "skipped") return "Workout skipped today";
  return "Workout complete today";
}

function renderWorkout(row: TodayWorkoutSummary, label: string) {
  return (
    <section
      key={`${row.program_id}-${row.definition_day_id}-${row.scheduled_date ?? label}`}
      className="flex flex-col gap-3"
    >
      <div className="card overflow-hidden">
        <div className="h-1 bg-brand" aria-hidden="true" />
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow text-[11px] text-brand-strong">{label}</p>
              <h2 className="display mt-1.5 truncate text-3xl">{row.program_name}</h2>
              <p className="mt-1 text-sm text-muted">
                Week {row.current_week} · Day {row.day_number} · {row.day_name}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-muted">
              {row.schedule_label}
            </span>
          </div>

          {row.next_lifts.length > 0 ? (
            <div className="mt-4 rounded-xl bg-surface-muted p-3.5">
              <div className="eyebrow mb-2.5 flex items-center gap-1.5 text-[11px] text-brand-strong">
                <Dumbbell aria-hidden="true" size={13} />
                Next lift
              </div>
              <div className="flex flex-col gap-2.5">
                {row.next_lifts.map((lift) => (
                  <div key={lift.name} className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold">{lift.name}</span>
                    <span className="font-display text-base tracking-tight text-muted">
                      {formatLift(lift)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-3.5 flex items-center justify-between text-xs text-faint">
            <span>
              {row.scheduled_date
                ? `Originally scheduled ${row.scheduled_date}`
                : row.last_session_date
                  ? `Last logged ${row.last_session_date}`
                  : "No sessions logged yet"}
            </span>
            <ProgramHoldDialog
              programId={row.program_id}
              programName={row.program_name}
              activeHold={null}
              triggerLabel="Pause run"
              triggerClassName="inline-flex items-center font-semibold text-brand-strong"
            />
          </div>
        </div>
      </div>

      {row.today_session_status ? (
        <section className="card px-4 py-6 text-center">
          <p className="display text-xl text-success-ink">{finishedMessage(row.today_session_status)}</p>
          <p className="mt-1 text-sm text-muted">{row.day_name} is logged for today.</p>
          <Link
            href="/history"
            className="touch-target mt-4 inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-foreground transition-colors active:bg-surface-muted"
          >
            <LineChart aria-hidden="true" size={16} />
            Stats
          </Link>
        </section>
      ) : (
        <WorkoutCard
          programId={row.program_id}
          dayId={row.day_id}
          definitionDayId={row.definition_day_id}
          programName={row.program_name}
          dayName={row.day_name}
          currentWeek={row.current_week}
          currentDay={row.day_number}
        />
      )}
    </section>
  );
}

export default async function TodayPage() {
  let user;

  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const dashboard = getTodayWorkoutDashboard(user.id);
  const todayKey = toLocalDateKey(new Date());
  const heldRuns = getProgramLibrary(user.id).activeRuns.filter(
    (run) =>
      run.active_hold_id &&
      run.active_hold_start_date &&
      run.active_hold_end_date &&
      run.active_hold_start_date <= todayKey &&
      run.active_hold_end_date >= todayKey,
  );
  const hasWorkouts =
    dashboard.scheduledToday.length > 0 || dashboard.otherActiveRuns.length > 0;

  return (
    <div className="safe-x flex flex-1 flex-col gap-5 py-5">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-faint">{user.email}</p>
          <h1 className="display text-4xl">Today</h1>
        </div>
        <Link
          href="/calendar"
          aria-label="Open calendar"
          className="touch-target inline-flex items-center justify-center rounded-xl border border-line bg-surface px-3 text-muted transition-colors active:bg-surface-muted"
        >
          <CalendarDays aria-hidden="true" size={20} />
        </Link>
      </header>

      <div className="flex flex-1 flex-col justify-center gap-5">
        {!hasWorkouts ? (
        <>
          {heldRuns.length > 0 ? (
            <section className="rounded-2xl border border-warn-line bg-warn-soft p-4">
              <p className="eyebrow text-[11px] text-warn-ink">On hold</p>
              <h2 className="display mt-1.5 text-2xl text-warn-ink">{heldRuns[0].name}</h2>
              <p className="mt-1.5 text-sm leading-6 text-warn-ink/90">
                Held until {heldRuns[0].active_hold_end_date}. The next workout stays next when this run
                resumes.
              </p>
              <div className="mt-3">
                <ProgramHoldDialog
                  programId={heldRuns[0].id}
                  programName={heldRuns[0].name}
                  activeHold={{
                    id: heldRuns[0].active_hold_id!,
                    startDate: heldRuns[0].active_hold_start_date ?? "",
                    endDate: heldRuns[0].active_hold_end_date ?? "",
                    reason: heldRuns[0].active_hold_reason ?? "",
                  }}
                  triggerLabel="Manage pause"
                  triggerClassName="touch-target inline-flex items-center justify-center rounded-xl border border-warn-line bg-surface px-3 text-sm font-semibold text-warn-ink"
                />
              </div>
            </section>
          ) : null}
          <section className="card p-5">
            <h2 className="display text-2xl">No workout scheduled today</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Schedule an active run or start from an unscheduled program when training changes.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <Link
                href="/programs"
                className="touch-target inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand px-3 text-sm font-semibold text-white transition-colors active:bg-brand-strong"
              >
                Programs
                <ChevronRight aria-hidden="true" size={16} />
              </Link>
              <Link
                href="/history"
                className="touch-target inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-foreground transition-colors active:bg-surface-muted"
              >
                <LineChart aria-hidden="true" size={16} />
                Stats
              </Link>
            </div>
          </section>
        </>
      ) : (
        <>
          {dashboard.scheduledToday.map((row) => renderWorkout(row, "Scheduled today"))}
          {dashboard.otherActiveRuns.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="eyebrow text-xs text-faint">Other active runs</h2>
              {dashboard.otherActiveRuns.map((row) => renderWorkout(row, "Unscheduled run"))}
            </section>
          ) : null}
        </>
      )}
      </div>
    </div>
  );
}
