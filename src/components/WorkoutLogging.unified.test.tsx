// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickWorkout } from "./QuickWorkout";
import { WorkoutCard } from "./WorkoutCard";
import type { WorkoutSet } from "./workout-card-utils";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const props = { programId: 2, dayId: 3, programName: "Strength", dayName: "Upper", currentWeek: 1, currentDay: 1 };
const row: WorkoutSet = { id: 7, exercise_name: "Row", reps: 10, sets: 1, set_number: 1, rep_out_target: 10, calculated_weight: 62.5, actual_reps: 0, actual_weight: 62.5, superset_group: null };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => { const storage = new Map<string, string>(); vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
for (const format of ["quick", "planned", "focus"] as const) describe(`${format} exercise cards`, () => {
  const label = format === "quick" ? "Reps for set 1" : "Row set 1 reps";
  const finish = format === "quick" ? "Finish workout" : "Finish Workout";
  function setup(save: () => Promise<Response>, sets = [row]) {
    const session = { id: 42, sets };
    const fetchMock = vi.fn((url: string) => url.includes("/sessions/current") ? Promise.resolve(response(session)) : save());
    vi.stubGlobal("fetch", fetchMock);
    const mount = () => render(format === "quick" ? <QuickWorkout initialSession={session} /> : <WorkoutCard {...props} focusMode={format === "focus"} />);
    return { mount, fetchMock };
  }
  it("uses newer acknowledged actuals instead of labeling old retained Undo inputs Saved", async () => {
    const key = `magni.${format === "quick" ? "quick" : "planned"}-workout.42.draft.v1`;
    localStorage.setItem(key, JSON.stringify({ 7: { reps: "0", weight: "62.5", intent: "retained", [format === "quick" ? "base" : "expectedActual"]: { reps: null, weight: null } } }));
    const { mount, fetchMock } = setup(async () => response({ actual_reps: null, actual_weight: null }), [{ ...row, actual_reps: 10, actual_weight: 65 }]); mount();
    expect(await screen.findByRole("spinbutton", { name: label })).toHaveValue(10);
    fireEvent.click(screen.getByRole("button", { name: "Undo set 1" }));
    await screen.findByText("Not logged");
    const calls = (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => url.endsWith("/sets"));
    expect(JSON.parse(calls[0][1].body as string)).toMatchObject({ expectedActual: { reps: 10, weight: 65 } });
  });
  it("keeps the exercise heading canonical while the disclosure action changes", async () => {
    const { mount } = setup(async () => response({})); mount();
    expect(await screen.findByRole("heading", { name: "Row" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Row" }));
    expect(screen.getByRole("heading", { name: "Row" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Expand Row" })).toHaveAttribute("aria-expanded", "false");
  });
  it("shows a saved missing load honestly without replacing it with the prescription", async () => {
    const { mount } = setup(async () => response({}), [{ ...row, actual_reps: 10, actual_weight: null }]); mount();
    const weightLabel = format === "quick" ? "Weight for set 1" : "Row set 1 weight (lb)";
    expect(await screen.findByRole("spinbutton", { name: weightLabel })).toHaveValue(null);
    expect(screen.getByText("Saved · load not recorded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: finish })).toBeEnabled();
    if (format !== "quick") expect(screen.getByText("0 lb · 1 set")).toBeInTheDocument();
  });
  it("persists the acknowledged baseline before undoing an older draft without one", async () => {
    const key = `magni.${format === "quick" ? "quick" : "planned"}-workout.42.draft.v1`;
    localStorage.setItem(key, JSON.stringify({ 7: { reps: "8", weight: "65" } }));
    const { mount, fetchMock } = setup(async () => { throw new Error("Offline"); }); mount();
    fireEvent.click(await screen.findByRole("button", { name: "Undo set 1" }));
    await screen.findByText("Undo unconfirmed");
    const pending = JSON.parse(localStorage.getItem(key)!)[7];
    expect(pending[format === "quick" ? "base" : "expectedActual"]).toEqual({ reps: 0, weight: 62.5 });
    const calls = (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => url.endsWith("/sets"));
    expect(JSON.parse(calls[0][1].body as string)).toMatchObject({ expectedActual: { reps: 0, weight: 62.5 } });
  });
  it("names an aggregate Undo honestly and sends its one existing identity", async () => {
    const { mount, fetchMock } = setup(async () => response({ actual_reps: null, actual_weight: null }), [{ ...row, sets: 3 }]); mount();
    fireEvent.click(await screen.findByRole("button", { name: "Undo 3-set log" }));
    await screen.findByText("Not logged");
    expect(screen.getByText("3 sets · batch")).toBeInTheDocument();
    const calls = (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => url.endsWith("/sets"));
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0][1].body as string)).toMatchObject({ setId: 7, actualReps: null, actualWeight: null });
  });
  it("keeps edited values and a visible warning when a lift is manually collapsed", async () => {
    const { mount } = setup(async () => response({})); mount();
    fireEvent.change(await screen.findByRole("spinbutton", { name: label }), { target: { value: "8" } });
    const collapse = screen.getByRole("button", { name: "Collapse Row" }); collapse.focus(); fireEvent.click(collapse);
    expect(screen.getByRole("button", { name: "Expand Row" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Expand Row" })).toHaveTextContent("Unsaved changes");
    expect(screen.getByRole("button", { name: "Expand Row" })).toHaveAccessibleDescription(/Unsaved changes/);
    expect(screen.getByRole("button", { name: "Expand Row" })).toHaveFocus();
    expect(screen.queryByRole("spinbutton", { name: label })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand Row" }));
    expect(screen.getByRole("spinbutton", { name: label })).toHaveValue(8);
  });
  it("undoes a saved zero-rep set conditionally and retains inputs without blocking partial finish", async () => {
    const { mount, fetchMock } = setup(async () => response({ actual_reps: null, actual_weight: null, sessionRevision: 3 }));
    const first = mount(); fireEvent.click(await screen.findByRole("button", { name: "Undo set 1" }));
    await waitFor(() => expect(screen.getByText("Not logged")).toBeInTheDocument());
    expect(screen.getByRole("spinbutton", { name: label })).toHaveValue(0);
    expect(screen.getByRole("button", { name: finish })).toBeEnabled();
    const call = fetchMock.mock.calls.find(([url]) => url.endsWith("/sets"));
    expect(call).toBeDefined();
    expect(JSON.parse((fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) => url.endsWith("/sets"))![1].body as string)).toEqual({ setId: 7, actualReps: null, actualWeight: null, expectedActual: { reps: 0, weight: 62.5 } });
    first.unmount();
    if (format === "quick") render(<QuickWorkout initialSession={{ id: 42, sets: [{ ...row, actual_reps: null, actual_weight: null }] }} />);
    else { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ id: 42, sets: [{ ...row, actual_reps: null, actual_weight: null }] }))); mount(); }
    expect(await screen.findByRole("spinbutton", { name: label })).toHaveValue(0);
    expect(screen.getByRole("button", { name: finish })).toBeEnabled();
  });
  it("retains an uncertain Undo across remount, blocks finish, and retries null actuals", async () => {
    let count = 0;
    const { mount, fetchMock } = setup(async () => ++count === 1 ? response({ success: true }) : response({ actual_reps: null, actual_weight: null }));
    const first = mount(); fireEvent.click(await screen.findByRole("button", { name: "Undo set 1" }));
    expect(await screen.findByText("Undo unconfirmed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: finish })).toBeDisabled();
    first.unmount(); mount();
    fireEvent.click(await screen.findByRole("button", { name: "Retry undo set 1" }));
    await waitFor(() => expect(screen.getByText("Not logged")).toBeInTheDocument());
    const calls = (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => url.endsWith("/sets"));
    expect(calls).toHaveLength(2);
    expect(calls.map(([, init]) => JSON.parse(init.body as string).actualReps)).toEqual([null, null]);
  });
  it("keeps an edit made during Undo pending against the acknowledged null baseline", async () => {
    let resolve!: (response: Response) => void;
    const { mount, fetchMock } = setup(() => new Promise(done => { resolve = done; })); mount();
    fireEvent.click(await screen.findByRole("button", { name: "Undo set 1" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: label }), { target: { value: "8" } });
    await act(async () => resolve(response({ actual_reps: null, actual_weight: null })));
    expect(screen.getByRole("spinbutton", { name: label })).toHaveValue(8);
    expect(screen.getByRole("button", { name: finish })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save set 1" }));
    const calls = (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => url.endsWith("/sets"));
    expect(JSON.parse(calls[1][1].body as string)).toMatchObject({ actualReps: 8, expectedActual: { reps: null, weight: null } });
    await act(async () => resolve(response({ actual_reps: 8, actual_weight: 62.5 })));
  });
});
