import Link from "next/link";
import { CalendarDays, ChevronRight, LineChart } from "lucide-react";
import { redirect } from "next/navigation";
import { ProgramHoldDialog } from "@/components/ProgramHoldForm";
import { QuickWorkout } from "@/components/QuickWorkout";
import { WorkoutCard } from "@/components/WorkoutCard";
import { buildSummaryRows, formatTonnage, summaryDetail } from "@/components/workout-card-utils";
import { getWorkout } from "@/features/workouts/history-service";
import type { EditorCompletionDecision } from "@/features/program-editor/execution";
import { db } from "@/lib/db";
import {
  getProgramLibrary,
  getQuickWorkoutForToday,
  getTodayWorkoutDashboard,
  type TodayLiftPreview,
  type TodayWorkoutSummary,
} from "@/features/programs/program-service";
import { getSettingNumber, requireUser } from "@/lib/auth";
import { userDateKey } from "@/lib/user-date";

function formatLift(lift: TodayLiftPreview): string {
  if (lift.detail) return lift.detail;
  if (lift.bodyweight) return `${lift.set_count}×${lift.reps} BW`;
  return `${lift.set_count}×${lift.reps} @ ${lift.weight} lb`;
}

function finishedMessage(status: TodayWorkoutSummary["today_session_status"]): string {
  if (status === "skipped") return "Workout skipped today";
  return "Workout complete today";
}

function statusLineFor(row: TodayWorkoutSummary): string {
  if (row.scheduled_date) return `Originally scheduled ${row.scheduled_date}`;
  if (row.last_session_date) return `Last logged ${row.last_session_date}`;
  return "No sessions logged yet";
}

function renderWorkout(row: TodayWorkoutSummary, label: string, rounding: number, userId: number) {
  const key = row.occurrence_id ? `occurrence-${row.occurrence_id}` : `${row.program_id}-${row.definition_day_id}-${row.scheduled_date ?? label}`;

  if (row.today_session_status) {
    const completed = row.today_session_status === "completed" && row.today_session_id ? getWorkout(userId, row.today_session_id) : null;
    const summary = completed ? buildSummaryRows(completed.sets, new Set(completed.sets.filter(set => set.actual_reps !== null).map(set => set.id)), {}, {}, {}, completed.unit) : [];
    const event = completed ? db.prepare("SELECT e.decision_json FROM program_editor_progression_events e JOIN sessions s ON s.id=e.session_id WHERE e.session_id=? AND s.user_id=?").get(completed.id, userId) as { decision_json: string } | undefined : undefined;
    const decisions: EditorCompletionDecision[] = event ? JSON.parse(event.decision_json) : [];
    return (
      <section key={key} className="card px-4 py-6 text-center">
        <p className="display text-xl text-success-ink">{finishedMessage(row.today_session_status)}</p>
        <p className="mt-1 text-sm text-muted">{row.day_name} is logged for today.</p>
        {completed && <div className="mt-4 text-left">
          {summary.length ? <ul className="flex flex-col gap-2">{summary.map(lift => <li key={lift.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-muted px-3.5 py-2.5 text-sm"><span className="font-semibold">{lift.exerciseName}</span><span className="text-right text-muted">{summaryDetail(lift)}<span className="block font-display text-xs tracking-tight">{formatTonnage(lift.tonnage)} {lift.unit} total</span></span></li>)}</ul> : <p className="text-sm text-muted">No sets were logged.</p>}
          {decisions.length > 0 && <div className="mt-4 rounded-xl border border-line bg-surface-muted p-3.5"><p className="eyebrow text-xs text-brand-strong">Progression</p>{decisions.map(decision => <div key={decision.progressionKey} className="mt-3 text-sm"><p className="font-semibold">{decision.exerciseName}</p><p className="mt-1 text-muted">{decision.result.explanation}</p></div>)}</div>}
        </div>}
        <Link
          href={`/workouts/${row.today_session_id}`}
          className="touch-target mt-4 inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-foreground transition-colors active:bg-surface-muted"
        >
          <LineChart aria-hidden="true" size={16} />
          Workout details
        </Link>
      </section>
    );
  }

  return (
    <WorkoutCard
      key={key}
      occurrenceId={row.occurrence_id}
      scheduledDate={row.scheduled_date}
      programId={row.program_id}
      dayId={row.day_id}
      definitionDayId={row.definition_day_id}
      programName={row.program_name}
      dayName={row.day_name}
      currentWeek={row.current_week}
      currentDay={row.day_number}
      eyebrow={label}
      rounding={rounding}
      scheduleLabel={row.schedule_label}
      statusLine={statusLineFor(row)}
      nextLifts={row.next_lifts.map((lift) => ({ name: lift.name, detail: formatLift(lift) }))}
      holdSlot={
        <ProgramHoldDialog
          programId={row.program_id}
          programName={row.program_name}
          activeHold={null}
          triggerLabel="Pause run"
          triggerClassName="inline-flex items-center font-semibold text-brand-strong"
        />
      }
    />
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
  const rounding = getSettingNumber(user.id, "rounding", 2.5);
  const todayKey = userDateKey(user.id);
  const heldRuns = getProgramLibrary(user.id).activeRuns.filter(
    (run) =>
      run.active_hold_id &&
      run.active_hold_start_date &&
      run.active_hold_end_date &&
      run.active_hold_start_date <= todayKey &&
      run.active_hold_end_date >= todayKey,
  );
  const quickWorkout = getQuickWorkoutForToday(user.id);
  const hasWorkouts =
    dashboard.activeWorkouts.length > 0 || dashboard.missedWorkouts.length > 0 || dashboard.scheduledToday.length > 0 || dashboard.otherActiveRuns.length > 0;

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

      <Link href="/workouts" className="touch-target inline-flex items-center self-end text-sm font-semibold text-brand-strong">Workout history</Link>
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
                href="/workouts"
                className="touch-target inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-foreground transition-colors active:bg-surface-muted"
              >
                <LineChart aria-hidden="true" size={16} />
                History
              </Link>
            </div>
          </section>
          <QuickWorkout initialSession={quickWorkout} />
        </>
      ) : (
        <>
          {dashboard.activeWorkouts.map((row) => renderWorkout(row, "Resume workout", rounding, user.id))}
          {dashboard.scheduledToday.map((row) => renderWorkout(row, "Scheduled today", rounding, user.id))}
          {dashboard.missedWorkouts.length > 0 ? <section className="flex flex-col gap-3"><h2 className="eyebrow text-xs text-muted">To reschedule or train</h2>{dashboard.missedWorkouts.map(row => renderWorkout(row, "Pending workout", rounding, user.id))}</section> : null}
          {dashboard.otherActiveRuns.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="eyebrow text-xs text-faint">Other active runs</h2>
              {dashboard.otherActiveRuns.map((row) => renderWorkout(row, "Unscheduled run", rounding, user.id))}
            </section>
          ) : null}
          <QuickWorkout initialSession={quickWorkout} />
        </>
      )}
      </div>
    </div>
  );
}
