// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExerciseSuggestion } from "@/features/workouts/types";
import { QuickExercisePicker } from "./QuickExercisePicker";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const suggestion = (name: string): ExerciseSuggestion => ({ name, date: "2026-08-01", catalogExerciseId: name, sessionId: 8, sets: [{ reps: 8, weight: 225.25 }] });
const advanceSearch = () => act(async () => { await vi.advanceTimersByTimeAsync(300); });
const setup = () => {
  const onAdded = vi.fn(), onError = vi.fn();
  render(<QuickExercisePicker sessionId={42} unit="kg" onAdded={onAdded} onError={onError} disabled={false} />);
  return { onAdded, onError };
};

beforeEach(() => {
  vi.useFakeTimers();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("QuickExercisePicker recent exercise search", () => {
  it("searches beyond the initial recent results without replacing custom fields", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => Promise.resolve(response(new URL(url, "https://magni.test").searchParams.get("q") === "Older squat" ? [suggestion("Older squat")] : [suggestion("Bench press")])));
    vi.stubGlobal("fetch", fetchMock);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Add exercise" }));
    await advanceSearch();
    expect(screen.getByRole("button", { name: /Bench press/ })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "225.25" } });
    fireEvent.change(screen.getByLabelText("New exercise name"), { target: { value: "Older squat" } });
    expect(screen.getByRole("status")).toHaveTextContent(/Loading|Searching/);
    expect(screen.queryByRole("button", { name: /Bench press/ })).not.toBeInTheDocument();
    await advanceSearch();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/sessions/recent-exercises?unit=kg&q=Older+squat", expect.objectContaining({ method: "GET" }));
    expect(screen.getByRole("button", { name: /Older squat/ })).toBeVisible();
    expect(screen.getByLabelText("Weight")).toHaveValue(225.25);
    expect(screen.getByLabelText("New exercise name")).toHaveValue("Older squat");
  });

  it("ignores an older response arriving after a newer search", async () => {
    let resolveOld!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const query = new URL(url, "https://magni.test").searchParams.get("q");
      if (query === "old") return new Promise<Response>(resolve => { resolveOld = resolve; });
      return Promise.resolve(response(query === "new" ? [suggestion("New row")] : []));
    }));
    setup(); fireEvent.click(screen.getByRole("button", { name: "Add exercise" }));
    fireEvent.change(screen.getByLabelText("New exercise name"), { target: { value: "old" } });
    await advanceSearch();
    fireEvent.change(screen.getByLabelText("New exercise name"), { target: { value: "new" } });
    await advanceSearch();
    expect(screen.getByRole("button", { name: /New row/ })).toBeVisible();
    await act(async () => resolveOld(response([suggestion("Old row")])));
    expect(screen.getByRole("button", { name: /New row/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Old row/ })).not.toBeInTheDocument();
  });

  it("loads suggestions for a restored draft without another Add exercise click", async () => {
    localStorage.setItem("magni.quick.42.new-exercise", JSON.stringify({ name: "Saved row", sets: "4", reps: "9", weight: "225.25" }));
    const fetchMock = vi.fn().mockResolvedValue(response([suggestion("Saved row")])); vi.stubGlobal("fetch", fetchMock);
    setup(); await advanceSearch();
    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/recent-exercises?unit=kg&q=Saved+row", expect.objectContaining({ method: "GET" }));
    expect(screen.getByRole("button", { name: /Saved row/ })).toBeVisible();
    expect(screen.getByLabelText("Sets")).toHaveValue(4);
    expect(screen.getByLabelText("Weight")).toHaveValue(225.25);
  });

  it("offers inline retry after a search error while keeping manual entry usable", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ error: "Search unavailable" }, 503)).mockResolvedValueOnce(response([])); vi.stubGlobal("fetch", fetchMock);
    const { onError } = setup(); fireEvent.click(screen.getByRole("button", { name: "Add exercise" }));
    fireEvent.change(screen.getByLabelText("New exercise name"), { target: { value: "Custom row" } });
    await advanceSearch();
    expect(screen.getByRole("alert")).toHaveTextContent("Search unavailable");
    expect(screen.getByRole("button", { name: "Add to workout" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry search" }));
    await advanceSearch();
    expect(screen.getByText(/No matching exercises/)).toBeVisible();
    expect(screen.getByLabelText("New exercise name")).toHaveValue("Custom row");
    expect(screen.getByLabelText("Sets")).toHaveValue(3);
    expect(onError).not.toHaveBeenCalled();
  });

  it("debounces name edits, bounds the query, and safely encodes it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([])); vi.stubGlobal("fetch", fetchMock);
    setup(); fireEvent.click(screen.getByRole("button", { name: "Add exercise" }));
    fireEvent.change(screen.getByLabelText("New exercise name"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("New exercise name"), { target: { value: `A & B ${"x".repeat(180)}` } });
    expect(fetchMock).not.toHaveBeenCalled(); await advanceSearch();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const params = new URL(fetchMock.mock.calls[0][0], "https://magni.test").searchParams;
    expect(params.get("q")).toBe(`A & B ${"x".repeat(134)}`);
    expect(params.get("unit")).toBe("kg");
    expect(screen.getByLabelText("New exercise name")).toHaveValue(`A & B ${"x".repeat(180)}`);
  });

  it("cancels a pending search when the form is closed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([])); vi.stubGlobal("fetch", fetchMock);
    setup(); fireEvent.click(screen.getByRole("button", { name: "Add exercise" }));
    fireEvent.change(screen.getByLabelText("New exercise name"), { target: { value: "Canceled" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await advanceSearch();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add exercise" })).toBeVisible();
    expect(localStorage.getItem("magni.quick.42.new-exercise")).toBeNull();
  });

  it("restores an exact uncertain submission without fetching or replacing it", async () => {
    const submitted = { name: "Deadlift", catalogExerciseId: "deadlift", prescription: [{ reps: 7, weight: 225.25 }], requestKey: "stored-request" };
    localStorage.setItem("magni.quick.42.new-exercise", JSON.stringify({ name: "", sets: "3", reps: "10", weight: "", requestKey: submitted.requestKey, submitted }));
    const fetchMock = vi.fn().mockResolvedValue(response({ sets: [], sessionRevision: 3 })); vi.stubGlobal("fetch", fetchMock);
    setup(); await advanceSearch();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("New exercise name")).toBeDisabled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry adding exercise" })));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(submitted);
  });

  it("keeps a suggested exercise's exact identity and prescription when retrying an uncertain write", async () => {
    const exercise = { ...suggestion("Deadlift"), sets: [{ reps: 7, weight: 225.25 }, { reps: 6, weight: 220 }] };
    const writes: string[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, options: RequestInit) => {
      if (options.method === "GET") return Promise.resolve(response([exercise]));
      writes.push(options.body as string);
      return Promise.resolve(writes.length === 1 ? response({ error: "Connection lost" }, 503) : response({ sets: [], sessionRevision: 3 }));
    }));
    const { onAdded, onError } = setup(); fireEvent.click(screen.getByRole("button", { name: "Add exercise" }));
    await advanceSearch();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Deadlift/ })));
    expect(onError).toHaveBeenLastCalledWith("Connection lost");
    expect(screen.getByLabelText("New exercise name")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Deadlift/ })).not.toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry adding exercise" })));
    expect(writes).toHaveLength(2); expect(writes[1]).toBe(writes[0]);
    expect(JSON.parse(writes[0])).toEqual({ name: "Deadlift", catalogExerciseId: exercise.catalogExerciseId, prescription: exercise.sets, requestKey: expect.any(String) });
    expect(onAdded).toHaveBeenCalledWith([], 3);
    expect(screen.getByRole("button", { name: "Add exercise" })).toBeVisible();
  });
});
