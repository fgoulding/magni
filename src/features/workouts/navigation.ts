import { calendarReturnHref } from "@/features/calendar/navigation";

/** Retain a known training/history position without allowing an external redirect. */
export function workoutReturnHref(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096 || !value.startsWith("/") || /[\\\x00-\x1f\x7f]/.test(value)) return null;
  const calendar = calendarReturnHref(value);
  if (calendar) {
    const workout = new URL(value, "https://magni.invalid").searchParams.get("workout");
    return workout && /^(occurrence|history)-[1-9]\d*$/.test(workout) ? `${calendar}&workout=${workout}` : calendar;
  }
  try {
    const url = new URL(value, "https://magni.invalid");
    if (url.origin !== "https://magni.invalid") return null;
    if (url.pathname !== "/today" && !/^\/workouts(?:\/[1-9]\d*(?:\/resume)?)?$/.test(url.pathname) && url.pathname !== "/history" && !url.pathname.startsWith("/history/")) return null;
    return url.pathname + url.search;
  } catch { return null; }
}

export function currentTrainingHref(): string {
  return typeof window === "undefined" ? "/today" : workoutReturnHref(window.location.pathname + window.location.search) ?? "/today";
}

export function subscribeTrainingLocation(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

export function withWorkoutReturn(href: string, returnTo: string | null): string {
  const safe = workoutReturnHref(returnTo);
  return safe ? `${href}${href.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(safe)}` : href;
}

/** Follow only validated workout intermediates; a history page stays Progress. */
export function workoutNavigationOrigin(returnTo: unknown): "/today" | "/calendar" | "/history" {
  let current = workoutReturnHref(returnTo);
  for (let depth = 0; current && depth < 8; depth++) {
    const url = new URL(current, "https://magni.invalid");
    if (url.pathname === "/today") return "/today";
    if (url.pathname === "/calendar") return "/calendar";
    if (!/^\/workouts\/[1-9]\d*(?:\/resume)?$/.test(url.pathname)) break;
    current = workoutReturnHref(url.searchParams.get("returnTo"));
  }
  return "/history";
}

export function workoutReturnLabel(returnTo: string | null): string {
  return returnTo?.startsWith("/calendar?") ? "← Back to Calendar"
    : returnTo?.startsWith("/history") ? "← Back to Progress"
    : returnTo?.startsWith("/today") ? "← Back to Today"
    : returnTo?.startsWith("/workouts/") ? "← Back to workout" : "← Workout history";
}

/** Never return to the workout that was just deleted or reopen its calendar card. */
export function workoutDeletionReturnHref(returnTo: unknown, deletedId: number): string {
  let current = workoutReturnHref(returnTo);
  for (let depth = 0; current && depth < 8; depth++) {
    const url = new URL(current, "https://magni.invalid");
    if (url.pathname === `/workouts/${deletedId}` || url.pathname === `/workouts/${deletedId}/resume`) {
      current = workoutReturnHref(url.searchParams.get("returnTo"));
      continue;
    }
    if (url.pathname === "/calendar" && url.searchParams.get("workout") === `history-${deletedId}`) return calendarReturnHref(current)!;
    return current;
  }
  return "/workouts";
}
