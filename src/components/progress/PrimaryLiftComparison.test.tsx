// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExerciseChartPoint, ExerciseDetail, ProgressPrimaryExercise } from "@/features/progress/types";
import { PrimaryLiftComparison } from "./PrimaryLiftComparison";
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const point = (id: number, date: string, weight: number | null, unit: "lb" | "kg" = "lb"): ExerciseChartPoint => ({ sessionId: id, date, unit, bestE1rm: weight, bestE1rmLb: weight, topWeight: weight, totalReps: 5, recordedSets: 1 });
const lift = (name: "Squat" | "Bench" | "Deadlift", points: ExerciseChartPoint[], hasHistory = true) => {
  const id = name.toLowerCase();
  const exercise = { id, name, origin: "confirmed" as const, sessionCount: points.length, recordedSets: points.length, lastDate: points.at(-1)?.date ?? "", latest: null, pinned: false };
  return { primary: { key: `p:${id}`, name, hasHistory, exercise: hasHistory ? exercise : null } as ProgressPrimaryExercise, detail: hasHistory ? { exercise, from: null, to: null, totals: { sessions: points.length, recordedSets: points.length, reps: 5 * points.length, volumeLb: 0, missingWeightSets: 0 }, chart: { points, truncated: false, totalObservations: points.length }, observations: { items: [], nextCursor: null } } as ExerciseDetail : null };
};
const lifts = [lift("Squat", [point(1, "2026-01-01", 200), point(2, "2026-01-11", 225)]), lift("Bench", [point(3, "2026-01-06", 150), point(4, "2026-01-11", 160)]), lift("Deadlift", [point(5, "2026-01-01", 275), point(6, "2026-01-11", 300)])];
const currentHref = "/history?exercise=e%3Acustom&period=all&metric=load%3Alb&view=big-three";
describe("Big three comparison", () => {
  it("plots three distinct lifts on common date and load scales with bounded drill-downs", () => {
    const view = render(<PrimaryLiftComparison lifts={lifts} period="all" selectedKey="e:custom" initialMetric="load:lb" currentHref={currentHref} />);
    expect(screen.getByRole("region", { name: "Big three chart" })).toBeVisible();
    expect(within(screen.getByRole("list", { name: "Primary lift results" })).getAllByRole("listitem")).toHaveLength(3);
    const points = view.container.querySelectorAll('[data-chart-point="true"]');
    expect(points).toHaveLength(6);
    const squatX = Number(points[1].getAttribute("data-x"));
    const benchX = Number(points[3].getAttribute("data-x"));
    expect(squatX).toBe(benchX);
    expect(view.container.querySelectorAll('polyline[stroke-dasharray="6 4"]')).toHaveLength(1);
    expect(view.container.querySelectorAll('polyline[stroke-dasharray="2 5"]')).toHaveLength(1);
    const single = new URL(screen.getByRole("link", { name: "One exercise" }).getAttribute("href")!, "https://magni.test");
    expect(single.searchParams.get("view")).toBe("exercise");
    expect(single.searchParams.get("exercise")).toBe("e:custom");
    const squat = new URL(screen.getByRole("link", { name: "View Squat progress" }).getAttribute("href")!, "https://magni.test");
    expect(squat.searchParams.get("exercise")).toBe("e:squat");
    expect(squat.searchParams.get("metric")).toBe("load:lb");
    expect(squat.searchParams.get("period")).toBe("all");
  });
  it("preserves metric and range while switching units, never connecting across missing values", () => {
    const mixed = [lift("Squat", [point(1, "2026-01-01", 200), point(2, "2026-01-05", null), point(3, "2026-01-11", 225)]), lift("Bench", [point(4, "2026-01-06", 90, "kg")]), lift("Deadlift", [], false)];
    const view = render(<PrimaryLiftComparison lifts={mixed} period="12w" selectedKey="e:custom" initialMetric="load:lb" currentHref={currentHref} />);
    expect(view.container.querySelectorAll('[data-chart-point="true"]')).toHaveLength(2);
    expect(view.container.querySelectorAll("polyline")).toHaveLength(0);
    fireEvent.change(screen.getByRole("combobox", { name: "Chart metric" }), { target: { value: "load:kg" } });
    expect(push).toHaveBeenLastCalledWith("/history?exercise=e%3Acustom&period=12w&metric=load%3Akg&view=big-three", { scroll: false });
    expect(view.container.querySelectorAll('[data-chart-point="true"]')).toHaveLength(1);
    fireEvent.change(screen.getByRole("combobox", { name: "Period" }), { target: { value: "4w" } });
    expect(push).toHaveBeenLastCalledWith("/history?exercise=e%3Acustom&period=4w&metric=load%3Akg&view=big-three", { scroll: false });
    expect(screen.getByRole("list", { name: "Primary lift results" })).toHaveTextContent("No recorded history");
  });
  it("inspects same-day sources with keyboard buttons and clears inspection when metric changes", () => {
    const view = render(<PrimaryLiftComparison lifts={lifts} period="all" selectedKey="e:custom" initialMetric="load:lb" currentHref={currentHref} />);
    fireEvent.click(view.container.querySelector('[data-record="p:deadlift/6"]')!);
    const selected = screen.getByRole("region", { name: "Selected comparison workout" });
    expect(selected).toHaveTextContent("Deadlift · 300 lb");
    fireEvent.click(screen.getByRole("button", { name: "Previous comparison workout" }));
    expect(selected).toHaveTextContent("Bench · 160 lb");
    const source = new URL(within(selected).getByRole("link", { name: "View workout" }).getAttribute("href")!, "https://magni.test");
    expect(source.pathname).toBe("/workouts/4");
    expect(source.searchParams.get("returnTo")).toBe(currentHref);
    fireEvent.change(screen.getByRole("combobox", { name: "Chart metric" }), { target: { value: "reps" } });
    expect(screen.queryByRole("region", { name: "Selected comparison workout" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Chart metric" }), { target: { value: "load:lb" } });
    expect(screen.queryByRole("region", { name: "Selected comparison workout" })).not.toBeInTheDocument();
  });

  it("keeps an explicit absent unit empty and deliberately separated primary histories uncombined", () => {
    const separated = { ...lift("Deadlift", [], false), primary: { ...lift("Deadlift", [], false).primary, hasHistory: true } };
    render(<PrimaryLiftComparison lifts={[lifts[0], lifts[1], separated]} period="all" selectedKey="" initialMetric="load:kg" currentHref="/history?view=big-three&metric=load%3Akg" />);
    expect(screen.getByRole("combobox", { name: "Chart metric" })).toHaveValue("load:kg");
    expect(screen.getByText("No comparable results in this range.")).toBeVisible();
    expect(screen.getByRole("link", { name: "View Deadlift progress" })).toHaveTextContent("Choose a variation");
    expect(screen.queryByText("0 kg")).not.toBeInTheDocument();
  });
  it("retains full-range latest outside the plot cap and source context for dated evidence", () => {
    const older = point(9, "2025-01-01", 80, "kg");
    const mixed = lift("Squat", [point(1, "2026-01-01", 200)]);
    mixed.detail!.chart.truncated = true;
    mixed.detail!.metricSummaries = [{ metric: "load:kg", count: 1, latest: { ...older, value: 80 }, previous: null, first: { ...older, value: 80 }, best: { ...older, value: 80 } }];
    const view = render(<PrimaryLiftComparison lifts={[mixed, lifts[1], lifts[2]]} period="all" selectedKey="e:custom" initialMetric="load:kg" currentHref={currentHref} />);
    expect(screen.getByRole("link", { name: "View Squat progress" })).toHaveTextContent("80 kg");
    expect(screen.getByText(/Latest values cover the full selected range/)).toBeVisible();
    expect(view.container.querySelectorAll('[data-chart-point="true"]')).toHaveLength(0);
    fireEvent.change(screen.getByRole("combobox", { name: "Chart metric" }), { target: { value: "load:lb" } });
    fireEvent.click(screen.getByText("Dated chart values"));
    const table = screen.getByRole("table", { name: "Big three dated values" });
    const href = new URL(within(table).getByRole("link", { name: "Squat · Jan 1, 2026 · Workout 1" }).getAttribute("href")!, "https://magni.test");
    expect(href.searchParams.get("returnTo")).toBe(currentHref);
  });
});
