// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickWorkout, type QuickSession } from "./QuickWorkout";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

const initialSession = {
  id: 42,
  sets: [{ id: 7, exercise_name: "Dumbbell Row", reps: 10, sets: 1, set_number: 1, rep_out_target: 10, calculated_weight: 40, actual_reps: 10, actual_weight: 40, superset_group: null }],
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const editReps = (value: string) => fireEvent.change(screen.getByRole("spinbutton", { name: "Reps for set 1" }), { target: { value } });

beforeEach(() => {
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; this.isPrimary = init.isPrimary ?? true; }
  });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("QuickWorkout save recovery", () => {
  it("shows the acknowledged date after an edit moves a Today workout to another day", async () => {
    const session = { ...initialSession, name: "Today rows", date: "2026-10-10", unit: "lb" as const, revision: 1 };
    const fetchMock = vi.fn().mockResolvedValue(response({ ...session, date: "2026-10-09", revision: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<QuickWorkout initialSession={session} todayOnly todayDate="2026-10-10" />);
    expect(screen.queryByText("2026-10-10 · lb")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit workout" }));
    fireEvent.change(screen.getByLabelText("Workout date"), { target: { value: "2026-10-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Save workout changes" }));
    expect(await screen.findByText("2026-10-09 · lb")).toBeVisible();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ date: "2026-10-09", expectedRevision: 1 });
    expect(screen.queryByLabelText("Workout date")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit workout" })).toHaveFocus();
  });

  it("keeps the saved date visible when the account's Today date is unknown", () => {
    render(<QuickWorkout initialSession={{ ...initialSession, date: "2026-10-09", unit: "kg" }} todayOnly />);
    expect(screen.getByText("2026-10-09 · kg")).toBeVisible();
  });

  it("keeps saved-set progress truthful for legacy batches, pending edits and acknowledged Undo", async () => {
    const batch = { ...initialSession, id: 542, sets: [{ ...initialSession.sets[0], id: 507, sets: 3 }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ actual_reps: 7, actual_weight: 40 })).mockResolvedValueOnce(response({ actual_reps: null, actual_weight: null })));
    render(<QuickWorkout initialSession={batch} />);
    const progress = screen.getByRole("progressbar", { name: "Saved sets" });
    expect(screen.getByRole("region", { name: "Workout progress" })).toHaveTextContent("3 of 3 sets saved");
    expect(progress).toHaveAttribute("aria-valuenow", "3");
    expect(progress).toHaveAttribute("aria-valuemax", "3");
    editReps("7");
    expect(progress).toHaveAttribute("aria-valuenow", "0");
    fireEvent.click(screen.getByRole("button", { name: "Save 3-set log" }));
    await waitFor(() => expect(progress).toHaveAttribute("aria-valuenow", "3"));
    fireEvent.click(screen.getByRole("button", { name: "Undo 3-set log" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save 3-set log" })).toBeEnabled());
    expect(progress).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByRole("spinbutton", { name: "Reps for set 1" })).toHaveValue(7);
  });

  it("requires a hold and explicit confirmation to delete while Add exercise stays available", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(response({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<QuickWorkout initialSession={initialSession} todayOnly />);
    expect(screen.getByRole("button", { name: "Add exercise" })).toBeVisible();
    const trigger = screen.getByRole("button", { name: "Delete workout" });
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
    act(() => vi.advanceTimersByTime(599));
    fireEvent.pointerUp(trigger, { pointerId: 1 });
    fireEvent.click(trigger, { detail: 1 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
    act(() => vi.advanceTimersByTime(600));
    const dialog = screen.getByRole("dialog", { name: "Delete workout?" });
    expect(dialog).toHaveTextContent("Are you sure you want to delete this workout?");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Delete" })));
    expect(screen.getByRole("button", { name: "Quick workout" })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/42", { method: "DELETE" });
  });

  it.each(["release", "cancel", "leave", "move", "capture lost", "window blur"])("cancels a delete hold on %s without opening confirmation", (cancellation) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<QuickWorkout initialSession={initialSession} />);
    const trigger = screen.getByRole("button", { name: "Delete workout" });
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
    act(() => vi.advanceTimersByTime(300));
    if (cancellation === "release") fireEvent.pointerUp(trigger, { pointerId: 1 });
    if (cancellation === "cancel") fireEvent.pointerCancel(trigger, { pointerId: 1 });
    if (cancellation === "leave") fireEvent.pointerLeave(trigger, { pointerId: 1 });
    if (cancellation === "move") fireEvent.pointerMove(trigger, { pointerId: 1, clientX: 40, clientY: 20 });
    if (cancellation === "capture lost") fireEvent.lostPointerCapture(trigger, { pointerId: 1 });
    if (cancellation === "window blur") fireEvent(window, new Event("blur"));
    act(() => vi.advanceTimersByTime(600));
    fireEvent.click(trigger, { detail: 1 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["{Enter}", " "])("opens confirmation with keyboard %s and restores focus after cancel or Escape", async (key) => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<QuickWorkout initialSession={initialSession} />);
    const trigger = screen.getByRole("button", { name: "Delete workout" });
    trigger.focus(); await user.keyboard(key);
    let dialog = screen.getByRole("dialog", { name: "Delete workout?" });
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger, { detail: 0 });
    dialog = screen.getByRole("dialog", { name: "Delete workout?" });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps failed deletion recoverable in the dialog and prevents duplicate confirmations", async () => {
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ error: "Unable to delete right now" }, 503)).mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<QuickWorkout initialSession={initialSession} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete workout" }), { detail: 0 });
    const dialog = screen.getByRole("dialog", { name: "Delete workout?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Unable to delete right now");
    expect(screen.getByRole("heading", { name: "Dumbbell Row" })).toBeInTheDocument();
    const confirmation = within(dialog).getByRole("button", { name: "Delete" });
    fireEvent.click(confirmation); fireEvent.click(confirmation);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(within(dialog).getByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(dialog).toBeVisible();
    await act(async () => resolve(response({ success: true })));
    expect(screen.getByRole("button", { name: "Quick workout" })).toBeVisible();
  });

  it("cancels an active hold and blocks deletion while a set save is pending", async () => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<QuickWorkout initialSession={initialSession} />);
    const trigger = screen.getByRole("button", { name: "Delete workout" });
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
    act(() => vi.advanceTimersByTime(300));
    editReps("7"); fireEvent.click(screen.getByRole("button", { name: "Save set 1" }));
    expect(trigger).toBeDisabled();
    act(() => vi.advanceTimersByTime(600));
    fireEvent.click(trigger, { detail: 0 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => resolve(response({ actual_reps: 7, actual_weight: 40 })));
  });

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
    expect(screen.getByRole("progressbar", { name: "Saved sets" })).toHaveAttribute("aria-valuenow", "0");
    await act(async () => resolve(response({ actual_reps: 7, actual_weight: 40 })));
    expect(screen.getByRole("progressbar", { name: "Saved sets" })).toHaveAttribute("aria-valuenow", "0");
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

  it("allows ordinary pending inputs but prevents finish while a set is being saved", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<QuickWorkout initialSession={initialSession} />);
    editReps("7");
    expect(screen.getByRole("button", { name: "Finish workout" })).toBeEnabled();
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

  it("shows missing recorded load distinctly from zero on a legacy logged row", () => {
    render(<QuickWorkout initialSession={{ ...initialSession, sets: [{ ...initialSession.sets[0], actual_weight: null }] }} />);
    expect(screen.getByRole("spinbutton", { name: "Weight for set 1" })).toHaveValue(null);
    expect(screen.getByText("Saved · load not recorded")).toBeInTheDocument();
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

it("keeps newer session metadata when two set acknowledgements arrive in reverse revision order", async () => {
  const session = { ...initialSession, name: "Initial", date: "2026-10-21", revision: 1, sets: [...initialSession.sets, { ...initialSession.sets[0], id: 8, set_number: 2 }] };
  const resolvers: ((value: Response) => void)[] = [];
  const fetchMock = vi.fn((url: string) => url.endsWith("/sets") ? new Promise<Response>(resolve => { resolvers.push(resolve); }) : Promise.resolve(response({ ...session, revision: 4 })));
  vi.stubGlobal("fetch", fetchMock);
  render(<QuickWorkout initialSession={session} />);
  editReps("7");
  fireEvent.change(screen.getByRole("spinbutton", { name: "Reps for set 2" }), { target: { value: "8" } });
  fireEvent.click(screen.getByRole("button", { name: "Save set 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Save set 2" }));
  await act(async () => resolvers[1](response({ actual_reps: 8, actual_weight: 40, sessionRevision: 3, sessionMetadata: { name: "Latest", date: "2026-10-22", unit: "lb", revision: 3 } })));
  await act(async () => resolvers[0](response({ actual_reps: 7, actual_weight: 40, sessionRevision: 2, sessionMetadata: { name: "Older", date: "2026-10-21", unit: "lb", revision: 2 } })));
  expect(screen.getByRole("heading", { name: "Latest" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Undo set 1" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Undo set 2" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Edit workout" }));
  expect(screen.getByLabelText("Workout date")).toHaveValue("2026-10-22");
  fireEvent.change(screen.getByLabelText("Workout name"), { target: { value: "After both saves" } });
  fireEvent.click(screen.getByRole("button", { name: "Save workout changes" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(JSON.parse((fetchMock.mock.calls[2] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ expectedRevision: 3 });
});

it("replays the original append after a lost response, changed source actuals and remount, then allows Finish", async () => {
  const session = { ...initialSession, id: 642, revision: 1 };
  const added = { ...session.sets[0], id: 8, set_number: 2, actual_reps: null, actual_weight: null };
  let current: QuickSession = { ...session, sets: [...session.sets] };
  const commands: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      commands.push(String(init.body));
      if (commands.length === 1) { current = { ...current, revision: 2, sets: [...current.sets, added] }; throw new Error("Append response lost"); }
      if (commands.at(-1) !== commands[0]) return response({ error: "Retry key changed payload" }, 409);
      if (commands.length === 2) throw new Error("Retry response lost");
      return response(current);
    }
    if (url.endsWith("/sets") && init?.method === "PUT") {
      current = { ...current, revision: 3, sets: current.sets.map(set => set.id === 7 ? { ...set, actual_reps: 7, actual_weight: 45 } : set) };
      return response({ actual_reps: 7, actual_weight: 45, sessionRevision: 3 });
    }
    if (init?.method === "PATCH") return response({ loggedCount: 1, skippedCount: 1, volume: 315 });
    return response(current);
  });
  vi.stubGlobal("fetch", fetchMock);
  const first = render(<QuickWorkout initialSession={session} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit workout" }));
  fireEvent.click(screen.getByRole("button", { name: "Add similar set" }));
  await screen.findByText("Append response lost");
  fireEvent.click(screen.getByRole("button", { name: "Hide workout editor" }));
  editReps("7");
  fireEvent.change(screen.getByRole("spinbutton", { name: "Weight for set 1" }), { target: { value: "45" } });
  fireEvent.click(screen.getByRole("button", { name: "Save set 1" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Undo set 1" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Edit workout" }));
  fireEvent.click(screen.getByRole("button", { name: "Retry add set" }));
  await screen.findByText("Retry response lost");
  first.unmount(); render(<QuickWorkout initialSession={current} />);
  expect(screen.getByRole("button", { name: "Finish workout" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Edit workout" }));
  fireEvent.click(screen.getByRole("button", { name: "Retry add set" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Finish workout" })).toBeEnabled());
  expect(commands).toHaveLength(3); expect(commands[1]).toBe(commands[0]); expect(commands[2]).toBe(commands[0]);
  expect(current.sets).toHaveLength(2);
  expect(screen.getByRole("spinbutton", { name: "Reps for set 1" })).toHaveValue(7);
  fireEvent.click(screen.getByRole("button", { name: "Finish workout" }));
  await screen.findByText("Quick workout complete");
});

it("reviews legacy pending append state without guessing its old payload or erasing row drafts", async () => {
  const session = { ...initialSession, id: 643, revision: 3 };
  localStorage.setItem("magni.quick.643.append", JSON.stringify({ setId: 7, requestKey: "legacy-append-key" }));
  localStorage.setItem("magni.quick-workout.643.draft.v1", JSON.stringify({ 7: { reps: "8", weight: "42.5", base: { reps: 10, weight: 40 } } }));
  const rowDraft = localStorage.getItem("magni.quick-workout.643.draft.v1");
  const fetchMock = vi.fn().mockResolvedValue(response(session));
  vi.stubGlobal("fetch", fetchMock);
  const { QuickWorkoutEditor } = await import("./QuickWorkoutEditor");
  render(<QuickWorkoutEditor session={session} disabled={false} onChanged={vi.fn()} onError={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit workout" }));
  fireEvent.click(screen.getByRole("button", { name: "Review saved sets" }));
  fireEvent.click(await screen.findByRole("button", { name: "Keep saved sets" }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith("/api/sessions/643", expect.objectContaining({ method: "GET" }));
  expect(localStorage.getItem("magni.quick.643.append")).toBeNull();
  expect(localStorage.getItem("magni.quick-workout.643.draft.v1")).toBe(rowDraft);
});

it("retries a persisted append even when its original row is missing after reload", async () => {
  const pending = { setId: 7, requestKey: "append-with-missing-row", body: { name: "Dumbbell Row", prescription: [{ reps: 10, weight: 40 }], appendToSetId: 7, requestKey: "append-with-missing-row" } };
  const session = { ...initialSession, id: 644, revision: 4, sets: [{ ...initialSession.sets[0], id: 8 }] };
  localStorage.setItem("magni.quick.644.append", JSON.stringify(pending));
  const fetchMock = vi.fn(async () => response(session)); vi.stubGlobal("fetch", fetchMock);
  render(<QuickWorkout initialSession={session} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit workout" }));
  fireEvent.click(screen.getByRole("button", { name: "Retry add set" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Finish workout" })).toBeEnabled());
  expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/sessions/644/sets", expect.objectContaining({ body: JSON.stringify(pending.body) }));
  expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/sessions/644", expect.objectContaining({ method: "GET" }));
});

it("shows actual saved values for a legacy append review and requires refreshing a stale review", async () => {
  const { QuickWorkoutEditor } = await import("./QuickWorkoutEditor");
  const session = { ...initialSession, id: 645, revision: 3, unit: "lb" as const };
  localStorage.setItem("magni.quick.645.append", JSON.stringify({ setId: 7, requestKey: "legacy-review-key" }));
  const fetchMock = vi.fn(async () => response(session)); vi.stubGlobal("fetch", fetchMock);
  const changed = vi.fn();
  const view = render(<QuickWorkoutEditor session={session} disabled={false} onChanged={changed} onError={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit workout" }));
  fireEvent.click(screen.getByRole("button", { name: "Review saved sets" }));
  expect(await screen.findByText("Dumbbell Row · Set 1: 10 reps · 40 lb saved")).toBeVisible();
  view.rerender(<QuickWorkoutEditor session={{ ...session, revision: 4 }} disabled={false} onChanged={changed} onError={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Keep saved sets" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Keep saved sets" }));
  expect(changed).not.toHaveBeenCalled();
  expect(localStorage.getItem("magni.quick.645.append")).not.toBeNull();
});

it("prevents append writes without durable storage and never offers to accept a failed legacy review", async () => {
  const { QuickWorkoutEditor } = await import("./QuickWorkoutEditor");
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  const error = vi.fn();
  const first = render(<QuickWorkoutEditor session={{ ...initialSession, id: 646 }} disabled={false} onChanged={vi.fn()} onError={error} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit workout" }));
  const storage = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Full"); });
  fireEvent.click(screen.getByRole("button", { name: "Add similar set" }));
  expect(fetchMock).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledWith(expect.stringContaining("Device storage is unavailable"));
  storage.mockRestore(); first.unmount();
  localStorage.setItem("magni.quick.647.append", JSON.stringify({ setId: 7, requestKey: "legacy-review-failed" }));
  fetchMock.mockRejectedValue(new Error("Review unavailable"));
  render(<QuickWorkoutEditor session={{ ...initialSession, id: 647 }} disabled={false} onChanged={vi.fn()} onError={error} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit workout" }));
  fireEvent.click(screen.getByRole("button", { name: "Review saved sets" }));
  expect(screen.queryByRole("button", { name: "Keep saved sets" })).not.toBeInTheDocument();
  await waitFor(() => expect(error).toHaveBeenCalledWith("Review unavailable"));
  expect(screen.queryByRole("button", { name: "Keep saved sets" })).not.toBeInTheDocument();
  expect(localStorage.getItem("magni.quick.647.append")).not.toBeNull();
});

it("keeps revision3 when an earlier exercise-add revision2 acknowledgement arrives last",async()=>{
 const session = { ...initialSession, id: 648, name: "Initial", date: "2026-10-21", revision: 1 };
 let added!:(value:Response)=>void;let logged!:(value:Response)=>void;
 const writes:RequestInit[]=[];
 vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{
  if(url.endsWith("/sets")&&init?.method==="POST")return new Promise<Response>(resolve=>{added=resolve;});
  if(url.endsWith("/sets")&&init?.method==="PUT")return new Promise<Response>(resolve=>{logged=resolve;});
  if(init?.method==="PUT"){writes.push(init);return response({...session,revision:4});}
  return response([]);
 }));
 render(<QuickWorkout initialSession={session}/>);
 fireEvent.click(screen.getByRole("button",{name:"Add exercise"}));
 fireEvent.change(screen.getByLabelText("New exercise name"),{target:{value:"Curl"}});
 fireEvent.click(screen.getByRole("button",{name:"Add to workout"}));
 fireEvent.change(screen.getByRole("spinbutton",{name:"Reps for set 1"}),{target:{value:"7"}});
 fireEvent.click(screen.getByRole("button",{name:"Save set 1"}));
 await act(async()=>logged(response({actual_reps:7,actual_weight:40,sessionRevision:3})));
 await act(async()=>added(response({sets:[{...session.sets[0],id:8,exercise_name:"Curl",exercise_key:"curl",actual_reps:null,actual_weight:null}],sessionRevision:2})));
 fireEvent.click(screen.getByRole("button",{name:"Edit workout"}));
 fireEvent.change(screen.getByLabelText("Workout name"),{target:{value:"After concurrent writes"}});
 fireEvent.click(screen.getByRole("button",{name:"Save workout changes"}));
 await waitFor(()=>expect(writes).toHaveLength(1));
 expect(JSON.parse(String(writes[0].body)).expectedRevision).toBe(3);
});

it("prevents a row write during an append's canonical read, preserving the new row and later edits", async () => {
  const session = { ...initialSession, id: 649, name: "Initial", revision: 1 };
  const appended = { ...session.sets[0], id: 8, set_number: 2, actual_reps: null, actual_weight: null };
  let read!: (response: Response) => void;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return response({ sets: [appended], sessionRevision: 2 });
    if (init?.method === "GET") return new Promise<Response>(resolve => { read = resolve; });
    if (url.endsWith("/sets")) return response({ actual_reps: 7, actual_weight: 40, sessionRevision: 3 });
    return response({ ...session, sets: [session.sets[0], appended], revision: 4 });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<QuickWorkout initialSession={session} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit workout" }));
  fireEvent.click(screen.getByRole("button", { name: "Add similar set" }));
  await waitFor(() => expect(read).toBeDefined());
  expect(screen.getByRole("spinbutton", { name: "Reps for set 1" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Undo set 1" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Undo set 1" }));
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Add exercise" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Delete workout" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Finish workout" })).toBeDisabled();
  await act(async () => read(response({ ...session, sets: [session.sets[0], appended], revision: 2 })));
  expect(screen.getByRole("spinbutton", { name: "Reps for set 1" })).toBeEnabled();
  expect(screen.getByRole("spinbutton", { name: "Reps for set 2" })).toHaveValue(10);
  editReps("7"); fireEvent.click(screen.getByRole("button", { name: "Save set 1" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Undo set 1" })).toBeEnabled());
  expect(screen.getByRole("spinbutton", { name: "Reps for set 1" })).toHaveValue(7);
  fireEvent.change(screen.getByLabelText("Workout name"), { target: { value: "After concurrent writes" } });
  fireEvent.click(screen.getByRole("button", { name: "Save workout changes" }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url, init]) => !url.endsWith("/sets") && init?.method === "PUT")).toHaveLength(1));
  const [, write] = fetchMock.mock.calls.find(([url, init]) => !url.endsWith("/sets") && init?.method === "PUT")!;
  expect(JSON.parse(String(write?.body)).expectedRevision).toBe(3);
});

it("offers canonical review after a confirmed missing-source append rejection without dropping its pending intent early", async () => {
  const pending = { setId: 7, requestKey: "removed-source-key", body: { name: "Dumbbell Row", prescription: [{ reps: 10, weight: 40 }], appendToSetId: 7, requestKey: "removed-source-key" } };
  const session = { ...initialSession, id: 650, revision: 4, sets: [{ ...initialSession.sets[0], id: 8 }] };
  localStorage.setItem("magni.quick.650.append", JSON.stringify(pending));
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST" ? response({ error: "Exercise not found in this workout." }, 404) : response(session));
  vi.stubGlobal("fetch", fetchMock);
  render(<QuickWorkout initialSession={session} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit workout" }));
  fireEvent.click(screen.getByRole("button", { name: "Retry add set" }));
  await screen.findByText("Exercise not found in this workout.");
  expect(screen.getByRole("button", { name: "Finish workout" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Review saved sets" }));
  fireEvent.click(await screen.findByRole("button", { name: "Keep saved sets" }));
  expect(screen.getByRole("button", { name: "Finish workout" })).toBeEnabled();
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
});
