import { describe, expect, it } from "vitest";
import { withWorkoutReturn, workoutReturnHref } from "./navigation";

describe("workout return context", () => {
  it("keeps finder pagination and exercise date filters", () => {
    expect(workoutReturnHref("/history/exercises?search=row&cursor=page2")).toBe("/history/exercises?search=row&cursor=page2");
    expect(workoutReturnHref("/history/exercises/e%3A123?from=2026-09-01")).toBe("/history/exercises/e%3A123?from=2026-09-01");
    expect(workoutReturnHref("/workouts?search=upper")).toBe("/workouts?search=upper");
  });
  it("retains an explicit active Calendar workout and strips invalid modal keys", () => {
    expect(workoutReturnHref("/calendar?date=2026-09-01&workout=occurrence-1")).toBe("/calendar?month=2026-09&date=2026-09-01&workout=occurrence-1");
    expect(workoutReturnHref("/calendar?date=2026-09-01&workout=unknown")).toBe("/calendar?month=2026-09&date=2026-09-01");
    expect(workoutReturnHref("/today")).toBe("/today");
    expect(workoutReturnHref("/workouts/42/resume")).toBe("/workouts/42/resume");
  });
  it("preserves exact filtered History context through resume and workout details", () => {
    const context = "/workouts?search=upper&status=in_progress&cursor=page2";
    const resume = withWorkoutReturn("/workouts/42/resume", context);
    expect(resume).toBe(`/workouts/42/resume?returnTo=${encodeURIComponent(context)}`);
    const restored = workoutReturnHref(new URL(resume, "https://magni.invalid").searchParams.get("returnTo"));
    expect(withWorkoutReturn("/workouts/42", restored)).toBe(`/workouts/42?returnTo=${encodeURIComponent(context)}`);
    expect(withWorkoutReturn("/workouts/42", "https://elsewhere.test")).toBe("/workouts/42");
  });
  it.each([undefined, "https://elsewhere.test/history", "//elsewhere.test/history", "/\\elsewhere.test/history", "javascript:alert(1)", "/settings", "/workouts/2/unknown", "/history/../settings", "/calendar?date=2026-02-30", "/history\n", "/history?" + "x".repeat(4096)])("rejects unrelated or invalid return context %s", value => {
    expect(workoutReturnHref(value)).toBeNull();
  });
});
