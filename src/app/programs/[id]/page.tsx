import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AddDayForm } from "@/components/AddDayForm";
import { AddExerciseForm } from "@/components/AddExerciseForm";
import { DeleteButton } from "@/components/DeleteButton";
import { ExerciseNameEditor } from "@/components/ExerciseNameEditor";
import { ProgramActiveToggle } from "@/components/ProgramActiveToggle";
import { ProgramScheduleForm } from "@/components/ProgramScheduleForm";
import { ReorderButton } from "@/components/ReorderButton";
import { SupersetLink } from "@/components/SupersetLink";
import { TrainingMaxEditor } from "@/components/TrainingMaxEditor";
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

      <nav className="grid grid-cols-3 gap-2 text-sm font-medium">
        <a href="#run-setup" className="touch-target inline-flex items-center justify-center rounded-xl bg-foreground px-3 text-white">
          Run Setup
        </a>
        <a href="#definition" className="touch-target inline-flex items-center justify-center rounded-xl border border-line bg-surface px-3">
          Definition
        </a>
        <a href="#sharing" className="touch-target inline-flex items-center justify-center rounded-xl border border-line bg-surface px-3">
          Sharing
        </a>
      </nav>

      <section id="run-setup" className="flex flex-col gap-3 scroll-mt-5">
        <div>
          <h2 className="display text-xl">Run Setup</h2>
          <p className="mt-0.5 text-sm text-muted">Personal schedule, current cursor, and tracking state.</p>
        </div>

        <div className="rounded-xl border border-line bg-surface p-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Program tracking</p>
            <p className="text-xs text-muted">
              {program.is_active
                ? "Showing on Today tab"
                : "Hidden from Today tab"}
            </p>
          </div>
          <ProgramActiveToggle programId={program.id} isActive={!!program.is_active} />
        </div>

        <ProgramScheduleForm
          programId={program.id}
          initialScheduleWeekdays={parseScheduleWeekdays(program.schedule_weekdays)}
          dayCount={daysWithExercises.length}
        />
      </section>

      <section id="definition" className="flex flex-col gap-3 scroll-mt-5">
        <div>
          <h2 className="display text-xl">Definition</h2>
          <p className="mt-0.5 text-sm text-muted">Reusable days, exercises, order, and progression templates.</p>
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
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{day.name}</p>
                      <p className="text-sm text-muted">Day {day.day_number}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <ReorderButton endpoint={`/api/days/${day.id}`} direction="up" label={day.name} />
                      <ReorderButton endpoint={`/api/days/${day.id}`} direction="down" label={day.name} />
                      <DeleteButton endpoint={`/api/days/${day.id}`} label="day" />
                    </div>
                  </div>

                  {day.exercises.length > 0 ? (
                    <div className="mt-3 flex flex-col gap-2">
                      {day.exercises.map((exercise, index) => {
                        const nextExercise = day.exercises[index + 1] ?? null;
                        const isSupersetStart =
                          exercise.superset_group !== null &&
                          (index === 0 || day.exercises[index - 1]?.superset_group !== exercise.superset_group);

                        return (
                          <div key={exercise.id}>
                            {isSupersetStart ? (
                              <div className="mb-2 ml-2 border-l-2 border-line pl-3">
                                <span className="text-xs font-medium text-faint">
                                  Superset
                                </span>
                                {day.exercises
                                  .filter((ex) => ex.superset_group === exercise.superset_group)
                                  .map((ex, si) => (
                                    <div
                                      key={ex.id}
                                      className={`rounded-xl bg-surface-muted p-3 ${si > 0 ? "mt-2" : "mt-1"}`}
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div>
                                          <ExerciseNameEditor
                                            exerciseId={ex.id}
                                            initialName={ex.name}
                                          />
                                          <p className="mt-1 text-sm text-muted">
                                            <span className="capitalize">{ex.category}</span> · {ex.progression_type}
                                          </p>
                                          <div className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-faint">
                                            TM
                                            <TrainingMaxEditor exerciseId={ex.id} initialValue={ex.training_max} />
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <ReorderButton endpoint={`/api/exercises/${ex.id}`} direction="up" label={ex.name} />
                                          <ReorderButton endpoint={`/api/exercises/${ex.id}`} direction="down" label={ex.name} />
                                          {si === 0 ? (
                                            <SupersetLink
                                              exerciseId={ex.id}
                                              linkExerciseId={
                                                day.exercises.find(
                                                  (e) => e.superset_group === ex.superset_group && e.id !== ex.id,
                                                )?.id ?? null
                                              }
                                              supersetGroup={ex.superset_group}
                                            />
                                          ) : null}
                                          <DeleteButton endpoint={`/api/exercises/${ex.id}`} label="exercise" />
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                              </div>
                            ) : exercise.superset_group === null || isSupersetStart ? (
                              !exercise.superset_group ? (
                                <div className="rounded-xl bg-surface-muted p-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <ExerciseNameEditor exerciseId={exercise.id} initialName={exercise.name} />
                                      <p className="mt-1 text-sm text-muted">
                                        <span className="capitalize">{exercise.category}</span> · {exercise.progression_type}
                                      </p>
                                      <div className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-faint">
                                        TM
                                        <TrainingMaxEditor exerciseId={exercise.id} initialValue={exercise.training_max} />
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <ReorderButton endpoint={`/api/exercises/${exercise.id}`} direction="up" label={exercise.name} />
                                      <ReorderButton endpoint={`/api/exercises/${exercise.id}`} direction="down" label={exercise.name} />
                                      <SupersetLink
                                        exerciseId={exercise.id}
                                        linkExerciseId={nextExercise?.id ?? null}
                                        linkName={nextExercise?.name ?? null}
                                        supersetGroup={exercise.superset_group}
                                      />
                                      <DeleteButton endpoint={`/api/exercises/${exercise.id}`} label="exercise" />
                                    </div>
                                  </div>
                                </div>
                              ) : null
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted">No exercises yet.</p>
                  )}

                  <AddExerciseForm dayId={day.id} />
                </div>
              ))}
            </div>
          )}
        </section>
      </section>

      <section id="sharing" className="scroll-mt-5 rounded-xl border border-line bg-surface p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Sharing</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Private definition
        </p>
      </section>
    </div>
  );
}
