// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExerciseChooser } from "./ExerciseChooser";
import type { ExerciseFinderItem, ProgressPrimaryExercise } from "@/features/progress/types";
const item = (name: string): ExerciseFinderItem => ({ key: `u:${name}`, kind: "unlinked", name, exercise: null, historyCount: 1, lastDate: "2026-10-01", latest: null, context: "Recorded workout" });
const primary: ProgressPrimaryExercise[] = [{ key: "p:squat", name: "Squat", hasHistory: false, exercise: null }, { key: "p:bench", name: "Bench", hasHistory: false, exercise: null }, { key: "p:deadlift", name: "Deadlift", hasHistory: false, exercise: null }];
beforeEach(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("bounded graph exercise chooser", () => {
  it("does not request the full library when opened and lets an exact result be chosen", () => {
    const request = vi.fn(); vi.stubGlobal("fetch", request); const choose = vi.fn();
    render(<ExerciseChooser primary={primary} selectedKey="" onChoose={choose} onClose={vi.fn()} />);
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByTestId("exercise-choice")[0]);
    expect(choose).toHaveBeenCalledWith("p:squat");
  });
  it("starts with exactly three primary lifts and focuses the heading without opening the keyboard", () => {
    render(<ExerciseChooser primary={primary} selectedKey="" onChoose={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getAllByTestId("exercise-choice").map(row => row.textContent)).toEqual(["SquatNo recorded history", "BenchNo recorded history", "DeadliftNo recorded history"]);
    expect(screen.getByRole("heading", { name: "Exercises" })).toHaveFocus();
    expect(screen.getByRole("searchbox")).not.toHaveFocus();
  });
  it("distinguishes saved separate histories from a genuinely empty primary lift", () => {
    const choose = vi.fn();
    render(<ExerciseChooser primary={primary.map(item => item.key === "p:deadlift" ? { ...item, hasHistory: true } : item)} selectedKey="p:deadlift" onChoose={choose} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Squat/ })).toHaveTextContent("No recorded history");
    const deadlift = screen.getByRole("button", { name: /Deadlift/ });
    expect(deadlift).toHaveTextContent("Choose a variation");
    expect(deadlift).not.toHaveTextContent("No recorded history");
    fireEvent.click(deadlift);
    expect(choose).toHaveBeenCalledWith("p:deadlift");
  });
  it("searches all history in bounded pages and restores the primary lifts when cleared", async () => {
    const request = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ items: [item("Old row")], nextCursor: "page-two" }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ items: [item("Other row")], nextCursor: null, previousCursor: "" }) });
    vi.stubGlobal("fetch", request);
    render(<ExerciseChooser primary={primary} selectedKey="" onChoose={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "row" } });
    expect(await screen.findByText("Old row")).toBeVisible();
    expect(request.mock.calls[0][0]).not.toMatch(/period|from=|to=/);
    fireEvent.click(screen.getByRole("button", { name: "Next results" }));
    expect(await screen.findByText("Other row")).toBeVisible();
    expect(screen.queryByText("Old row")).not.toBeInTheDocument();
    expect(request.mock.calls[1][0]).toContain("cursor=page-two");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getAllByTestId("exercise-choice")).toHaveLength(3);
    expect(screen.getByRole("button", { name: /Squat/ })).toBeVisible();
    expect(screen.queryByText("Other row")).not.toBeInTheDocument();
  });
  it("aborts stale search and ignores an older response even if it arrives after the newer result", async () => {
    const pending: { signal: AbortSignal; resolve: (value: unknown) => void }[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, options: { signal: AbortSignal }) => new Promise(resolve => pending.push({ signal: options.signal, resolve }))));
    render(<ExerciseChooser primary={primary} selectedKey="" onChoose={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search exercises" }), { target: { value: "old" } });
    await waitFor(() => expect(pending).toHaveLength(1));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search exercises" }), { target: { value: "new" } });
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0].signal.aborted).toBe(true);
    await act(async () => pending[1].resolve({ ok: true, json: async () => ({ items: [item("New result")], nextCursor: null, previousCursor: null }) }));
    await act(async () => pending[0].resolve({ ok: true, json: async () => ({ items: [item("Old result")], nextCursor: null, previousCursor: null }) }));
    expect(screen.getByText("New result")).toBeVisible();
    expect(screen.queryByText("Old result")).not.toBeInTheDocument();
  });
  it("keeps the query after failure and offers retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    render(<ExerciseChooser primary={primary} selectedKey="" onChoose={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search exercises" }), { target: { value: "bench" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not search");
    expect(screen.getByRole("searchbox", { name: "Search exercises" })).toHaveValue("bench");
    expect(screen.getByRole("button", { name: "Retry search" })).toBeVisible();
  });
});
