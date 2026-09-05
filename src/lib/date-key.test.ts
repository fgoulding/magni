import { afterEach, describe, expect, it, vi } from "vitest";
import { dateKeyInZone, isTimeZone, parseDateKey, todayLocalDateKey, toLocalDateKey } from "./date-key";

describe("date-key", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats calendar keys from local date parts instead of UTC parts", () => {
    expect(toLocalDateKey(new Date(2026, 4, 31, 23, 30))).toBe("2026-05-31");
  });

  it("uses local date parts for today's key", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 31, 23, 30));

    expect(todayLocalDateKey()).toBe("2026-05-31");
  });
  it("keeps user calendar dates correct across UTC midnight and DST", () => {
    expect(dateKeyInZone(new Date("2026-09-06T06:59:00Z"), "America/Los_Angeles")).toBe("2026-09-05");
    expect(dateKeyInZone(new Date("2026-09-06T07:01:00Z"), "America/Los_Angeles")).toBe("2026-09-06");
    expect(dateKeyInZone(new Date("2026-03-08T09:59:00Z"), "America/Los_Angeles")).toBe("2026-03-08");
    expect(dateKeyInZone(new Date("2026-03-08T10:01:00Z"), "America/Los_Angeles")).toBe("2026-03-08");
    expect(dateKeyInZone(new Date("2026-11-01T09:01:00Z"), "America/Los_Angeles")).toBe("2026-11-01");
    expect(dateKeyInZone(new Date("2026-09-05T16:00:00Z"), "Asia/Tokyo")).toBe("2026-09-06");
  });
  it("rejects impossible calendar dates and unknown timezones", () => {
    expect(parseDateKey("2026-02-30")).toBeNull();
    expect(parseDateKey("2026-01-01junk")).toBeNull();
    expect(isTimeZone("America/Los_Angeles")).toBe(true);
    expect(isTimeZone("invalid/zone")).toBe(false);
  });
});
