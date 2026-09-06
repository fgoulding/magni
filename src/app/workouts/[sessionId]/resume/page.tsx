import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { WorkoutCard } from "@/components/WorkoutCard";
import { getWorkout } from "@/features/workouts/history-service";
import { numberParam } from "@/lib/api";
import { getSettingNumber, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { calendarReturnHref, withCalendarReturn } from "@/features/calendar/navigation";

/** Exact-ID fallback for imported/manual sessions without a scheduled occurrence. */
export default async function ResumeWorkoutPage({ params, searchParams }: { params: Promise<{ sessionId: string }>; searchParams?: Promise<{ returnTo?: string }> }) {
  const user = await requireUser().catch(() => redirect("/login"));
  const session = getWorkout(user.id, numberParam((await params).sessionId));
  if (!session) notFound();
  const returnTo = calendarReturnHref((await searchParams)?.returnTo);
  const detailHref = withCalendarReturn(`/workouts/${session.id}`, returnTo);
  if (session.status !== "in_progress" || session.program_id === null) redirect(detailHref);
  const context = db.prepare(`SELECT s.day_id,s.program_definition_day_id,s.week_number,
    COALESCE(pdd.day_number,d.day_number,1) AS day_number
    FROM sessions s JOIN programs p ON p.id=s.program_id AND p.user_id=s.user_id
    LEFT JOIN program_definition_days pdd ON pdd.id=s.program_definition_day_id
    LEFT JOIN days d ON d.id=s.day_id AND d.program_id=p.id
    WHERE s.id=? AND s.user_id=?`).get(session.id, user.id) as { day_id: number | null; program_definition_day_id: number | null; week_number: number; day_number: number } | undefined;
  if (!context) notFound();
  return <div className="safe-x flex flex-col gap-4 py-5">
    <Link href={detailHref} className="touch-target inline-flex items-center text-sm font-semibold text-muted">← Workout details</Link>
    <p className="text-sm text-muted">Resuming {session.name} · {session.date}</p>
    <WorkoutCard resumeSessionId={session.id} programId={session.program_id}
      dayId={context.day_id ?? context.program_definition_day_id ?? 0} definitionDayId={context.program_definition_day_id ?? undefined}
      programName={session.program_name} dayName={session.day_name} currentWeek={context.week_number} currentDay={context.day_number}
      startLabel="Resume workout" showSkip={false} rounding={getSettingNumber(user.id, "rounding", 2.5)} />
  </div>;
}
