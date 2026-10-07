// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExerciseDetail, ExerciseSummary, ProgressHome } from "@/features/progress/types";
import ProgressPage from "@/app/history/page";

const mocks = vi.hoisted(() => ({ push: vi.fn(), getProgressHome: vi.fn(), getExerciseDetail: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }), redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ id: 7 }) }));
vi.mock("@/features/progress/queries", () => ({ getProgressHome: mocks.getProgressHome, getExerciseDetail: mocks.getExerciseDetail, listUnlinkedExercises: vi.fn() }));
const exercise = (id: string): ExerciseSummary => ({ id, name: `Exercise ${id}`, origin: "confirmed", sessionCount: 1, recordedSets: 1, lastDate: "2026-10-01", latest: { sessionId: 1, date: "2026-10-01", weight: 40, reps: 8, unit: "kg", setId: 1 }, pinned: true });
const home: ProgressHome = { pinLimit: 4, recentLimit: 3, pinned: [exercise("first"), exercise("second")], recent: [], activity: { from: "2026-09-14", to: "2026-10-06", sessions: 1, emptySessions: 0, usesKilograms: true, recordedSets: 1, volumeLb: 705, missingWeightSets: 0 } };
const detail: ExerciseDetail = { exercise: exercise("first"), from: "2026-09-14", to: "2026-10-06", totals: { sessions: 1, recordedSets: 1, reps: 8, volumeLb: 705, missingWeightSets: 0 }, observations: { items: [], nextCursor: null }, chart: { points: [{ sessionId: 1, date: "2026-10-01", unit: "kg", bestE1rm: 50.7, bestE1rmLb: 111.7, topWeight: 40, totalReps: 8, recordedSets: 1 }], truncated: false, totalObservations: 1 } };
beforeEach(() => {
  mocks.getProgressHome.mockReturnValue(home);
  mocks.getExerciseDetail.mockImplementation((_user, id) => ({ ...detail, exercise: exercise(id) }));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const page = (metric: string, period = "12w", exercise = "e:first") => ProgressPage({ searchParams: Promise.resolve({ exercise, metric, period }) });

describe("Progress URL updates preserve control focus", () => {
  it("keeps the metric and period controls mounted and restores the metric on browser back", async () => {
    const view = render(await page("reps"));
    const metric = screen.getByRole("combobox", { name: "Chart metric" });
    metric.focus();
    fireEvent.change(metric, { target: { value: "load:kg" } });
    view.rerender(await page("load:kg"));
    expect(screen.getByRole("combobox", { name: "Chart metric" })).toBe(metric);
    expect(metric).toHaveFocus();
    expect(metric).toHaveValue("load:kg");
    view.rerender(await page("reps"));
    expect(metric).toHaveFocus();
    expect(metric).toHaveValue("reps");
    const period = screen.getByRole("combobox", { name: "Period" });
    period.focus();
    fireEvent.change(period, { target: { value: "all" } });
    view.rerender(await page("reps", "all"));
    expect(screen.getByRole("combobox", { name: "Period" })).toBe(period);
    expect(period).toHaveFocus();
    expect(period).toHaveValue("all");
  });
  it("keeps focus on the chooser trigger after selecting another exercise", async () => {
    const view = render(await page("reps"));
    const trigger = screen.getByRole("button", { name: "Choose exercise" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getAllByTestId("exercise-choice")[1]);
    await waitFor(() => expect(trigger).toHaveFocus());
    view.rerender(await page("reps", "12w", "e:second"));
    expect(screen.getByRole("button", { name: "Choose exercise" })).toBe(trigger);
    expect(trigger).toHaveFocus();
  });
});
