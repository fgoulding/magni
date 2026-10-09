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
const home: ProgressHome = { primary: [{ key: "p:squat", name: "Squat", hasHistory: true, exercise: exercise(0) }, { key: "p:bench", name: "Bench", hasHistory: false, exercise: null }, { key: "p:deadlift", name: "Deadlift", hasHistory: false, exercise: null }], pinLimit: 4, recentLimit: 3, pinned: Array.from({ length: 4 }, (_, i) => exercise(i)), recent: [4, 5, 6].map(i => asFinderItem(exercise(i))), activity: { from: "2026-09-14", to: "2026-10-06", sessions: 12, emptySessions: 0, usesKilograms: true, recordedSets: 40, volumeLb: 0, missingWeightSets: 5 } };
const detail: ExerciseDetail = { exercise: exercise(0), from: "2026-09-14", to: "2026-10-06", totals: { sessions: 1, recordedSets: 1, reps: 12, volumeLb: 0, missingWeightSets: 0 }, observations: { items: [], nextCursor: null }, chart: { points: [{ sessionId: 1, date: "2026-10-01", unit: "kg", bestE1rm: null, bestE1rmLb: null, totalReps: 12, recordedSets: 1 }], truncated: false, totalObservations: 1 } };
describe("graph-first Progress", () => {
  it("shows one chart without favorite clutter and offers three primary choices", () => {
    render(<ProgressOverview home={home} period="12w" currentHref="/history?exercise=e%3A0&period=12w" selectedKey="e:0" detail={detail} />);
    expect(screen.getByRole("region", { name: "Exercise chart" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Favorite exercises" })).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("progress-exercise-row")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Choose exercise" }));
    expect(within(screen.getByRole("dialog", { name: "Choose exercise" })).getAllByTestId("exercise-choice")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Manage favorites" })).toHaveAttribute("href", "/history/pins?returnTo=%2Fhistory%3Fexercise%3De%253A0%26period%3D12w");
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("href", "/workouts");
  });
  it("does not invent a chart for unlinked same-name records", () => {
    const unlinked = { ...asFinderItem(exercise(8)), key: "u:Um93", name: "Row", kind: "unlinked" as const, exercise: null };
    render(<ProgressOverview home={{ ...home, pinned: [], recent: [unlinked] }} period="12w" currentHref="/history" selectedKey="u:Um93" selectedName="Row" />);
    expect(screen.queryByRole("region", { name: "Exercise chart" })).not.toBeInTheDocument();
    expect(screen.getByText(/These workouts use the same name/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Combine exercise history" })).toBeVisible();
  });
  it("opens all recorded workouts without carrying the chart date range into history", () => {
    const currentHref = "/history?exercise=e%3A0&period=4w&metric=load%3Akg";
    render(<ProgressOverview home={home} period="4w" currentHref={currentHref} selectedKey="e:0" detail={detail} />);
    const href = new URL(screen.getByRole("link", { name: /^All recorded workouts/ }).getAttribute("href")!, "https://magni.test");
    expect(href.searchParams.get("from")).toBeNull();
    expect(href.searchParams.get("to")).toBeNull();
    expect(href.searchParams.get("returnTo")).toBe(currentHref);
  });
  it("adds a workout count only when the overview already covers all history", () => {
    const view = render(<ProgressOverview home={home} period="all" currentHref="/history?exercise=e%3A0&period=all" selectedKey="e:0" detail={detail} />);
    expect(screen.getByRole("link", { name: "All recorded workouts (1)" })).toBeVisible();
    view.rerender(<ProgressOverview home={home} period="4w" currentHref="/history?exercise=e%3A0&period=4w" selectedKey="e:0" detail={detail} />);
    expect(screen.getByRole("link", { name: "All recorded workouts" })).toBeVisible();
  });
  it("explains an empty filtered range and offers all history for the same exercise", () => {
    const empty = { ...detail, totals: { ...detail.totals, sessions: 0 }, chart: { points: [], truncated: false, totalObservations: 0 } };
    render(<ProgressOverview home={home} period="4w" currentHref="/history?exercise=e%3A0&period=4w" selectedKey="e:0" detail={empty} initialMetric="load:kg" />);
    expect(screen.getByText("No Exercise 0 workouts in this range")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show all history" }));
    expect(push).toHaveBeenCalledWith("/history?exercise=e%3A0&period=all&metric=load%3Akg", { scroll: false });
  });
  it("keeps an empty primary lift selectable without inventing a chart or asking for pinning", () => {
    render(<ProgressOverview home={home} period="all" currentHref="/history?exercise=p%3Abench&period=all" selectedKey="p:bench" selectedName="Bench" />);
    expect(screen.getByText("No Bench workouts yet")).toBeVisible();
    expect(screen.queryByRole("region", { name: "Exercise chart" })).not.toBeInTheDocument();
    expect(screen.queryByText(/pin/i)).not.toBeInTheDocument();
  });
  it("offers all-history variations for a separated primary without claiming its workouts are missing", () => {
    const currentHref = "/history?exercise=p%3Adeadlift&period=4w&metric=load%3Akg";
    const separated = { ...home, primary: home.primary.map(item => item.key === "p:deadlift" ? { ...item, hasHistory: true } : item) };
    render(<ProgressOverview home={separated} period="4w" currentHref={currentHref} selectedKey="p:deadlift" initialMetric="load:kg" />);
    expect(screen.getByRole("heading", { name: "Choose a variation" })).toBeVisible();
    expect(screen.queryByText("No Deadlift workouts yet")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Combine exercise history" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Exercise chart" })).not.toBeInTheDocument();
    const href = new URL(screen.getByRole("link", { name: "Browse variations" }).getAttribute("href")!, "https://magni.test");
    expect(href.pathname).toBe("/history/exercises");
    expect(href.searchParams.get("q")).toBe("dead");
    expect(screen.getByText(/Browse related exercises/)).toBeVisible();
    expect(href.searchParams.get("returnTo")).toBe(currentHref);
    expect([...href.searchParams.keys()].sort()).toEqual(["q", "returnTo"]);
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
