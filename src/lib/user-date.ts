import { db } from "@/lib/db";
import { dateKeyInZone, isTimeZone } from "@/lib/date-key";

export function userTimeZone(userId: number): string {
  const row = db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'timezone'").get(userId) as { value: string } | undefined;
  return isTimeZone(row?.value) ? row.value : Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function userDateKey(userId: number, now = new Date()): string {
  return dateKeyInZone(now, userTimeZone(userId));
}
