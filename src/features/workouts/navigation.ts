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
