// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CandidateObservation } from "@/features/progress/types";
import { IdentitySelection } from "./IdentitySelection";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
const candidate = (id: number): CandidateObservation => ({ id, sessionId: id, date: "2026-10-01", recordedName: "Row", workoutName: `Workout ${id}`, programName: "Unplanned workouts", exerciseId: `old-${id}`, exerciseName: "Row", revision: 1, latest: { sessionId: id, date: "2026-10-01", weight: 0, reps: 12, unit: "kg", setId: id }, recordedSets: 1 });
describe("explicit workout grouping", () => {
  it("starts a name group with no selections and retains checked records across replacing pages", async () => {
    const request = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ items: [candidate(3)], nextCursor: null }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ token: "t", targetName: "Row", observations: [candidate(1), candidate(2)], observationCount: 2, sessionCount: 2, explanation: "Selected records only." }) });
    vi.stubGlobal("fetch", request);
    render(<IdentitySelection initialPage={{ items: [candidate(1), candidate(2)], nextCursor: "next-page" }} candidatesUrl="/api/progress/exercises?group=u%3Arow" initialName="Row" returnTo="/history" />);
    expect(screen.getByRole("button", { name: "Review selected workouts" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Select these 2 records" }));
    expect(screen.getByRole("status")).toHaveTextContent("2 records selected");
    fireEvent.click(screen.getByRole("button", { name: "Next records" }));
    expect(await screen.findByLabelText(/Workout 3/)).not.toBeChecked();
    expect(screen.queryByLabelText(/Workout 1/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 records selected");
    fireEvent.click(screen.getByRole("button", { name: "Review selected workouts" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(JSON.parse(request.mock.calls[1][1].body).observationIds).toEqual([1, 2]);
  });
  it("keeps the reviewed IDs and request key unchanged when an apply response is lost", async () => {
    const preview = { token: "review-token", targetExerciseId: null, targetName: "Row", observations: [candidate(1)], observationCount: 1, sessionCount: 1, explanation: "Only these selected workouts change grouping." };
    const request = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => preview }).mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce({ ok: true, json: async () => ({ changeId: 7, targetExerciseId: "new", observationCount: 1, undone: false }) });
    vi.stubGlobal("fetch", request);
    render(<IdentitySelection initialPage={{ items: [candidate(1)], nextCursor: null }} candidatesUrl="/api/progress/exercises?group=u%3Arow" initialName="Row" initialSelectedId={1} returnTo="/history" />);
    fireEvent.click(screen.getByRole("button", { name: "Review selected workouts" }));
    fireEvent.click(await screen.findByRole("button", { name: "Connect selected workouts" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry saving grouping" }));
    expect(await screen.findByRole("button", { name: "Undo grouping change" })).toBeVisible();
    expect(JSON.parse(request.mock.calls[2][1].body)).toEqual(JSON.parse(request.mock.calls[1][1].body));
  });
  it("starts an exact record with only that observation selected", () => {
    render(<IdentitySelection initialPage={{ items: [candidate(1), candidate(2)], nextCursor: null }} candidatesUrl="/api/progress/exercises?group=u%3Arow" initialName="Row" initialSelectedId={2} returnTo="/history" draftKey="magni.progress.single-record" />);
    expect(screen.getByLabelText(/Workout 1/)).not.toBeChecked();
    expect(screen.getByLabelText(/Workout 2/)).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("1 record selected");
  });

});
