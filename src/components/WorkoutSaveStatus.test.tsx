// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkoutSaveStatus } from "./WorkoutSaveStatus";
import type { WorkoutSet } from "./workout-card-utils";
const set = (id: number, weight: number | null, unit: "lb" | "kg", count = 1): WorkoutSet => ({ id, exercise_name: "Row", reps: 5, rep_out_target: 5, sets: count, set_number: id, calculated_weight: 50, actual_reps: 5, actual_weight: weight, superset_group: null, editor_json: JSON.stringify({ unit }) });
afterEach(cleanup);
describe("workout save status", () => {
  it("keeps acknowledged volume in original units while pending inputs do not count as current saves", () => {
    render(<WorkoutSaveStatus sets={[set(1, 10, "lb", 3), set(2, 2.5, "kg")]} isSaved={row => row.id === 2} />);
    const summary = screen.getByRole("region", { name: "Workout progress" });
    expect(summary).toHaveTextContent("1 of 4 sets saved");
    expect(summary).toHaveTextContent("150 lb·reps · 12.5 kg·reps");
    expect(screen.getByRole("progressbar", { name: "Saved sets" })).toHaveAttribute("value", "1");
  });
  it("distinguishes missing load from real zero and excludes unlogged prescriptions from volume", () => {
    render(<WorkoutSaveStatus sets={[set(1, null, "lb"), set(2, 0, "kg"), { ...set(3, 50, "kg"), actual_reps: null }]} isSaved={row => row.actual_reps !== null} />);
    const summary = screen.getByRole("region", { name: "Workout progress" });
    expect(summary).toHaveTextContent("2 of 3 sets saved");
    expect(summary).toHaveTextContent("load not recorded (lb) · 0 kg·reps");
    expect(summary).not.toHaveTextContent("250");
  });
});
