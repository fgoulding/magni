// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const queries = vi.hoisted(() => ({ listProgressExercises: vi.fn(), listProgressPrograms: vi.fn(), getProgressHome: vi.fn(), getExerciseDetail: vi.fn(), listUnlinkedExercises: vi.fn(), resolveUnlinkedExerciseId: vi.fn() }));
vi.mock("@/features/progress/queries", () => queries);
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ id: 7 }) }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT ${href}`); } }));
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
    queries.getProgressHome.mockReturnValue({ pinned: [{ id: "first" }], recent: [] });
    queries.getExerciseDetail.mockReturnValue({ exercise: { name: "Selected row" } });
    const result = await ProgressPage({ searchParams: Promise.resolve({ exercise: "e:chosen", period: "4w" }) });
    expect(queries.getExerciseDetail).toHaveBeenCalledWith(7, "chosen", { period: "4w", limit: 2 });
    expect(result.props.selectedKey).toBe("e:chosen");
    expect(result.props.currentHref).toBe("/history?exercise=e%3Achosen&period=4w");
  });
  it("opens a single recorded exercise from an existing name-group URL without requiring grouping", async () => {
    queries.getProgressHome.mockReturnValue({ pinned: [], recent: [] });
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
  it("defaults to the first pin, then a proven recent exercise, without merging an unlinked name group", async () => {
    queries.getProgressHome.mockReturnValue({ pinned: [{ id: "favorite" }], recent: [] });
    expect((await ProgressPage({ searchParams: Promise.resolve({}) })).props.selectedKey).toBe("e:favorite");
    queries.getProgressHome.mockReturnValue({ pinned: [], recent: [{ key: "u:Um93", kind: "unlinked", name: "Row", exercise: null }, { key: "e:proven", kind: "exercise", exercise: { origin: "lineage" } }] });
    expect((await ProgressPage({ searchParams: Promise.resolve({}) })).props.selectedKey).toBe("e:proven");
    queries.getExerciseDetail.mockClear();
    queries.getProgressHome.mockReturnValue({ pinned: [], recent: [{ key: "u:Um93", kind: "unlinked", name: "Row", exercise: null }] });
    const unlinked = await ProgressPage({ searchParams: Promise.resolve({}) });
    expect(unlinked.props.selectedKey).toBe("u:Um93");
    expect(unlinked.props.detail).toBeNull();
    expect(queries.getExerciseDetail).not.toHaveBeenCalled();
  });
  it("shows an unavailable explicit selection instead of silently choosing a different exercise", async () => {
    queries.getProgressHome.mockReturnValue({ pinned: [{ id: "favorite" }], recent: [] });
    const result = await ProgressPage({ searchParams: Promise.resolve({ exercise: "e:someone-elses" }) });
    expect(result.props.selectionError).toContain("unavailable");
    expect(result.props.selectedKey).toBe("e:someone-elses");
    expect(result.props.detail).toBeNull();
  });
  it("retains only a valid chart metric in source return context", async () => {
    queries.getProgressHome.mockReturnValue({ pinned: [{ id: "favorite" }], recent: [] });
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
