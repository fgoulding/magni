// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkoutCard } from "./WorkoutCard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("links each prior identity once despite duplicate names and preserves zero, missing load and original units", async () => {
  const known = { sessionId: 21, exerciseId: "dumbbell-row", date: "2026-09-01", unit: "kg", reps: [8, 7], topWeight: 0, bodyweight: false };
  const missing = { sessionId: 22, exerciseId: "band-row", date: "2026-09-02", unit: "kg", reps: [12], topWeight: null, hasMissingWeight: true, bodyweight: false };
  const session = {
    id: 41, status: "in_progress", unit: "lb",
    sets: [80, 81, 82].map((id, index) => ({ id, exercise_name: "Row", reps: 8, sets: 1, set_number: index + 1, rep_out_target: 8, calculated_weight: 40, actual_reps: null, actual_weight: null, superset_group: null, progression_type: "custom" })),
    lastPerformance: { "80": known, "81": known, "82": missing, Row: { ...known, sessionId: 999, topWeight: 999 } },
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(session), { status: 200, headers: { "Content-Type": "application/json" } })));
  render(<WorkoutCard resumeSessionId={41} programId={2} dayId={3} programName="Training" dayName="Upper" currentWeek={1} currentDay={1} />);
  const zero = await screen.findByRole("link", { name: "Previous Row workout, 2026-09-01: 8/7 @ 0 kg" });
  expect(zero).toHaveAttribute("href", "/workouts/21?returnTo=%2Ftoday");
  expect(zero).toHaveTextContent("Last: 8/7 @ 0 kg");
  const unknown = screen.getByRole("link", { name: "Previous Row workout, 2026-09-02: 12 reps · load not recorded" });
  expect(unknown).toHaveAttribute("href", "/workouts/22?returnTo=%2Ftoday");
  expect(unknown).toHaveTextContent("load not recorded");
  expect(screen.getAllByRole("link", { name: /^Previous Row workout/ })).toHaveLength(2);
  expect(screen.queryByText(/999/)).not.toBeInTheDocument();
});
