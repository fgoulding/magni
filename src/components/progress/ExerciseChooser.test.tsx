// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExerciseChooser } from "./ExerciseChooser";
import type { ExerciseFinderItem } from "@/features/progress/types";
const item = (name: string): ExerciseFinderItem => ({ key: `u:${name}`, kind: "unlinked", name, exercise: null, historyCount: 1, lastDate: "2026-10-01", latest: null, context: "Recorded workout" });
beforeEach(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("bounded graph exercise chooser", () => {
  it("does not request the full library when opened and lets an exact result be chosen", () => {
    const request = vi.fn(); vi.stubGlobal("fetch", request); const choose = vi.fn();
    render(<ExerciseChooser initialItems={[item("Row")]} selectedKey="" onChoose={choose} onClose={vi.fn()} />);
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("exercise-choice"));
    expect(choose).toHaveBeenCalledWith("u:Row");
  });
  it("aborts stale search and ignores an older response even if it arrives after the newer result", async () => {
    const pending: { signal: AbortSignal; resolve: (value: unknown) => void }[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, options: { signal: AbortSignal }) => new Promise(resolve => pending.push({ signal: options.signal, resolve }))));
    render(<ExerciseChooser initialItems={[]} selectedKey="" onChoose={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search exercises" }), { target: { value: "old" } });
    await waitFor(() => expect(pending).toHaveLength(1));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search exercises" }), { target: { value: "new" } });
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0].signal.aborted).toBe(true);
    await act(async () => pending[1].resolve({ ok: true, json: async () => ({ items: [item("New result")], nextCursor: null, previousCursor: null }) }));
    await act(async () => pending[0].resolve({ ok: true, json: async () => ({ items: [item("Old result")], nextCursor: null, previousCursor: null }) }));
    expect(screen.getByText("Records named New result")).toBeVisible();
    expect(screen.queryByText("Records named Old result")).not.toBeInTheDocument();
  });
  it("keeps the query after failure and offers retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    render(<ExerciseChooser initialItems={[]} selectedKey="" onChoose={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search exercises" }), { target: { value: "bench" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not search");
    expect(screen.getByRole("searchbox", { name: "Search exercises" })).toHaveValue("bench");
    expect(screen.getByRole("button", { name: "Retry search" })).toBeVisible();
  });
});
