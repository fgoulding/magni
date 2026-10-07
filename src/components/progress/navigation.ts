import { workoutReturnHref } from "@/features/workouts/navigation";

export type ProgressSearch = Record<string, string | string[] | undefined>;
export function single(value: string | string[] | undefined): string { return typeof value === "string" ? value : ""; }
export type ProgressMetric = "reps" | "estimate:lb" | "estimate:kg" | "load:lb" | "load:kg";
export function progressMetric(value: string): ProgressMetric | undefined {
  return /^(reps|(?:estimate|load):(?:lb|kg))$/.test(value) ? value as ProgressMetric : undefined;
}
export function progressUrl(path: string, values: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  return path + (query.size ? `?${query}` : "");
}
export function searchUrl(path: string, values: ProgressSearch): string {
  return progressUrl(path, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, single(value)])));
}
export function progressReturnTo(value: string | undefined, fallback = "/history"): string {
  return workoutReturnHref(value) ?? fallback;
}
/** Server-provided cursors keep deep browsing URLs bounded while preserving their scope. */
export function pageLinks(current: string, nextCursor: string | null, previousCursor: string | null = null): { previous: string | null; next: string | null } {
  const url = new URL(current, "https://magni.invalid");
  const make = (cursor: string) => {
    const params = new URLSearchParams(url.searchParams);
    params.delete("trail");
    if (cursor) params.set("cursor", cursor); else params.delete("cursor");
    return url.pathname + (params.size ? `?${params}` : "");
  };
  return { previous: previousCursor !== null ? make(previousCursor) : null, next: nextCursor ? make(nextCursor) : null };
}

export function workoutEvidenceHref(sessionId: number, currentHref: string): string { return `/workouts/${sessionId}?returnTo=${encodeURIComponent(currentHref)}`; }

/** Next's dynamic route parameter is encoded in this installed runtime. Decode once. */
export function decodeProgressKey(raw: string): string | null {
  try { const key = decodeURIComponent(raw); return /^(e:[A-Za-z0-9-]+|u:[A-Za-z0-9_-]+)$/.test(key) ? key : null; } catch { return null; }
}
