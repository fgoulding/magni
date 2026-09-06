import { calendarReturnHref } from "@/features/calendar/navigation";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { userDateKey } from "@/lib/user-date";
import { QuickWorkout } from "@/components/QuickWorkout";
export default async function NewWorkoutPage({ searchParams }: { searchParams: Promise<{ date?: string; returnTo?: string }> }) {
  const user = await requireUser().catch(() => redirect("/login")); const params = await searchParams;
  const returnTo = calendarReturnHref(params.returnTo);
  return <div className="safe-x flex flex-col gap-4 py-5"><Link href={returnTo ?? "/workouts"} className="touch-target inline-flex items-center text-sm font-semibold text-muted">{returnTo ? "← Back to Calendar" : "← Workout history"}</Link><h1 className="display text-4xl">Add workout</h1><QuickWorkout initialSession={null} initialDate={params.date ?? userDateKey(user.id)} /></div>;
}
