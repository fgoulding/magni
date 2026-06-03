import { afterEach, describe, expect, it, vi } from "vitest";
import { todayLocalDateKey, toLocalDateKey } from "./date-key";

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
});
