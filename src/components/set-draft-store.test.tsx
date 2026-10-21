// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuickWorkout } from "./QuickWorkout";
import { isDraftVolatile, parseDrafts, readDraftSnapshot, subscribeDrafts, writeDrafts } from "./planned-workout-drafts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
const session = { id: 1901, sets: [{ id: 7, exercise_name: "Row", reps: 10, sets: 1, set_number: 1, rep_out_target: 10, calculated_weight: 40, actual_reps: null, actual_weight: null, superset_group: null }] };
const plannedKey = "magni.planned-workout.1901.draft.v1";
const quickKey = "magni.quick-workout.1901.draft.v1";
beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); writeDrafts(1901, {}); });

it("preserves distinct planned and Quick baselines, namespaces and same-tab notifications", () => {
  const planned = { 7: { reps: "8", weight: "42.5", expectedActual: { reps: null, weight: null }, intent: "undo" as const } };
  const quick = { 7: { reps: "9", weight: "45.5", base: { reps: null, weight: null } } };
  const listener = vi.fn(); const unsubscribe = subscribeDrafts(listener);
  const quickListener = vi.fn(); window.addEventListener("magni-quick-draft-changed", quickListener);
  expect(writeDrafts(1901, planned)).toBe(true);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(parseDrafts(readDraftSnapshot(1901))).toEqual(planned);
  localStorage.setItem(quickKey, JSON.stringify(quick));
  render(<QuickWorkout initialSession={session} />);
  expect(screen.getByRole("spinbutton", { name: "Reps for set 1" })).toHaveValue(9);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Weight for set 1" }), { target: { value: "47.5" } });
  expect(JSON.parse(localStorage.getItem(quickKey)!)[7]).toMatchObject({ weight: "47.5", base: { reps: null, weight: null } });
  expect(localStorage.getItem(plannedKey)).toBe(JSON.stringify(planned));
  expect(quickListener).toHaveBeenCalledTimes(1); expect(listener).toHaveBeenCalledTimes(1);
  localStorage.setItem(quickKey, JSON.stringify({ 7: { ...quick[7], reps: "11" } }));
  act(() => window.dispatchEvent(new Event("storage")));
  expect(screen.getByRole("spinbutton", { name: "Reps for set 1" })).toHaveValue(11);
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe(); window.removeEventListener("magni-quick-draft-changed", quickListener);
});

it("ignores corrupt entries without losing valid drafts in either format", () => {
  const entries = { 7: { reps: "8", weight: "42.5", intent: "retained", base: { reps: null, weight: null }, expectedActual: { reps: null, weight: null } }, 8: { reps: 8, weight: "40" }, 9: null, bad: { reps: "4", weight: "10" } };
  expect(parseDrafts(JSON.stringify(entries))).toEqual({ 7: entries[7] });
  expect(parseDrafts("broken")).toEqual({}); expect(parseDrafts("[]")).toEqual({});
  localStorage.setItem(quickKey, JSON.stringify(entries));
  render(<QuickWorkout initialSession={session} />);
  expect(screen.getByRole("spinbutton", { name: "Reps for set 1" })).toHaveValue(8);
  expect(screen.getByRole("spinbutton", { name: "Weight for set 1" })).toHaveValue(42.5);
});

it("keeps blocked-storage drafts available, notifies subscribers and clears the fallback after persistence recovers", () => {
  const listener = vi.fn(); const unsubscribe = subscribeDrafts(listener);
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Full"); });
  const draft = { 7: { reps: "8", weight: "42.5" } };
  expect(writeDrafts(1901, draft)).toBe(false); expect(isDraftVolatile(1901)).toBe(true);
  expect(parseDrafts(readDraftSnapshot(1901))).toEqual(draft); expect(listener).toHaveBeenCalledTimes(1);
  const first = render(<QuickWorkout initialSession={session} />);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Reps for set 1" }), { target: { value: "9" } });
  first.unmount(); render(<QuickWorkout initialSession={session} />);
  expect(screen.getByRole("spinbutton", { name: "Reps for set 1" })).toHaveValue(9);
  storage.mockRestore();
  expect(writeDrafts(1901, {})).toBe(true); expect(isDraftVolatile(1901)).toBe(false); expect(localStorage.getItem(plannedKey)).toBeNull();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Reps for set 1" }), { target: { value: "10" } });
  expect(JSON.parse(localStorage.getItem(quickKey)!)[7].reps).toBe("10");
  unsubscribe();
});
