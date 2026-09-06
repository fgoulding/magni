// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickWorkout } from "./QuickWorkout";

const initialSession = {
  id: 42,
  sets: [{ id: 7, exercise_name: "Dumbbell Row", reps: 10, sets: 1, set_number: 1, rep_out_target: 10, calculated_weight: 40, actual_reps: 10, actual_weight: 40, superset_group: null }],
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const editReps = (value: string) => fireEvent.change(screen.getByRole("spinbutton", { name: "Reps for set 1" }), { target: { value } });

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("QuickWorkout save recovery", () => {
  it("resolves a lost older start without opening it on Today and uses a fresh key for today", async () => {
    localStorage.setItem("magni.quick.start.today", JSON.stringify({ name: "Quick Workout", date: "", unit: "lb", requestKey: "original-start" }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ id: 41, name: "Yesterday workout", date: "2026-09-04", currentDate: "2026-09-05", sets: [] }))
      .mockResolvedValueOnce(response({ id: 42, name: "Today workout", date: "2026-09-05", currentDate: "2026-09-05", sets: [] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<QuickWorkout initialSession={null} todayOnly />);
    fireEvent.click(screen.getByRole("button", { name: "Retry starting workout" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Your earlier workout is saved in Calendar/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Yesterday workout" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish workout" })).not.toBeInTheDocument();
    expect(localStorage.getItem("magni.quick.start.today")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Quick workout" }));
    await screen.findByRole("heading", { name: "Today workout" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).requestKey).toBe("original-start");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).requestKey).not.toBe("original-start");
  });
  it("marks an edited logged set unsaved immediately and restores it after navigation or reload", () => {
    const first = render(<QuickWorkout initialSession={initialSession} />);
    editReps("7");
    expect(screen.getByRole("button", { name: /Save set 1/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    first.unmount();
    render(<QuickWorkout initialSession={initialSession} />);
    expect(screen.getByRole("spinbutton", { name: "Reps for set 1" })).toHaveValue(7);
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
  });

  it("keeps a newer edit pending when an older save finishes", async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    render(<QuickWorkout initialSession={initialSession} />);
    editReps("7");
    fireEvent.click(screen.getByRole("button", { name: /Save set 1/ }));
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    editReps("8");
    await act(async () => resolve(response({ actual_reps: 7, actual_weight: 40 })));
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Reps for set 1" })).toHaveValue(8);
  });

  it("retains failed work through remount and retries the entered values", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue(response({ actual_reps: 7, actual_weight: 40 }));
    vi.stubGlobal("fetch", fetchMock);
    const first = render(<QuickWorkout initialSession={initialSession} />);
    editReps("7");
    fireEvent.click(screen.getByRole("button", { name: /Save set 1/ }));
    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    first.unmount();
    render(<QuickWorkout initialSession={initialSession} />);
    expect(screen.getByRole("spinbutton", { name: "Reps for set 1" })).toHaveValue(7);
    fireEvent.click(screen.getByRole("button", { name: /Save set 1/ }));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith("/api/sessions/42/sets", expect.objectContaining({ body: JSON.stringify({ setId: 7, actualReps: 7, actualWeight: 40, expectedActual: { reps: 10, weight: 40 } }) }));
  });

  it("prevents finish while edits are unsaved or a set is being saved", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<QuickWorkout initialSession={initialSession} />);
    editReps("7");
    expect(screen.getByRole("button", { name: "Finish workout" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Save set 1/ }));
    expect(screen.getByRole("button", { name: "Finish workout" })).toBeDisabled();
  });

  it("does not convert an empty edited reps field into a performed zero-rep set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<QuickWorkout initialSession={initialSession} />);
    editReps("");
    await userEvent.setup().click(screen.getByRole("button", { name: /Save set 1/ }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter whole reps");
  });

  it("preserves differing weight and reps edits independently for each set", () => {
    const session = { ...initialSession, sets: [...initialSession.sets, { ...initialSession.sets[0], id: 8, set_number: 2, actual_reps: null, actual_weight: null }] };
    const first = render(<QuickWorkout initialSession={session} />);
    editReps("8");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Weight for set 2" }), { target: { value: "42.5" } });
    first.unmount();
    render(<QuickWorkout initialSession={session} />);
    expect(screen.getByRole("spinbutton", { name: "Reps for set 1" })).toHaveValue(8);
    expect(screen.getByRole("spinbutton", { name: "Weight for set 1" })).toHaveValue(40);
    expect(screen.getByRole("spinbutton", { name: "Reps for set 2" })).toHaveValue(10);
    expect(screen.getByRole("spinbutton", { name: "Weight for set 2" })).toHaveValue(42.5);
  });

  it("keeps finish available for retry after losing its success response", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValue(response({ volume: 400, loggedCount: 1, skippedCount: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<QuickWorkout initialSession={initialSession} />);
    fireEvent.click(screen.getByRole("button", { name: "Finish workout" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
    fireEvent.click(screen.getByRole("button", { name: "Finish workout" }));
    expect(await screen.findByText("Quick workout complete")).toBeInTheDocument();
    expect(screen.getByText(/400 lb total/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not display a fabricated recap when the finish response cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200 })));
    render(<QuickWorkout initialSession={initialSession} />);
    fireEvent.click(screen.getByRole("button", { name: "Finish workout" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not confirm workout completion. Retry finishing.");
    expect(screen.queryByText("Quick workout complete")).not.toBeInTheDocument();
  });

  it("shows zero recorded load for a legacy logged row without actual weight", () => {
    render(<QuickWorkout initialSession={{ ...initialSession, sets: [{ ...initialSession.sets[0], actual_weight: null }] }} />);
    expect(screen.getByRole("spinbutton", { name: "Weight for set 1" })).toHaveValue(0);
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("warns when device storage fails and still allows the entered draft to be saved", async () => {
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => { throw new Error("Storage full"); });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ actual_reps: 7, actual_weight: 40 })));
    render(<QuickWorkout initialSession={initialSession} />);
    editReps("7");
    expect(screen.getByRole("alert")).toHaveTextContent("Device storage is unavailable");
    expect(screen.getByRole("spinbutton", { name: "Reps for set 1" })).toHaveValue(7);
    fireEvent.click(screen.getByRole("button", { name: /Save set 1/ }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });
});

 it("starts on a selected past date with a name and explicit units", async () => {
  const replace = vi.spyOn(window.history, "replaceState");
  const fetchMock = vi.fn().mockResolvedValue(response({ id: 88, sets: [], date: "2026-09-01", name: "Rows", unit: "kg" }));
  vi.stubGlobal("fetch", fetchMock);
  render(<QuickWorkout initialSession={null} initialDate="2026-09-01" />);
  fireEvent.change(screen.getByLabelText("Workout name"), { target: { value: "Rows" } });
  fireEvent.change(screen.getByLabelText("Workout units"), { target: { value: "kg" } });
  fireEvent.click(screen.getByRole("button", { name: "Quick workout" }));
  await screen.findByRole("heading", { name: "Rows" });
  expect(replace).toHaveBeenCalledWith(null, "", "/workouts/88");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ name: "Rows", date: "2026-09-01", unit: "kg", newWorkout: true });
 });

it.each(["Keep my edits", "Use saved values"])("resolves a conflicting set through %s without losing the local values silently", async (choice) => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response({ error: "This set changed in another tab or device." }, 409))
    .mockResolvedValueOnce(response({ ...initialSession, sets: [{ ...initialSession.sets[0], actual_reps: 12 }] }))
    .mockResolvedValue(response({ actual_reps: 7, actual_weight: 40, sessionRevision: 3 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<QuickWorkout initialSession={initialSession} />);
  editReps("7");
  fireEvent.click(screen.getByRole("button", { name: "Save set 1" }));
  await screen.findByText(/Saved elsewhere: 12 reps at 40 lb/);
  expect(screen.getByRole("spinbutton", { name: "Reps for set 1" })).toHaveValue(7);
  fireEvent.click(screen.getByRole("button", { name: choice }));
  if (choice === "Keep my edits") {
    expect(screen.getByRole("spinbutton", { name: "Reps for set 1" })).toHaveValue(7);
    fireEvent.click(screen.getByRole("button", { name: "Save set 1" }));
    await screen.findByText("Saved");
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ setId: 7, actualReps: 7, actualWeight: 40, expectedActual: { reps: 12, weight: 40 } });
  } else {
    expect(screen.getByRole("spinbutton", { name: "Reps for set 1" })).toHaveValue(12);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }
});

it("requires saving or cancelling a pending new exercise before finishing", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([])));
  render(<QuickWorkout initialSession={initialSession} />);
  fireEvent.click(screen.getByRole("button", { name: "Add exercise" }));
  await screen.findByLabelText("New exercise name");
  fireEvent.change(screen.getByLabelText("New exercise name"), { target: { value: "Pending row" } });
  expect(screen.getByRole("button", { name: "Finish workout" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: "Finish workout" })).toBeEnabled();
});

it("refreshes saved workout metadata with a set acknowledgement before allowing structural editing", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ actual_reps: 7, actual_weight: 40, sessionRevision: 5, sessionMetadata: { name: "Renamed remotely", date: "2026-09-02", unit: "lb", revision: 5 } })));
  render(<QuickWorkout initialSession={{ ...initialSession, name: "Old name", date: "2026-09-01", revision: 1 }} />);
  editReps("7"); fireEvent.click(screen.getByRole("button", { name: "Save set 1" }));
  await screen.findByRole("heading", { name: "Renamed remotely" });
  fireEvent.click(screen.getByRole("button", { name: "Edit workout" }));
  expect(screen.getByLabelText("Workout name")).toHaveValue("Renamed remotely");
  expect(screen.getByLabelText("Workout date")).toHaveValue("2026-09-02");
});

it("keeps distinct same-name exercises separate when their saved exercise identities differ", () => {
  const session = { ...initialSession, sets: [{ ...initialSession.sets[0], exercise_key: "first" }, { ...initialSession.sets[0], id: 8, exercise_key: "second" }] };
  render(<QuickWorkout initialSession={session} />);
  expect(screen.getAllByText("Dumbbell Row")).toHaveLength(2);
});
