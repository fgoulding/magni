// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ExerciseChartPoint } from "@/features/progress/types";
import { RecordedRepsChart } from "./ExerciseProgressChart";

const point = (sessionId: number, date: string, topWeight: number | null): ExerciseChartPoint => ({ sessionId, date, unit: "lb", topWeight, bestE1rm: null, bestE1rmLb: null, totalReps: 5, recordedSets: 1 });
const points = [point(1, "2026-09-01", 245), point(2, "2026-10-01", 205), point(3, "2026-10-01", 225)];
const currentHref = "/history?exercise=e%3Asquat&period=all&metric=load%3Alb";
const evidence = (entry: ExerciseChartPoint, value = entry.topWeight!) => ({ ...entry, value });
const summary = { metric: "load:lb" as const, count: 3, first: evidence(points[0]), latest: evidence(points[2]), previous: evidence(points[1]), best: evidence(points[0]) };
afterEach(cleanup);

describe("progress chart insights", () => {
  it("keeps latest, previous and best context while inspecting each same-day workout", () => {
    render(<RecordedRepsChart points={points} metricSummaries={[summary]} truncated={false} currentHref={currentHref} metric="load:lb" overview />);
    const performance = screen.getByRole("region", { name: "Performance summary" });
    expect(performance).toHaveTextContent("Latest");
    expect(performance).toHaveTextContent("225 lb");
    expect(performance).toHaveTextContent("+20 lb");
    expect(performance).toHaveTextContent("Best in range");
    expect(performance).toHaveTextContent("245 lb");
    const selected = screen.getByRole("region", { name: "Selected workout" });
    expect(within(selected).getByRole("link", { name: "View workout" }).getAttribute("href")).toContain("/workouts/3?");
    fireEvent.click(screen.getByRole("button", { name: "Previous workout" }));
    expect(selected).toHaveTextContent("205 lb");
    expect(performance).toHaveTextContent("225 lb");
    const href = new URL(within(selected).getByRole("link", { name: "View workout" }).getAttribute("href")!, "https://magni.test");
    expect(href.pathname).toBe("/workouts/2");
    expect(href.searchParams.get("returnTo")).toBe(currentHref);
    fireEvent.click(screen.getByRole("button", { name: "Previous workout" }));
    expect(selected).toHaveTextContent("245 lb");
    expect(screen.getByRole("button", { name: "Previous workout" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next workout" }));
    expect(selected).toHaveTextContent("205 lb");
  });

  it("selects a plotted workout and resets inspection on metric, period and exercise changes", () => {
    const view = render(<RecordedRepsChart points={points} truncated={false} currentHref={currentHref} metric="load:lb" overview />);
    fireEvent.click(view.container.querySelector('[data-session-id="1"]')!);
    expect(screen.getByRole("region", { name: "Selected workout" })).toHaveTextContent("245 lb");
    fireEvent.change(screen.getByRole("combobox", { name: "Chart metric" }), { target: { value: "reps" } });
    expect(within(screen.getByRole("region", { name: "Selected workout" })).getByRole("link", { name: "View workout" }).getAttribute("href")).toContain("/workouts/3?");
    fireEvent.click(screen.getByRole("button", { name: "Previous workout" }));
    view.rerender(<RecordedRepsChart points={points} truncated={false} currentHref={`${currentHref}&from=2026-10-01`} metric="load:lb" overview />);
    expect(within(screen.getByRole("region", { name: "Selected workout" })).getByRole("link", { name: "View workout" }).getAttribute("href")).toContain("/workouts/3?");
    fireEvent.click(screen.getByRole("button", { name: "Previous workout" }));
    view.rerender(<RecordedRepsChart points={points} truncated={false} currentHref="/history?exercise=e%3Abench" metric="load:lb" overview />);
    expect(within(screen.getByRole("region", { name: "Selected workout" })).getByRole("link", { name: "View workout" }).getAttribute("href")).toContain("/workouts/3?");
  });

  it("offers original-unit metrics outside the plotted cap with full-range evidence", () => {
    const older = { ...point(9, "2025-01-01", 90), unit: "kg" as const };
    const olderSummary = { ...summary, metric: "load:kg" as const, count: 1, first: evidence(older), latest: evidence(older), previous: null, best: evidence(older) };
    render(<RecordedRepsChart points={points} metricSummaries={[summary, olderSummary]} truncated currentHref={currentHref} metric="load:kg" overview />);
    expect(screen.getByRole("combobox", { name: "Chart metric" })).toHaveValue("load:kg");
    expect(screen.getByRole("region", { name: "Performance summary" })).toHaveTextContent("90 kg");
    expect(screen.getByText(/outside the plotted workouts/)).toBeVisible();
    expect(screen.queryByText(/No recorded sets/)).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Selected workout" })).getByRole("link", { name: "View workout" }).getAttribute("href")).toContain("/workouts/9?");
    expect(screen.getByRole("button", { name: "Previous workout" })).toBeDisabled();
  });

  it("uses the uncapped best and previous, and qualifies fallback best when truncated", () => {
    const older = point(9, "2025-01-01", 305);
    const view = render(<RecordedRepsChart points={[points[2]]} metricSummaries={[{ ...summary, best: evidence(older) }]} truncated currentHref={currentHref} metric="load:lb" overview />);
    expect(screen.getByRole("region", { name: "Performance summary" })).toHaveTextContent("305 lb");
    expect(screen.getByRole("region", { name: "Performance summary" })).toHaveTextContent("+20 lb");
    view.rerender(<RecordedRepsChart points={[points[2]]} truncated currentHref={currentHref} metric="load:lb" overview />);
    expect(screen.getByText("Best shown")).toBeVisible();
    expect(screen.queryByText("Best in range")).not.toBeInTheDocument();
    expect(screen.getByText(/No earlier comparable workout shown/)).toBeVisible();
  });

  it("describes one comparable result without claiming there is only one recorded workout", () => {
    render(<RecordedRepsChart points={[point(1, "2026-09-01", null), point(2, "2026-10-01", 205)]} truncated={false} currentHref={currentHref} metric="load:lb" overview />);
    expect(screen.getByText("One comparable result in this range")).toBeVisible();
    expect(screen.queryByText("One recorded workout")).not.toBeInTheDocument();
  });

  it("keeps the exact recorded decimal load in summaries, inspection and dated evidence", () => {
    const precise = [point(1, "2026-09-01", 1.25), point(2, "2026-10-01", 20.25)];
    render(<RecordedRepsChart points={precise} truncated={false} currentHref={currentHref} metric="load:lb" overview />);
    expect(screen.getByRole("region", { name: "Performance summary" })).toHaveTextContent("20.25 lb");
    expect(screen.getByRole("region", { name: "Performance summary" })).toHaveTextContent("+19 lb");
    expect(screen.getByRole("region", { name: "Selected workout" })).toHaveTextContent("20.25 lb");
    fireEvent.click(screen.getByRole("button", { name: "Previous workout" }));
    expect(screen.getByRole("region", { name: "Selected workout" })).toHaveTextContent("1.25 lb");
    fireEvent.click(screen.getByText("Dated chart values"));
    expect(screen.getByRole("table", { name: "Heaviest set by workout" })).toHaveTextContent("1.25 lb");
  });

  it("shows a genuine zero and a single workout without inventing a percentage or a PR", () => {
    render(<RecordedRepsChart points={[point(1, "2026-10-01", 0)]} truncated={false} currentHref={currentHref} metric="load:lb" overview />);
    expect(screen.getByRole("region", { name: "Performance summary" })).toHaveTextContent("0 lb");
    expect(screen.getByText("One comparable result in this range")).toBeVisible();
    expect(screen.getByRole("button", { name: "Next workout" })).toBeDisabled();
    expect(screen.queryByText(/NaN|Infinity|personal record|PR!/)).not.toBeInTheDocument();
  });
});
