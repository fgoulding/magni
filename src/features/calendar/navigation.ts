/** Only retain Calendar position, never an arbitrary redirect or an open modal. */
export function calendarReturnHref(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/calendar?") || value.includes("\\")) return null;
  try {
    const url = new URL(value, "https://magni.invalid");
    if (url.origin !== "https://magni.invalid" || url.pathname !== "/calendar") return null;
    const month = url.searchParams.get("month");
    const date = url.searchParams.get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const parsed = new Date(`${date}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
    if (month && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) return null;
    return `/calendar?month=${month ?? date.slice(0, 7)}&date=${date}${url.searchParams.get("view") === "month" ? "&view=month" : ""}${url.searchParams.get("compact") === "0" ? "&compact=0" : ""}`;
  } catch { return null; }
}

export function withCalendarReturn(href: string, returnTo: string | null): string {
  const safe = calendarReturnHref(returnTo);
  return safe ? `${href}${href.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(safe)}` : href;
}

/** Remember both link and programmatic departures, without replacing a saved
 * Calendar position when a workout is repeated from its own detail page. */
export function rememberCalendarScroll(returnTo: string | undefined): void {
  const safe = calendarReturnHref(returnTo);
  if (!safe || typeof window === "undefined" || calendarReturnHref(window.location.pathname + window.location.search) !== safe) return;
  try { sessionStorage.setItem(`magni.calendar.scroll:${safe}`, String(window.scrollY)); } catch { /* Navigation still works without storage. */ }
}
