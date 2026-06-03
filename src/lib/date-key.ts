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
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
