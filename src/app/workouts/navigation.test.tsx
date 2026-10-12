// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ id: 7 }) }));
vi.mock("@/lib/user-date", () => ({ userDateKey: () => "2026-10-11" }));
vi.mock("@/features/progress/queries", () => ({ getProgressHistory: () => ({ items: [], nextCursor: null, previousCursor: null }) }));
vi.mock("@/features/progress/identity", () => ({ resolveSetExerciseIdentities: () => new Map() }));
vi.mock("@/features/workouts/history-service", () => ({ getWorkout: () => ({ id: 42, name: "Quick rows", date: "2026-10-11", status: "in_progress", program_id: null, sets: [] }) }));
vi.mock("@/features/programs/occurrences", () => ({ getOccurrence: () => undefined }));
vi.mock("@/components/QuickWorkout", () => ({ QuickWorkout: ({ returnTo, standalone }: { returnTo?: string; standalone?: boolean }) => <div data-testid="quick" data-return={returnTo} data-standalone={String(!!standalone)} /> }));
import NewWorkoutPage from "./new/page";
import WorkoutPage from "./[sessionId]/page";
import WorkoutsPage from "./page";
afterEach(cleanup);

it.each([
  ["/calendar?month=2026-10&date=2026-10-11&view=month", "← Back to Calendar"],
  ["/workouts?q=upper&status=in_progress&cursor=page2", "← Workout history"],
  ["/history?period=4w", "← Back to Progress"],
  ["/today", "← Back to Today"],
])("passes %s through standalone creation and reloaded detail", async (returnTo, label) => {
  const first = render(await NewWorkoutPage({ searchParams: Promise.resolve({ date: "2026-10-11", returnTo }) }));
  expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", returnTo);
  expect(screen.getByTestId("quick")).toHaveAttribute("data-return", returnTo);
  expect(screen.getByTestId("quick")).toHaveAttribute("data-standalone", "true");
  first.unmount();
  render(await WorkoutPage({ params: Promise.resolve({ sessionId: "42" }), searchParams: Promise.resolve({ returnTo }) }));
  expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", returnTo);
  expect(screen.getByTestId("quick")).toHaveAttribute("data-return", returnTo);
  expect(screen.getByTestId("quick")).toHaveAttribute("data-standalone", "true");
});

it("rejects an external return destination on creation and reloaded details", async () => {
  for (const page of [await NewWorkoutPage({ searchParams: Promise.resolve({ returnTo: "https://elsewhere.test/today" }) }), await WorkoutPage({ params: Promise.resolve({ sessionId: "42" }), searchParams: Promise.resolve({ returnTo: "https://elsewhere.test/today" }) })]) {
    const view = render(page);
    expect(screen.getByRole("link", { name: "← Workout history" })).toHaveAttribute("href", "/workouts");
    expect(screen.getByTestId("quick")).not.toHaveAttribute("data-return");
    view.unmount();
  }
});

it("carries the current filtered and paginated history into Add workout", async () => {
  render(await WorkoutsPage({ searchParams: Promise.resolve({ q: "upper", status: "in_progress", cursor: "page2" }) }));
  const url = new URL(screen.getByRole("link", { name: "Add workout" }).getAttribute("href")!, "https://magni.test");
  expect(url.pathname).toBe("/workouts/new");
  expect(url.searchParams.get("date")).toBe("2026-10-11");
  expect(url.searchParams.get("returnTo")).toBe("/workouts?q=upper&status=in_progress&cursor=page2");
});
