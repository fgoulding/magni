// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuickWorkout } from "./QuickWorkout";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const session = { id: 42, name: "Quick rows", date: "2026-10-11", unit: "lb" as const, sets: [{ id: 7, exercise_name: "Row", reps: 10, sets: 1, set_number: 1, rep_out_target: 10, calculated_weight: 40, actual_reps: 10, actual_weight: 40, superset_group: null }] };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  vi.clearAllMocks();
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  window.history.replaceState(null, "", "/workouts/new");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

it.each([
  "/calendar?month=2026-10&date=2026-10-11&view=month",
  "/workouts?q=upper&status=in_progress&cursor=page2",
  "/today",
])("preserves %s through creation, remount and the completion link", async returnTo => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(session, 201)).mockResolvedValueOnce(response({ volume: 400, loggedCount: 1, skippedCount: 0 })));
  const expected = `/workouts/42?returnTo=${encodeURIComponent(returnTo)}`;
  const first = render(<QuickWorkout initialSession={null} initialDate="2026-10-11" returnTo={returnTo} standalone />);
  fireEvent.click(screen.getByRole("button", { name: "Quick workout" }));
  await screen.findByRole("heading", { name: "Quick rows" });
  expect(window.location.pathname + window.location.search).toBe(expected);
  first.unmount();
  render(<QuickWorkout initialSession={session} returnTo={new URLSearchParams(window.location.search).get("returnTo")!} standalone />);
  fireEvent.click(screen.getByRole("button", { name: "Finish workout" }));
  expect(await screen.findByRole("link", { name: "View workout" })).toHaveAttribute("href", expected);
});

it("does not carry an invalid return destination into the created workout URL", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(session, 201)));
  render(<QuickWorkout initialSession={null} initialDate="2026-10-11" returnTo="https://elsewhere.test/today" standalone />);
  fireEvent.click(screen.getByRole("button", { name: "Quick workout" }));
  await screen.findByRole("heading", { name: "Quick rows" });
  expect(window.location.pathname + window.location.search).toBe("/workouts/42");
});

it.each([
  ["/calendar?month=2026-10&date=2026-10-11&view=month", "/calendar?month=2026-10&date=2026-10-11&view=month"],
  ["/workouts?q=upper&status=in_progress&cursor=page2", "/workouts?q=upper&status=in_progress&cursor=page2"],
  [undefined, "/workouts"],
  ["https://elsewhere.test/today", "/workouts"],
  ["/workouts/42?returnTo=%2Ftoday", "/today"],
  ["/workouts/42/resume", "/workouts"],
  ["/calendar?date=2026-10-11&workout=history-42", "/calendar?month=2026-10&date=2026-10-11"],
])("leaves a deleted standalone workout for %s safely", async (returnTo, expected) => {
  const fetcher = vi.fn().mockResolvedValue(response({ success: true })); vi.stubGlobal("fetch", fetcher);
  window.history.replaceState(null, "", "/workouts/42");
  render(<QuickWorkout initialSession={session} returnTo={returnTo} standalone />);
  fireEvent.click(screen.getByRole("button", { name: "Delete workout" }), { detail: 0 });
  fireEvent.click(within(screen.getByRole("dialog", { name: "Delete workout?" })).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith(expected));
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledWith("/api/sessions/42", { method: "DELETE" });
});

it("stays on a failed standalone deletion and navigates only after the explicit retry succeeds", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(response({ success: true })); vi.stubGlobal("fetch", fetcher);
  render(<QuickWorkout initialSession={session} returnTo="/today" standalone />);
  fireEvent.click(screen.getByRole("button", { name: "Delete workout" }), { detail: 0 });
  const dialog = screen.getByRole("dialog", { name: "Delete workout?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Offline");
  expect(router.replace).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/today"));
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("resets an embedded Today workout after deletion without navigating", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ success: true })));
  window.history.replaceState(null, "", "/today");
  render(<QuickWorkout initialSession={session} todayOnly />);
  fireEvent.click(screen.getByRole("button", { name: "Delete workout" }), { detail: 0 });
  fireEvent.click(within(screen.getByRole("dialog", { name: "Delete workout?" })).getByRole("button", { name: "Delete" }));
  await screen.findByRole("button", { name: "Quick workout" });
  expect(router.replace).not.toHaveBeenCalled();
  expect(window.location.pathname).toBe("/today");
});

it("returns a completed embedded Today workout to Today from its details", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ volume: 400, loggedCount: 1, skippedCount: 0 })));
  render(<QuickWorkout initialSession={session} todayOnly />);
  fireEvent.click(screen.getByRole("button", { name: "Finish workout" }));
  expect(await screen.findByRole("link", { name: "View workout" })).toHaveAttribute("href", "/workouts/42?returnTo=%2Ftoday");
});

it("starts the next standalone workout at a new-workout URL while retaining its origin", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ volume: 400, loggedCount: 1, skippedCount: 0 })));
  const returnTo = "/workouts?q=upper&status=completed";
  render(<QuickWorkout initialSession={session} returnTo={returnTo} standalone />);
  fireEvent.click(screen.getByRole("button", { name: "Finish workout" }));
  expect(await screen.findByRole("link", { name: "New" })).toHaveAttribute("href", `/workouts/new?returnTo=${encodeURIComponent(returnTo)}`);
});
