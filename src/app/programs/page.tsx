import Link from "next/link";
import { Activity, CalendarDays, Copy, Dumbbell, Library, Plus, Share2 } from "lucide-react";
import { redirect } from "next/navigation";
import { DeleteButton } from "@/components/DeleteButton";
import { ProgramActiveToggle } from "@/components/ProgramActiveToggle";
import { ProgramRunManageDialog } from "@/components/ProgramRunManageDialog";
import { TrainingMaxesModal } from "@/components/TrainingMaxesModal";
import {
  getLatestTrainingMaxes,
  getProgramLibrary,
  type ProgramLibraryItem,
} from "@/features/programs/program-service";
import { requireUser } from "@/lib/auth";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseScheduleWeekdays(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6);
  } catch {
    return [];
  }
}

function scheduleText(program: ProgramLibraryItem): string {
  if (program.schedule_mode !== "scheduled") return "Unscheduled";
  const labels = parseScheduleWeekdays(program.schedule_weekdays).map((day) => WEEKDAY_LABELS[day]);
  return labels.length > 0 ? labels.join(" · ") : "Unscheduled";
}

function sourceLabel(program: ProgramLibraryItem): string {
  if (program.source_type === "shared") return "Shared";
  if (program.source_type === "default") return "Default";
  return "Custom";
}

function renderRunCard(program: ProgramLibraryItem) {
  return (
    <article key={program.id} className="card overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow text-[11px] text-brand-strong">Active run</p>
            <h3 className="display mt-1 truncate text-2xl">{program.name}</h3>
            <p className="mt-1 text-sm text-muted">
              Week {program.current_week} · Day {program.current_day} · {program.day_count} day
              {program.day_count === 1 ? "" : "s"}
            </p>
          </div>
          <Link
            href="/today"
            className="touch-target inline-flex items-center justify-center rounded-xl bg-brand px-4 text-sm font-semibold text-white transition-colors active:bg-brand-strong"
          >
            Today
          </Link>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-surface-muted px-3 py-2 text-sm text-muted">
          <CalendarDays aria-hidden="true" size={16} className="text-faint" />
          <span className="font-medium">{scheduleText(program)}</span>
        </div>
        {program.active_hold_id ? (
          <div className="mt-2 rounded-xl border border-warn-line bg-warn-soft px-3 py-2 text-xs leading-5 text-warn-ink">
            Held {program.active_hold_start_date} to {program.active_hold_end_date}
          </div>
        ) : null}
        {program.last_session ? (
          <p className="mt-2 text-xs font-medium text-faint">Last logged {program.last_session}</p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 border-t border-line text-sm font-semibold text-muted">
        <ProgramRunManageDialog
          programId={program.id}
          name={program.name}
          currentWeek={program.current_week}
          currentDay={program.current_day}
          dayCount={program.day_count}
          liftCount={program.lift_count}
          scheduleLabel={scheduleText(program)}
          lastSession={program.last_session}
          isActive={!!program.is_active}
          activeHold={
            program.active_hold_id
              ? {
                  id: program.active_hold_id,
                  startDate: program.active_hold_start_date ?? "",
                  endDate: program.active_hold_end_date ?? "",
                  reason: program.active_hold_reason ?? "",
                }
              : null
          }
        />
        <div className="flex items-center justify-center border-l border-line">
          <ProgramActiveToggle programId={program.id} isActive={!!program.is_active} variant="badge" />
        </div>
      </div>
    </article>
  );
}

function renderDefinitionCard(program: ProgramLibraryItem) {
  return (
    <article key={program.id} className="card overflow-hidden">
      <Link href={`/programs/${program.id}`} className="block p-4 transition-colors active:bg-surface-muted">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="display truncate text-xl">{program.name}</h3>
            <p className="mt-1 text-sm text-muted">
              {program.num_weeks} weeks · {program.day_count} days · {program.lift_count} lifts
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-muted">
            {sourceLabel(program)}
          </span>
        </div>
      </Link>
      <div className="grid grid-cols-3 border-t border-line text-xs font-semibold text-muted">
        <Link
          href={`/programs/${program.id}`}
          className="touch-target inline-flex items-center justify-center gap-1.5 transition-colors active:bg-surface-muted"
        >
          <Dumbbell aria-hidden="true" size={14} className="text-brand-strong" />
          Edit
        </Link>
        <button
          type="button"
          disabled
          className="touch-target inline-flex items-center justify-center gap-1.5 border-x border-line opacity-45"
        >
          <Copy aria-hidden="true" size={14} />
          Duplicate
        </button>
        <button
          type="button"
          disabled
          className="touch-target inline-flex items-center justify-center gap-1.5 opacity-45"
        >
          <Share2 aria-hidden="true" size={14} />
          Share
        </button>
      </div>
    </article>
  );
}

export default async function ProgramsPage() {
  let user;

  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const library = getProgramLibrary(user.id);
  const latestMaxes = getLatestTrainingMaxes(user.id);

  return (
    <div className="safe-x flex flex-1 flex-col gap-5 py-5">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-faint">{user.email}</p>
          <h1 className="display text-4xl">Programs</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <TrainingMaxesModal maxes={latestMaxes} />
          <Link
            href="/programs/new"
            className="touch-target inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-sm font-semibold text-white transition-colors active:bg-brand-strong"
          >
            <Plus aria-hidden="true" size={16} />
            New
          </Link>
        </div>
      </header>

      {library.definitions.length === 0 ? (
        <section className="flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 text-center">
          <Library aria-hidden="true" className="text-brand/40" size={34} />
          <h2 className="display mt-3 text-2xl">No programs yet</h2>
          <p className="mt-2 max-w-xs text-sm leading-6 text-muted">
            Create a program, add training days, then schedule it for Today.
          </p>
        </section>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="eyebrow text-xs text-faint">Active Runs</h2>
              <Activity aria-hidden="true" className="text-brand-strong" size={18} />
            </div>
            {library.activeRuns.length > 0 ? (
              library.activeRuns.map(renderRunCard)
            ) : (
              <div className="card p-4 text-sm text-muted">
                Start a run from your library when you are ready to train it.
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="eyebrow text-xs text-faint">Program Library</h2>
              <span className="font-display text-sm font-semibold text-faint">
                {library.definitions.length}
              </span>
            </div>
            {library.definitions.map((program) => (
              <div key={program.id} className="flex flex-col gap-2">
                {renderDefinitionCard(program)}
                <div className="flex justify-end">
                  <DeleteButton endpoint={`/api/programs/${program.id}`} label="program" />
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
