// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const queries = vi.hoisted(() => ({ listProgressExercises: vi.fn(), listProgressPrograms: vi.fn(), getProgressHome: vi.fn(), getExerciseDetail: vi.fn(), listUnlinkedExercises: vi.fn(), resolveUnlinkedExerciseId: vi.fn() }));
vi.mock("@/features/progress/queries", () => queries);
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ id: 7 }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: (href: string) => { throw new Error(`REDIRECT ${href}`); } }));
import FinderPage from "@/app/history/exercises/page";
import ProgressPage from "@/app/history/page";
import LegacyPage from "@/app/history/[lift]/page";
import ExercisePage from "@/app/history/exercises/[key]/page";

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); queries.listProgressExercises.mockReturnValue({ items: [], nextCursor: null }); queries.listProgressPrograms.mockReturnValue({ items: [], nextCursor: null }); queries.listUnlinkedExercises.mockReturnValue({ items: [], nextCursor: null }); queries.getExerciseDetail.mockReturnValue(null); queries.resolveUnlinkedExerciseId.mockReturnValue(null); });
describe("Progress page discovery boundaries", () => {
  it("does not request or render the full library on initial finder entry", async () => {
    render(await FinderPage({ searchParams: Promise.resolve({}) }));
    expect(queries.listProgressExercises).not.toHaveBeenCalled();
    expect(queries.listProgressPrograms).not.toHaveBeenCalled();
    expect(screen.getByRole("searchbox", { name: "Search exercises" })).toHaveValue("");
    expect(screen.getByRole("link", { name: "Browse A–Z" })).toBeVisible();
    expect(screen.queryAllByTestId("progress-exercise-row")).toHaveLength(0);
  });
  it("requests program groups only after choosing program browse", async () => {
    render(await FinderPage({ searchParams: Promise.resolve({ browse: "programs" }) }));
    expect(queries.listProgressPrograms).toHaveBeenCalledWith(7, expect.any(Object));
    expect(queries.listProgressExercises).not.toHaveBeenCalled();
  });
  it("preserves the entered query and explains no matches without claiming the history is empty", async () => {
    render(await FinderPage({ searchParams: Promise.resolve({ q: "Very old row", programId: "3", from: "2024-01-01" }) }));
    expect(queries.listProgressExercises).toHaveBeenCalledWith(7, expect.objectContaining({ search: "Very old row", programId: 3, from: "2024-01-01" }));
    expect(screen.getByRole("searchbox", { name: "Search exercises" })).toHaveValue("Very old row");
    expect(screen.getByText("No matches for “Very old row” in this scope.")).toBeVisible();
    expect(screen.queryByText("Your training starts here")).not.toBeInTheDocument();
  });
  it("routes both legacy name URLs to discovery, never a merged name-based chart", async () => {
    await expect(ProgressPage({ searchParams: Promise.resolve({ lift: "Row + band" }) })).rejects.toThrow("REDIRECT /history/exercises?q=Row%20%2B%20band");
    await expect(LegacyPage({ params: Promise.resolve({ lift: "Row + band" }) })).rejects.toThrow("REDIRECT /history/exercises?q=Row%20%2B%20band");
    await expect(LegacyPage({ params: Promise.resolve({ lift: "Row%20%2B%20band" }) })).rejects.toThrow("REDIRECT /history/exercises?q=Row%20%2B%20band");
    expect(queries.getProgressHome).not.toHaveBeenCalled();
  });
  it("uses an owned explicit catalog selection and bounds its workout observations to two", async () => {
    queries.getProgressHome.mockReturnValue({ primary: [], pinned: [{ id: "first" }], recent: [] });
    queries.getExerciseDetail.mockReturnValue({ exercise: { name: "Selected row" } });
    const result = await ProgressPage({ searchParams: Promise.resolve({ exercise: "e:chosen", period: "4w" }) });
    expect(queries.getExerciseDetail).toHaveBeenCalledWith(7, "chosen", { period: "4w", limit: 2 });
    expect(result.props.selectedKey).toBe("e:chosen");
    expect(result.props.currentHref).toBe("/history?exercise=e%3Achosen&period=4w");
  });
  it("opens a single recorded exercise from an existing name-group URL without requiring grouping", async () => {
    queries.getProgressHome.mockReturnValue({ primary: [], pinned: [], recent: [] });
    queries.resolveUnlinkedExerciseId.mockReturnValue("single-row");
    const detail = { exercise: { name: "Single leg abducted DL" } };
    queries.getExerciseDetail.mockReturnValue(detail);
    const result = await ProgressPage({ searchParams: Promise.resolve({ exercise: "u:cm93", period: "4w", metric: "load:lb" }) });
    expect(queries.resolveUnlinkedExerciseId).toHaveBeenCalledWith(7, "u:cm93");
    expect(result.props.selectedKey).toBe("e:single-row");
    expect(result.props.detail).toBe(detail);
    expect(result.props.currentHref).toBe("/history?exercise=e%3Asingle-row&period=4w&metric=load%3Alb");
    expect(queries.listUnlinkedExercises).not.toHaveBeenCalled();
  });
  it("updates an old single-exercise detail link while retaining filters and return context", async () => {
    queries.resolveUnlinkedExerciseId.mockReturnValue("single-row");
    const returnTo = "/history?exercise=u%3Acm93&period=all&metric=load%3Alb";
    const result = ExercisePage({ params: Promise.resolve({ key: "u:cm93" }), searchParams: Promise.resolve({ from: "2026-09-01", to: "2026-10-06", cursor: "old-group-page", returnTo }) });
    await expect(result).rejects.toThrow(`REDIRECT /history/exercises/e%3Asingle-row?from=2026-09-01&to=2026-10-06&returnTo=${encodeURIComponent(returnTo)}`);
    expect(queries.resolveUnlinkedExerciseId).toHaveBeenCalledWith(7, "u:cm93");
    expect(queries.listUnlinkedExercises).not.toHaveBeenCalled();
  });
  it("defaults to all history and the first recorded primary lift, ignoring pin/recent order", async () => {
    queries.getProgressHome.mockReturnValue({ pinned: [{ id: "favorite" }], recent: [{ key: "e:recent" }], primary: [{ key: "p:squat", name: "Squat", hasHistory: false, exercise: { id: "squat", recordedSets: 0 } }, { key: "p:bench", name: "Bench", hasHistory: true, exercise: { id: "bench", recordedSets: 3 } }, { key: "p:deadlift", name: "Deadlift", hasHistory: true, exercise: { id: "deadlift", recordedSets: 10 } }] });
    const result = await ProgressPage({ searchParams: Promise.resolve({}) });
    expect(queries.getProgressHome).toHaveBeenCalledWith(7, { period: "all" });
    expect(result.props.selectedKey).toBe("e:bench");
    expect(result.props.period).toBe("all");
    expect(queries.getExerciseDetail).toHaveBeenCalledWith(7, "bench", { period: "all", limit: 2 });
  });
  it("defaults to the first primary with history even when its variations are intentionally separate", async () => {
    queries.getProgressHome.mockReturnValue({ pinned: [], recent: [], primary: [{ key: "p:squat", name: "Squat", hasHistory: true, exercise: null }, { key: "p:bench", name: "Bench", hasHistory: true, exercise: { id: "bench", recordedSets: 3 } }] });
    const result = await ProgressPage({ searchParams: Promise.resolve({ period: "4w", metric: "load:kg" }) });
    expect(result.props.selectedKey).toBe("p:squat");
    expect(result.props.selectedName).toBe("Squat");
    expect(result.props.selectionError).toBeUndefined();
    expect(result.props.detail).toBeNull();
    expect(result.props.currentHref).toBe("/history?exercise=p%3Asquat&period=4w&metric=load%3Akg");
    expect(queries.getExerciseDetail).not.toHaveBeenCalled();
  });
  it("waits for a choice when no primary lift has recorded history", async () => {
    queries.getProgressHome.mockReturnValue({ pinned: [{ id: "favorite" }], recent: [{ key: "e:recent" }], primary: [{ key: "p:squat", name: "Squat", hasHistory: false, exercise: null }, { key: "p:bench", name: "Bench", hasHistory: false, exercise: null }, { key: "p:deadlift", name: "Deadlift", hasHistory: false, exercise: null }] });
    const result = await ProgressPage({ searchParams: Promise.resolve({}) });
    expect(result.props.selectedKey).toBe("");
    expect(result.props.detail).toBeNull();
    expect(queries.getExerciseDetail).not.toHaveBeenCalled();
  });
  it("preserves an explicit empty primary choice and resolves it when history becomes available", async () => {
    queries.getProgressHome.mockReturnValue({ pinned: [], recent: [], primary: [{ key: "p:squat", name: "Squat", hasHistory: false, exercise: null }, { key: "p:bench", name: "Bench", hasHistory: false, exercise: null }, { key: "p:deadlift", name: "Deadlift", hasHistory: false, exercise: null }] });
    const empty = await ProgressPage({ searchParams: Promise.resolve({ exercise: "p:bench", period: "12w" }) });
    expect(empty.props.selectedKey).toBe("p:bench");
    expect(empty.props.selectedName).toBe("Bench");
    expect(empty.props.selectionError).toBeUndefined();
    expect(empty.props.period).toBe("12w");
    queries.getProgressHome.mockReturnValue({ pinned: [], recent: [], primary: [{ key: "p:bench", name: "Bench", hasHistory: true, exercise: { id: "bench", recordedSets: 1 } }] });
    const recorded = await ProgressPage({ searchParams: Promise.resolve({ exercise: "p:bench" }) });
    expect(recorded.props.selectedKey).toBe("e:bench");
    expect(queries.getExerciseDetail).toHaveBeenCalledWith(7, "bench", { period: "all", limit: 2 });
  });
  it("shows an unavailable explicit selection instead of silently choosing a different exercise", async () => {
    queries.getProgressHome.mockReturnValue({ primary: [], pinned: [{ id: "favorite" }], recent: [] });
    const result = await ProgressPage({ searchParams: Promise.resolve({ exercise: "e:someone-elses" }) });
    expect(result.props.selectionError).toContain("unavailable");
    expect(result.props.selectedKey).toBe("e:someone-elses");
    expect(result.props.detail).toBeNull();
  });
  it("retains only a valid chart metric in source return context", async () => {
    queries.getProgressHome.mockReturnValue({ primary: [], pinned: [{ id: "favorite" }], recent: [] });
    const result = await ProgressPage({ searchParams: Promise.resolve({ metric: "load:kg" }) });
    expect(result.props.initialMetric).toBe("load:kg");
    expect(result.props.currentHref).toContain("metric=load%3Akg");
    const invalid = await ProgressPage({ searchParams: Promise.resolve({ metric: "unrecognised" }) });
    expect(invalid.props.initialMetric).toBeUndefined();
    expect(invalid.props.currentHref).not.toContain("metric=");
  });
  it("keeps the graph context through finder forms and browse links", async () => {
    const returnTo = "/history?exercise=e%3Arow&period=all&metric=load%3Akg";
    render(await FinderPage({ searchParams: Promise.resolve({ returnTo }) }));
    expect(screen.getByRole("link", { name: "Back to Progress" })).toHaveAttribute("href", returnTo);
    expect(new URL(screen.getByRole("link", { name: "Browse A–Z" }).getAttribute("href")!, "https://magni.test").searchParams.get("returnTo")).toBe(returnTo);
    expect(document.querySelector('input[name="returnTo"]')).toHaveValue(returnTo);
  });

});

describe("exercise history descriptions", () => {
  it("presents separate variations by exercise name with a direct history choice", async () => {
    queries.listUnlinkedExercises.mockReturnValue({ items: [{ id: 1, sessionId: 2, date: "2026-06-01", recordedName: "Row", workoutName: "Pull day", programName: "Dumbbell program", exerciseId: "row-a", exerciseName: "Row", latest: null, recordedSets: 1 }], nextCursor: null });
    render(await ExercisePage({ params: Promise.resolve({ key: "u:Um93" }), searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Choose a variation")).toBeVisible();
    expect(screen.getByRole("link", { name: "Combine exercise history" })).toBeVisible();
    expect(screen.getByRole("link", { name: "View exercise history" })).toHaveAttribute("href", expect.stringContaining("/history/exercises/e%3Arow-a"));
    expect(screen.getByText("Dumbbell program")).toBeVisible();
  });
  it("shows plain exercise names in search even when variations need review", async () => {
    queries.listProgressExercises.mockReturnValue({ items: [{ key: "u:Um93", kind: "unlinked", name: "Row", historyCount: 2, lastDate: "2026-06-01", latest: null, context: "Dumbbell / barbell" }], nextCursor: null });
    render(await FinderPage({ searchParams: Promise.resolve({ q: "row" }) }));
    expect(screen.getByRole("heading", { name: "Row" })).toBeVisible();
    expect(screen.getByText(/Choose a variation/)).toHaveTextContent("Dumbbell / barbell");
    expect(screen.queryByText(/Records named/)).not.toBeInTheDocument();
  });
  it("offers all exercise history when custom date filters hide every workout", async () => {
    queries.getProgressHome.mockReturnValue({ pinned: [] });
    queries.getExerciseDetail.mockReturnValue({ exercise: { id: "row", name: "Row", origin: "confirmed", pinned: false }, observations: { items: [], nextCursor: null }, chart: { points: [], truncated: false } });
    render(await ExercisePage({ params: Promise.resolve({ key: "e:row" }), searchParams: Promise.resolve({ from: "2026-09-01", to: "2026-09-30", returnTo: "/history?exercise=e%3Arow&period=4w" }) }));
    expect(screen.getByText("No Row workouts in this range")).toBeVisible();
    const all = new URL(screen.getByRole("link", { name: "Show all history" }).getAttribute("href")!, "https://magni.test");
    expect(all.searchParams.get("from")).toBeNull();
    expect(all.searchParams.get("to")).toBeNull();
    expect(all.searchParams.get("returnTo")).toBe("/history?exercise=e%3Arow&period=4w");
  });
});
