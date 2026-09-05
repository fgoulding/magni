function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayLocalDateKey(): string {
  return toLocalDateKey(new Date());
}

/** Parse a `YYYY-MM-DD` key into a local Date, or null if it isn't a valid key. */
export function parseDateKey(value: string | null | undefined): Date | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return toLocalDateKey(date) === value ? date : null;
}

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
}

/** Date in the user's selected IANA timezone, independent of server TZ. */
export function dateKeyInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
