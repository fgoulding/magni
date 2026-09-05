// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkoutCard } from "./WorkoutCard";
import type { SessionResponse } from "./workout-card-utils";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./WorkoutTmEditor", () => ({ WorkoutTmEditor: () => <p>Legacy max editor</p> }));
const props = { occurrenceId: 19, programId: 4, dayId: 5, programName: "Custom strength", dayName: "Upper", currentWeek: 1, currentDay: 1 };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function session(logged = false, unit = "lb"): SessionResponse {
  return { id: 32, sets: [1, 2, 3].map((number) => ({
    id: number, exercise_name: "Row", reps: 8, sets: 1, set_number: number, rep_out_target: 12,
    calculated_weight: 40, training_max: 100, actual_reps: logged && number === 1 ? 10 : null,
    actual_weight: logged && number === 1 ? 40 : null, superset_group: null, progression_type: "custom",
    editor_json: JSON.stringify({ exerciseId: "row", progressionKey: "row-state", baseLoad: 40, trainingMax: 100, unit,
      initialReps: 8, deload: false, versionId: 1, rule: null,
      set: { id: `work-${number}`, role: "work", repMin: 8, repMax: 12, loadMode: "working", load: 0, effortKind: "rpe", effort: 8,
        restSeconds: 120, tempo: "3-1-1", notes: number === 1 ? "Keep chest supported" : "" },
    }),
  })) };
}
const edit = (name: string, value: string) => fireEvent.change(screen.getByRole("spinbutton", { name }), { target: { value } });
function mockServer(initial = session(), save: (url: string, init?: RequestInit) => Promise<Response> = async () => response({ success: true })) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => url.includes("/sessions/current") ? Promise.resolve(response(initial)) : save(url, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); router.refresh.mockClear(); });

describe("custom workout set logging and draft recovery", () => {
  it("shows independent editable ranges and context for identical sets without a legacy training-max editor", async () => {
    mockServer(session(false, "kg"));
    render(<WorkoutCard {...props} />);
    expect(await screen.findByRole("spinbutton", { name: "Row set 1 reps" })).toHaveValue(12);
    expect(screen.getByRole("spinbutton", { name: "Row set 2 reps" })).toHaveValue(12);
    expect(screen.getByRole("spinbutton", { name: "Row set 3 weight (kg)" })).toHaveValue(40);
    expect(screen.getAllByText(/Work · 8–12 reps/)).toHaveLength(3);
    expect(screen.getAllByText(/RPE 8/)).toHaveLength(3);
    expect(screen.getAllByText(/Rest 120 s/)).toHaveLength(3);
    expect(screen.getAllByText(/Tempo 3-1-1/)).toHaveLength(3);
    expect(screen.getByText("Keep chest supported")).toBeInTheDocument();
    expect(screen.queryByText("Legacy max editor")).not.toBeInTheDocument();
  });

  it("saves only one selected physical set and finishes partial with 400 lb", async () => {
    const save = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>().mockImplementation(async () => response({ success: true }));
    mockServer(session(), save);
    render(<WorkoutCard {...props} />);
    await screen.findByRole("spinbutton", { name: "Row set 1 reps" });
    edit("Row set 1 reps", "10");
    fireEvent.click(screen.getByRole("button", { name: "Save set 1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save set 1" })).toHaveAttribute("aria-pressed", "true"));
    expect(save).toHaveBeenCalledTimes(1);
    expect(JSON.parse(save.mock.calls[0][1]!.body as string)).toEqual({ setId: 1, actualReps: 10, actualWeight: 40, expectedActual: { reps: null, weight: null } });
    fireEvent.click(screen.getByRole("button", { name: "Finish Workout" }));
    expect(await screen.findByText("Workout complete")).toBeInTheDocument();
    expect(screen.getByText("400 lb total")).toBeInTheDocument();
  });

  it("marks a changed logged set unsaved and restores pending strings after remount", async () => {
    mockServer(session(true));
    const first = render(<WorkoutCard {...props} />);
    await screen.findByRole("spinbutton", { name: "Row set 1 reps" });
    edit("Row set 1 reps", "7");
    expect(screen.getByRole("button", { name: "Save set 1" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish Workout" })).toBeDisabled();
    first.unmount();
    render(<WorkoutCard {...props} />);
    expect(await screen.findByRole("spinbutton", { name: "Row set 1 reps" })).toHaveValue(7);
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
  });

  it("keeps edits made during a save pending after an older acknowledgement", async () => {
    let resolve!: (value: Response) => void;
    const save = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }))
      .mockResolvedValue(response({ actual_reps: 8, actual_weight: 40 }));
    mockServer(session(true), save);
    render(<WorkoutCard {...props} />);
    await screen.findByRole("spinbutton", { name: "Row set 1 reps" });
    edit("Row set 1 reps", "7");
    fireEvent.click(screen.getByRole("button", { name: "Save set 1" }));
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    edit("Row set 1 reps", "8");
    await act(async () => resolve(response({ actual_reps: 7, actual_weight: 40 })));
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Row set 1 reps" })).toHaveValue(8);
    expect(screen.getByRole("button", { name: "Save set 1" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Save set 1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save set 1" })).toHaveAttribute("aria-pressed", "true"));
    expect(JSON.parse(save.mock.calls[1][1]!.body as string)).toMatchObject({ actualReps: 8, expectedActual: { reps: 7, weight: 40 } });
  });

  it("preserves failed values and retries exactly the pending set", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue(response({ success: true }));
    mockServer(session(), save);
    const first = render(<WorkoutCard {...props} />);
    await screen.findByRole("spinbutton", { name: "Row set 2 reps" });
    edit("Row set 2 reps", "11");
    edit("Row set 2 weight (lb)", "42.5");
    fireEvent.click(screen.getByRole("button", { name: "Save set 2" }));
    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    first.unmount();
    render(<WorkoutCard {...props} />);
    expect(await screen.findByRole("spinbutton", { name: "Row set 2 reps" })).toHaveValue(11);
    fireEvent.click(screen.getByRole("button", { name: "Save set 2" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save set 2" })).toHaveAttribute("aria-pressed", "true"));
    expect(JSON.parse(save.mock.calls[1][1].body)).toEqual({ setId: 2, actualReps: 11, actualWeight: 42.5, expectedActual: { reps: null, weight: null } });
  });

  it("never treats an empty input as a performed zero-rep set", async () => {
    const save = vi.fn();
    mockServer(session(), save);
    render(<WorkoutCard {...props} />);
    await screen.findByRole("spinbutton", { name: "Row set 1 reps" });
    edit("Row set 1 reps", "");
    fireEvent.click(screen.getByRole("button", { name: "Save set 1" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter whole reps");
  });

  it("can discard pending changes without logging an untouched set", async () => {
    const save = vi.fn();
    mockServer(session(), save);
    render(<WorkoutCard {...props} />);
    await screen.findByRole("spinbutton", { name: "Row set 1 reps" });
    edit("Row set 1 reps", "9");
    fireEvent.click(screen.getByRole("button", { name: "Discard set 1 changes" }));
    expect(screen.getByRole("spinbutton", { name: "Row set 1 reps" })).toHaveValue(12);
    expect(screen.getByRole("button", { name: "Save set 1" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Finish Workout" })).toBeEnabled();
    expect(save).not.toHaveBeenCalled();
  });

  it("shows bodyweight plus added kg and counts only acknowledged added load", async () => {
    const body = session(false, "kg");
    body.sets = body.sets.slice(0, 1).map((set) => ({ ...set, exercise_name: "Pull-up", calculated_weight: 5,
      editor_json: JSON.stringify({ ...JSON.parse(set.editor_json!), set: { ...JSON.parse(set.editor_json!).set, loadMode: "added", load: 5 } }),
    }));
    mockServer(body);
    render(<WorkoutCard {...props} />);
    expect(await screen.findByText(/BW \+5 kg/)).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Pull-up set 1 weight (kg)" })).toHaveValue(5);
    edit("Pull-up set 1 reps", "10");
    fireEvent.click(screen.getByRole("button", { name: "Save set 1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save set 1" })).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(screen.getByRole("button", { name: "Finish Workout" }));
    expect(await screen.findByText("50 kg total")).toBeInTheDocument();
  });

  it("recovers a pending legacy flat-lift rep field without changing legacy batch logging", async () => {
    const body = session();
    body.sets = body.sets.map((set) => ({ ...set, editor_json: null, training_max: null }));
    const save = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>().mockImplementation(async () => response({ success: true }));
    mockServer(body, save);
    const first = render(<WorkoutCard {...props} />);
    await screen.findByRole("spinbutton", { name: "Reps" });
    edit("Reps", "9");
    first.unmount();
    render(<WorkoutCard {...props} />);
    expect(await screen.findByRole("spinbutton", { name: "Reps" })).toHaveValue(9);
    fireEvent.click(screen.getByRole("button", { name: "Log Set" }));
    await screen.findByText("Logged");
    expect(save).toHaveBeenCalledTimes(3);
    expect(JSON.parse(save.mock.calls[2][1]!.body as string)).toEqual({ setId: 3, actualReps: 9, actualWeight: 40, expectedActual: { reps: null, weight: null } });
  });

  it("keeps edits recoverable in memory when device storage is unavailable and explains the limit", async () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("Storage unavailable"); }, setItem: () => { throw new Error("Storage unavailable"); }, removeItem: () => { throw new Error("Storage unavailable"); } });
    const body = session(); body.id = 123; body.sets = body.sets.slice(0, 1);
    mockServer(body);
    const first = render(<WorkoutCard {...props} />);
    await screen.findByRole("spinbutton", { name: "Row set 1 reps" });
    edit("Row set 1 reps", "10");
    expect(screen.getByText(/Device storage is unavailable/)).toBeInTheDocument();
    first.unmount();
    render(<WorkoutCard {...props} />);
    expect(await screen.findByRole("spinbutton", { name: "Row set 1 reps" })).toHaveValue(10);
    expect(screen.getByText(/Device storage is unavailable/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save set 1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save set 1" })).toHaveAttribute("aria-pressed", "true"));
  });

  it("does not acknowledge a truncated successful completion response", async () => {
    mockServer(session(true), async () => new Response("", { status: 200 }));
    render(<WorkoutCard {...props} />);
    await screen.findByRole("spinbutton", { name: "Row set 1 reps" });
    fireEvent.click(screen.getByRole("button", { name: "Finish Workout" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not confirm completion");
    expect(screen.queryByText("Workout complete")).not.toBeInTheDocument();
  });

  it("resumes the first group with local pending edits before later unlogged groups", async () => {
    const body = session(true);
    body.sets = [body.sets[0], { ...body.sets[1], exercise_name: "Press" }];
    localStorage.setItem("magni.planned-workout.32.draft.v1", JSON.stringify({ 1: { reps: "7", weight: "40" } }));
    mockServer(body);
    render(<WorkoutCard {...props} />);
    expect(await screen.findByRole("spinbutton", { name: "Row set 1 reps" })).toHaveValue(7);
  });

  it("keeps acknowledged legacy volume when merely opening Edit", async () => {
    const body = session(true);
    body.sets = [{ ...body.sets[0], editor_json: null, training_max: null }];
    mockServer(body);
    render(<WorkoutCard {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.getByText("400 lb · 1 set")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Reps" })).toHaveValue(10);
  });

  it("retains an old draft baseline through reload and resolves a409 only after an explicit choice", async () => {
    const body = session(true);
    localStorage.setItem("magni.planned-workout.32.draft.v1", JSON.stringify({ 1: { reps: "8", weight: "40", expectedActual: { reps: 9, weight: 40 } } }));
    const latest = { ...body, sets: body.sets.map((set) => set.id === 1 ? { ...set, actual_reps: 11 } : set) };
    const saves: object[] = [];
    mockServer(body, async (url, init) => {
      if (init?.method === "PUT") {
        saves.push(JSON.parse(init.body as string));
        return saves.length === 1 ? response({ error: "This set changed in another device." }, 409) : response({ actual_reps: 8, actual_weight: 40 });
      }
      if (url === "/api/sessions/32") return response(latest);
      return response({ success: true });
    });
    render(<WorkoutCard {...props} />);
    await screen.findByRole("spinbutton", { name: "Row set 1 reps" });
    fireEvent.click(screen.getByRole("button", { name: "Save set 1" }));
    expect(await screen.findByText("Saved elsewhere: 11 reps at 40 lb.")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Row set 1 reps" })).toHaveValue(8);
    expect(saves[0]).toMatchObject({ expectedActual: { reps: 9, weight: 40 } });
    fireEvent.click(screen.getByRole("button", { name: "Keep my set 1 edits" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save set 1" })).toHaveAttribute("aria-pressed", "true"));
    expect(saves[1]).toMatchObject({ actualReps: 8, expectedActual: { reps: 11, weight: 40 } });
  });

  it("shows the returned progression explanation after completion", async () => {
    mockServer(session(true), async (url) => response(url.includes("complete-and-advance") ? {
      success: true, progressionDecisions: [{ progressionKey: "row-state", exerciseName: "Row", result: { explanation: "All work sets reached 12 reps. Next load: 42.5 lb." } }],
    } : { prs: [] }));
    render(<WorkoutCard {...props} />);
    await screen.findByRole("spinbutton", { name: "Row set 1 reps" });
    fireEvent.click(screen.getByRole("button", { name: "Finish Workout" }));
    expect(await screen.findByText("All work sets reached 12 reps. Next load: 42.5 lb.")).toBeInTheDocument();
  });
});
