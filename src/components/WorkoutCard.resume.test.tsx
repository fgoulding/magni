// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkoutCard } from "./WorkoutCard";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const props = { resumeSessionId: 41, programId: 2, dayId: 3, definitionDayId: 4, programName: "Legacy", dayName: "Upper", currentWeek: 2, currentDay: 1, startLabel: "Resume workout", showSkip: false };
const session = { id: 41, status: "in_progress", unit: "kg", sets: [{ id: 80, exercise_name: "Older saved row", reps: 8, sets: 1, set_number: 1, rep_out_target: 8, calculated_weight: 42.5, actual_reps: 7, actual_weight: 42.5, superset_group: null, progression_type: "custom" }] };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("fetches the explicit legacy session instead of selecting the latest matching day/week", async () => {
  const fetchMock = vi.fn().mockResolvedValue(response(session)); vi.stubGlobal("fetch", fetchMock);
  render(<WorkoutCard {...props} />);
  await screen.findByText("Older saved row");
  expect(fetchMock).toHaveBeenCalledWith("/api/sessions/41");
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/sessions/current"))).toBe(false);
});
it("retries a failed exact resume with GET and never creates a different session", async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(response(session)); vi.stubGlobal("fetch", fetchMock);
  render(<WorkoutCard {...props} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Resume workout" }));
  await screen.findByText("Older saved row");
  expect(fetchMock.mock.calls).toHaveLength(2);
  expect(fetchMock.mock.calls[1]).toEqual(["/api/sessions/41", { method: "GET" }]);
});
it.each([{ id: 42, status: "in_progress" }, { id: 41, status: "completed" }])("rejects an unavailable exact response %j instead of starting another workout", async (unavailable) => {
  const fetchMock = vi.fn().mockResolvedValue(response({ ...session, ...unavailable })); vi.stubGlobal("fetch", fetchMock);
  render(<WorkoutCard {...props} />);
  await screen.findByText(/Could not resume this exact workout/);
  expect(screen.queryByText("Older saved row")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Resume workout" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(fetchMock.mock.calls.every(([, init]) => !init || init.method === "GET")).toBe(true);
});
