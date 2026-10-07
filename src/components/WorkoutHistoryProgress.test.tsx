// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkoutHistoryDetail } from "./WorkoutHistoryDetail";
import type { WorkoutSession } from "@/features/workouts/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./WorkoutReuse", () => ({ WorkoutReuse: () => null }));
afterEach(cleanup);
const session: WorkoutSession = { id: 42, name: "Upper", date: "2026-09-01", unit: "kg", revision: 1, status: "completed", program_id: null, program_name: "", day_name: "Upper", volume: 0, loggedSets: 2, totalSets: 2, recap: null, corrections: [], sets: [
  { id: 1, exercise_name: "Row", exercise_key: "row", sort_order: 0, notes: "", editor_json: null, reps: 10, sets: 1, set_number: 1, rep_out_target: 10, calculated_weight: 40, actual_reps: 10, actual_weight: null, superset_group: null },
  { id: 2, exercise_name: "Row", exercise_key: "row", sort_order: 1, notes: "", editor_json: null, reps: 10, sets: 1, set_number: 2, rep_out_target: 10, calculated_weight: 0, actual_reps: 12, actual_weight: 0, superset_group: null },
] };

it("keeps missing load distinct from zero and links each exercise history once", () => {
  render(<WorkoutHistoryDetail initialSession={session} today="2026-09-02" progressLinks={{ 1: "/history/exercises/e%3Arow", 2: "/history/exercises/e%3Arow" }} />);
  expect(screen.getByText("10 reps · load not recorded")).toBeVisible();
  expect(screen.getByText("12 reps at 0 kg")).toBeVisible();
  expect(screen.getAllByRole("link", { name: "View progress for Row" })).toHaveLength(1);
  expect(screen.getByRole("link", { name: "View progress for Row" })).toHaveAttribute("href", "/history/exercises/e%3Arow");
});
