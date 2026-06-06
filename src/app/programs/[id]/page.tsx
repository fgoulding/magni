import Link from "next/link";
import { Trash2 } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { AddDayForm } from "@/components/AddDayForm";
import { AddExerciseForm } from "@/components/AddExerciseForm";
import { DaySection } from "@/components/DaySection";
import { DeleteButton } from "@/components/DeleteButton";
import { ProgramActiveToggle } from "@/components/ProgramActiveToggle";
import { ProgramScheduleForm } from "@/components/ProgramScheduleForm";
import { ReorderButton } from "@/components/ReorderButton";
import { SortableDayExercises } from "@/components/SortableDayExercises";
import { getProgramDetailForUser } from "@/features/programs/program-service";
import { requireUser } from "@/lib/auth";

type PageProps = {
  params: Promise<{ id: string }>;
};

function parseScheduleWeekdays(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6);
  } catch {
    return [];
  }
}

export default async function ProgramPage({ params }: PageProps) {
  let user;

  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const { id } = await params;
  const programId = Number(id);
  const program = getProgramDetailForUser(programId, user.id);

  if (!program) notFound();

  const daysWithExercises = program.days;

  return (
    <div className="safe-x flex flex-col gap-5 py-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow text-[11px] text-brand-strong">
            Week {program.current_week} · Day {program.current_day}
          </p>
          <h1 className="display mt-1 text-3xl">{program.name}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/programs"
            className="touch-target inline-flex items-center justify-center rounded-xl border border-line bg-surface px-3 text-sm font-semibold transition-colors active:bg-surface-muted"
          >
            Back
          </Link>
          <DeleteButton endpoint={`/api/programs/${program.id}`} label="program" redirectHref="/programs" />
        </div>
      </header>

      <details open className="card p-4">
        <summary className="display cursor-pointer list-none text-lg">
          Schedule &amp; tracking
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <div className="rounded-xl border border-line bg-surface p-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Show on Today</p>
              <p className="text-xs text-muted">
                {program.is_active ? "This program appears on your Today tab" : "Hidden from Today"}
              </p>
            </div>
            <ProgramActiveToggle programId={program.id} isActive={!!program.is_active} />
          </div>

          <ProgramScheduleForm
            programId={program.id}
            initialScheduleWeekdays={parseScheduleWeekdays(program.schedule_weekdays)}
            initialStartDate={program.schedule_start_date}
            dayCount={daysWithExercises.length}
          />
        </div>
      </details>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="display text-xl">Exercises</h2>
          <p className="mt-0.5 text-sm text-muted">Your training days, exercises, and progression.</p>
        </div>

        <AddDayForm programId={program.id} />

        <section className="card p-4">
          <h3 className="display text-lg">Training days</h3>
          {daysWithExercises.length === 0 ? (
            <p className="mt-2 text-sm leading-6 text-muted">Add a training day to start building this program.</p>
          ) : (
            <div className="mt-3 flex flex-col divide-y divide-line">
              {daysWithExercises.map((day) => (
                <div key={day.id} className="py-3">
                  <DaySection
                    name={day.name}
                    dayNumber={day.day_number}
                    liftCount={day.exercises.length}
                    headerActions={
                      <>
                        <ReorderButton endpoint={`/api/days/${day.id}`} direction="up" label={day.name} />
                        <ReorderButton endpoint={`/api/days/${day.id}`} direction="down" label={day.name} />
                        <DeleteButton
                          endpoint={`/api/days/${day.id}`}
                          label="day"
                          align="center"
                          triggerClassName="touch-target inline-flex items-center justify-center rounded-xl border border-line px-2 text-danger-ink transition-colors active:bg-danger-soft"
                        >
                          <Trash2 aria-hidden="true" size={15} />
                        </DeleteButton>
                      </>
                    }
                  >
                    <SortableDayExercises dayId={day.id} exercises={day.exercises} />
                    <AddExerciseForm dayId={day.id} />
                  </DaySection>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}
