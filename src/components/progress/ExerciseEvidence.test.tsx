// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ExerciseObservation } from "@/features/progress/types";
import { ExerciseEvidence, RecordedRepsChart } from "./ExerciseEvidence";
import { chartDatePosition } from "./ExerciseProgressChart";

afterEach(cleanup);
const observation: ExerciseObservation = { sessionId: 42, date: "2026-09-02", unit: "kg", workoutName: "Pull day", programName: "Unplanned workouts", programId: null, recordedNames: ["Band row"], recordedSets: 3, totalReps: 12, volume: 0, missingWeightSets: 1, bestE1rm: null, topWeight: 0, sets: [{ setId: 1, name: "Band row", reps: 0, weight: 0, unit: "kg", count: 1, role: null, loadMode: null }, { setId: 2, name: "Band row", reps: 12, weight: null, unit: "kg", count: 1, role: null, loadMode: null }] };

describe("exercise evidence", () => {
  it("distinguishes zero load and a zero-rep attempt from missing load, preserving original units and source context", () => {
    render(<ExerciseEvidence observations={[observation]} currentHref="/history/exercises/e%3Arow?cursor=older" />);
    expect(screen.getByText("0 reps · 0 kg")).toBeVisible();
    expect(screen.getByText("12 reps · load not recorded")).toBeVisible();
    expect(screen.getByRole("link", { name: "View workout" })).toHaveAttribute("href", "/workouts/42?returnTo=%2Fhistory%2Fexercises%2Fe%253Arow%3Fcursor%3Dolder");
    expect(screen.queryByText(/estimated/i)).not.toBeInTheDocument();
  });
  it("keeps same-day sessions separate and exposes every dated chart value without relying on color", () => {
    render(<RecordedRepsChart points={[{ sessionId: 42, date: "2026-09-02", unit: "kg", bestE1rm: null, bestE1rmLb: null, totalReps: 0, recordedSets: 1 }, { sessionId: 43, date: "2026-09-02", unit: "kg", bestE1rm: null, bestE1rmLb: null, totalReps: 12, recordedSets: 1 }]} truncated={false} currentHref="/history/exercises/e%3Arow" />);
    const rows = within(screen.getByRole("table", { name: "Recorded reps by workout" })).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText("0")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Workout 42" })).toHaveAttribute("href", expect.stringContaining("/workouts/42?"));
    expect(screen.getByRole("link", { name: "Workout 43" })).toHaveAttribute("href", expect.stringContaining("/workouts/43?"));
  });
  it("spaces dated evidence by elapsed time and offers original-unit estimates without filling missing values with zero", () => {
    expect(chartDatePosition("2026-01-02", "2026-01-01", "2026-01-11")).toBeCloseTo(41);
    render(<RecordedRepsChart points={[
      { sessionId: 1, date: "2026-01-01", unit: "kg", bestE1rm: 50, bestE1rmLb: 110.2, totalReps: 6, recordedSets: 1 },
      { sessionId: 2, date: "2026-01-02", unit: "kg", bestE1rm: null, bestE1rmLb: null, totalReps: 12, recordedSets: 1 },
      { sessionId: 3, date: "2026-01-11", unit: "lb", bestE1rm: 100, bestE1rmLb: 100, totalReps: 6, recordedSets: 1 },
    ]} truncated={false} currentHref="/history/exercises/e%3Arow" />);
    expect(screen.getByRole("combobox", { name: "Chart metric" })).toHaveValue("estimate:kg");
    fireEvent.click(screen.getByText("Dated chart values", { exact: true }));
    expect(screen.getByText(/Epley estimate/)).toBeVisible();
    const table = screen.getByRole("table", { name: "Estimated max by workout" });
    expect(within(table).getByText("50 kg")).toBeInTheDocument();
    expect(within(table).getByText("Not available")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Chart metric" }), { target: { value: "reps" } });
    expect(screen.getByRole("table", { name: "Recorded reps by workout" })).toBeInTheDocument();
  });

  it("keeps old and recent clustered workout dates from overlapping while preserving every point and dated value", () => {
    const dates = ["2026-05-12", "2026-09-30", "2026-10-07"];
    const { container } = render(<RecordedRepsChart points={dates.map((date, index) => ({ sessionId: index + 1, date, unit: "lb", bestE1rm: null, bestE1rmLb: null, totalReps: 5 + index, recordedSets: 1 }))} truncated={false} currentHref="/history?exercise=e%3Adeadlift" />);
    expect([...container.querySelectorAll('svg text[y="158"]')].map(label => label.textContent)).toEqual(["May 12", "Oct 7"]);
    const positions = [...container.querySelectorAll("svg circle")].map(point => Number(point.getAttribute("cx")));
    expect(positions).toHaveLength(3);
    expect(positions[2] - positions[1]).toBeLessThan(20);
    expect(positions[1] - positions[0]).toBeGreaterThan(240);
    fireEvent.click(screen.getByText("Dated chart values", { exact: true }));
    const table = screen.getByRole("table", { name: "Recorded reps by workout" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByRole("link", { name: "Workout 2" })).toBeVisible();
    expect(table.querySelector('time[datetime="2026-09-30"]')).toBeVisible();
  });
  it("uses a safely spaced central date instead of the middle workout in a recent cluster", () => {
    const dates = ["2026-05-12", "2026-07-15", "2026-09-27", "2026-09-29", "2026-10-01", "2026-10-07"];
    const { container } = render(<RecordedRepsChart points={dates.map((date, index) => ({ sessionId: index + 1, date, unit: "lb", bestE1rm: null, bestE1rmLb: null, totalReps: 5, recordedSets: 1 }))} truncated={false} currentHref="/history" />);
    expect([...container.querySelectorAll('svg text[y="158"]')].map(label => label.textContent)).toEqual(["May 12", "Jul 15", "Oct 7"]);
  });

  it("falls back to recorded reps when a changed period no longer has an estimated-max series", () => {
    const weighted = { sessionId: 1, date: "2026-01-01", unit: "kg" as const, bestE1rm: 50, bestE1rmLb: 110.2, totalReps: 6, recordedSets: 1 };
    const view = render(<RecordedRepsChart points={[weighted]} truncated={false} currentHref="/history/exercises/e%3Arow" />);
    expect(screen.getByRole("heading", { name: "Estimated max" })).toBeVisible();
    view.rerender(<RecordedRepsChart points={[{ ...weighted, bestE1rm: null, bestE1rmLb: null }]} truncated={false} currentHref="/history/exercises/e%3Arow?from=2026-01-01" />);
    expect(screen.getByRole("heading", { name: "Recorded reps" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Chart metric" })).toHaveValue("reps");
  });

  it("offers heaviest completed load in original units while leaving missing attempts unavailable", () => {
    render(<RecordedRepsChart points={[
      { sessionId: 1, date: "2026-01-01", unit: "kg", bestE1rm: null, bestE1rmLb: null, topWeight: 0, totalReps: 10, recordedSets: 1 },
      { sessionId: 2, date: "2026-01-02", unit: "kg", bestE1rm: null, bestE1rmLb: null, topWeight: null, totalReps: 0, recordedSets: 1 },
    ]} truncated={false} currentHref="/history?exercise=e%3Arow" />);
    fireEvent.change(screen.getByRole("combobox", { name: "Chart metric" }), { target: { value: "load:kg" } });
    fireEvent.click(screen.getByText("Dated chart values", { exact: true }));
    const table = screen.getByRole("table", { name: "Heaviest set by workout" });
    expect(within(table).getByText("0 kg")).toBeVisible();
    expect(within(table).getByText("Not available")).toBeVisible();
  });

});
