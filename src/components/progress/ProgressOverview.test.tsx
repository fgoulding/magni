// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExerciseDetail, ExerciseSummary, ProgressHome } from "@/features/progress/types";
import { asFinderItem } from "./ExerciseRows";
import { ProgressOverview } from "./ProgressOverview";
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
beforeEach(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const exercise = (id: number): ExerciseSummary => ({ id: String(id), name: `Exercise ${id}`, origin: "confirmed", sessionCount: 1, recordedSets: 1, lastDate: "2026-10-01", latest: { sessionId: id, date: "2026-10-01", weight: 0, reps: 12, unit: "kg", setId: id }, pinned: id < 4 });
const home: ProgressHome = { pinLimit: 4, recentLimit: 3, pinned: Array.from({ length: 4 }, (_, i) => exercise(i)), recent: [4, 5, 6].map(i => asFinderItem(exercise(i))), activity: { from: "2026-09-14", to: "2026-10-06", sessions: 12, emptySessions: 0, usesKilograms: true, recordedSets: 40, volumeLb: 0, missingWeightSets: 5 } };
const detail: ExerciseDetail = { exercise: exercise(0), from: "2026-09-14", to: "2026-10-06", totals: { sessions: 1, recordedSets: 1, reps: 12, volumeLb: 0, missingWeightSets: 0 }, observations: { items: [], nextCursor: null }, chart: { points: [{ sessionId: 1, date: "2026-10-01", unit: "kg", bestE1rm: null, bestE1rmLb: null, totalReps: 12, recordedSets: 1 }], truncated: false, totalObservations: 1 } };
describe("graph-first Progress", () => {
  it("shows one chart and three favorite shortcuts; the chooser starts with at most seven choices", () => {
    render(<ProgressOverview home={home} period="12w" currentHref="/history?exercise=e%3A0&period=12w" selectedKey="e:0" detail={detail} />);
    expect(screen.getByRole("region", { name: "Exercise chart" })).toBeVisible();
    expect(within(screen.getByRole("navigation", { name: "Favorite exercises" })).getAllByRole("button")).toHaveLength(3);
    expect(screen.queryAllByTestId("progress-exercise-row")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Choose exercise" }));
    expect(within(screen.getByRole("dialog", { name: "Choose exercise" })).getAllByTestId("exercise-choice")).toHaveLength(7);
    expect(screen.getByRole("link", { name: "Manage favorites" })).toHaveAttribute("href", "/history/pins?returnTo=%2Fhistory%3Fexercise%3De%253A0%26period%3D12w");
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("href", "/workouts");
  });
  it("does not invent a chart for unlinked same-name records", () => {
    const unlinked = { ...asFinderItem(exercise(8)), key: "u:Um93", name: "Row", kind: "unlinked" as const, exercise: null };
    render(<ProgressOverview home={{ ...home, pinned: [], recent: [unlinked] }} period="12w" currentHref="/history" selectedKey="u:Um93" selectedName="Row" />);
    expect(screen.queryByRole("region", { name: "Exercise chart" })).not.toBeInTheDocument();
    expect(screen.getByText(/These records share a name/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Follow as one exercise" })).toBeVisible();
  });
  it("preserves selection when changing period and keeps actual activity secondary and accessible", () => {
    render(<ProgressOverview home={home} period="12w" currentHref="/history?exercise=e%3A0&period=12w" selectedKey="e:0" detail={detail} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Period" }), { target: { value: "all" } });
    expect(push).toHaveBeenCalledWith("/history?exercise=e%3A0&period=all", { scroll: false });
    fireEvent.click(screen.getByText("Recorded activity", { exact: true }));
    expect(screen.getByLabelText("12 recorded workouts")).toBeVisible();
    expect(screen.getByLabelText("0 lb equivalent recorded volume")).toBeVisible();
  });
  it("restores the chosen metric and preserves it through period changes and discovery routes", () => {
    const metricDetail = { ...detail, chart: { ...detail.chart, points: detail.chart.points.map(point => ({ ...point, topWeight: 0 })) } };
    render(<ProgressOverview home={home} period="12w" currentHref="/history?exercise=e%3A0&period=12w&metric=load%3Akg" selectedKey="e:0" detail={metricDetail} initialMetric="load:kg" />);
    expect(screen.getByRole("combobox", { name: "Chart metric" })).toHaveValue("load:kg");
    fireEvent.change(screen.getByRole("combobox", { name: "Period" }), { target: { value: "all" } });
    expect(push).toHaveBeenCalledWith("/history?exercise=e%3A0&period=all&metric=load%3Akg", { scroll: false });
    fireEvent.change(screen.getByRole("combobox", { name: "Chart metric" }), { target: { value: "reps" } });
    expect(push).toHaveBeenCalledWith("/history?exercise=e%3A0&period=12w&metric=reps", { scroll: false });
    fireEvent.click(screen.getByRole("button", { name: "Choose exercise" }));
    const browse = new URL(screen.getByRole("link", { name: "Browse all exercises" }).getAttribute("href")!, "https://magni.test");
    expect(browse.searchParams.get("returnTo")).toBe("/history?exercise=e%3A0&period=12w&metric=reps");
  });
});
