// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuickWorkout } from "./QuickWorkout";

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([false, true])("gates startup until hydration, restores drafts (%s), then submits the entered metadata", async (savedDraft) => {
  if (savedDraft) localStorage.setItem("magni.quick.start.2026-09-01", JSON.stringify({ name: "Restored rows", date: "2026-08-31", unit: "kg" }));
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 88, name: "September pull", date: "2026-09-02", unit: "kg", sets: [] }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  const element = <QuickWorkout initialSession={null} initialDate="2026-09-01" />;
  container.innerHTML = renderToString(element);
  document.body.appendChild(container);
  const card = within(container);
  let root: Root | undefined;
  try {
    expect(card.getByLabelText("Workout name")).toBeDisabled();
    expect(card.getByLabelText("Workout date")).toBeDisabled();
    expect(card.getByLabelText("Workout units")).toBeDisabled();
    expect(card.getByRole("button", { name: "Quick workout" })).toBeDisabled();
    await act(async () => { root = hydrateRoot(container, element); });
    await waitFor(() => expect(card.getByLabelText("Workout name")).toBeEnabled());
    expect(card.getByLabelText("Workout name")).toHaveValue(savedDraft ? "Restored rows" : "Quick Workout");
    expect(card.getByLabelText("Workout date")).toHaveValue(savedDraft ? "2026-08-31" : "2026-09-01");
    expect(card.getByLabelText("Workout units")).toHaveValue(savedDraft ? "kg" : "lb");
    fireEvent.change(card.getByLabelText("Workout name"), { target: { value: "September pull" } });
    fireEvent.change(card.getByLabelText("Workout date"), { target: { value: "2026-09-02" } });
    fireEvent.change(card.getByLabelText("Workout units"), { target: { value: "kg" } });
    fireEvent.click(card.getByRole("button", { name: "Quick workout" }));
    await card.findByRole("heading", { name: "September pull" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ name: "September pull", date: "2026-09-02", unit: "kg", newWorkout: true });
  } finally {
    await act(async () => root?.unmount());
    container.remove();
  }
});

it.each([false, true])("keeps active controls inert until saved values or pending drafts (%s) are restored", async (savedDraft) => {
  const set = { id: 307, exercise_name: "Row", reps: 10, sets: 1, set_number: 1, rep_out_target: 10, calculated_weight: 40, actual_reps: 10, actual_weight: 40, superset_group: null };
  const session = { id: 304, name: "Active rows", date: "2026-09-01", unit: "kg" as const, sets: [set] };
  if (savedDraft) localStorage.setItem("magni.quick-workout.304.draft.v1", JSON.stringify({ 307: { reps: "12", weight: "45", base: { reps: 10, weight: 40 } } }));
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  const element = <QuickWorkout initialSession={session} />;
  container.innerHTML = renderToString(element);
  document.body.appendChild(container);
  const card = within(container);
  let root: Root | undefined;
  try {
    expect(card.getByRole("spinbutton", { name: "Reps for set 1" })).toBeDisabled();
    expect(card.getByRole("spinbutton", { name: "Weight for set 1" })).toBeDisabled();
    for (const button of card.getAllByRole("button")) expect(button).toBeDisabled();
    await act(async () => { root = hydrateRoot(container, element); });
    await waitFor(() => expect(card.getByRole("spinbutton", { name: "Reps for set 1" })).toBeEnabled());
    expect(card.getByRole("spinbutton", { name: "Reps for set 1" })).toHaveValue(savedDraft ? 12 : 10);
    expect(card.getByRole("spinbutton", { name: "Weight for set 1" })).toHaveValue(savedDraft ? 45 : 40);
    expect(card.getByText(savedDraft ? "Unsaved" : "Saved", { exact: true })).toBeInTheDocument();
    expect(card.getByRole("button", { name: "Add exercise" })).toBeEnabled();
    if (savedDraft) expect(card.getByRole("button", { name: "Finish workout" })).toBeDisabled();
    else expect(card.getByRole("button", { name: "Finish workout" })).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    await act(async () => root?.unmount());
    container.remove();
  }
});

it("keeps submitted metadata disabled until the pending create acknowledgement arrives", async () => {
  let resolve!: (response: Response) => void;
  const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>((done) => { resolve = done; }));
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  const element = <QuickWorkout initialSession={null} initialDate="2026-09-01" />;
  container.innerHTML = renderToString(element);
  document.body.appendChild(container);
  const card = within(container);
  let root: Root | undefined;
  try {
    await act(async () => { root = hydrateRoot(container, element); });
    await waitFor(() => expect(card.getByLabelText("Workout name")).toBeEnabled());
    fireEvent.change(card.getByLabelText("Workout name"), { target: { value: "Submitted rows" } });
    fireEvent.change(card.getByLabelText("Workout date"), { target: { value: "2026-09-02" } });
    fireEvent.change(card.getByLabelText("Workout units"), { target: { value: "kg" } });
    fireEvent.click(card.getByRole("button", { name: "Quick workout" }));
    for (const name of ["Workout name", "Workout date", "Workout units"]) expect(card.getByLabelText(name)).toBeDisabled();
    expect(card.getByRole("button", { name: "Starting…" })).toBeDisabled();
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({ name: "Submitted rows", date: "2026-09-02", unit: "kg" });
  } finally {
    await act(async () => resolve(new Response(JSON.stringify({ id: 88, name: "Submitted rows", date: "2026-09-02", unit: "kg", sets: [] }), { status: 201 })));
    await act(async () => root?.unmount());
    container.remove();
  }
});

it.each(["network", "server error", "empty success", "empty rejection", "conflict"])("keeps metadata and retry identity locked through %s and remount", async (failure) => {
  const fetchMock = vi.fn();
  if (failure === "network") fetchMock.mockRejectedValueOnce(new Error("Connection lost"));
  else fetchMock.mockResolvedValueOnce(new Response(failure.startsWith("empty") ? "" : JSON.stringify({ error: "Unconfirmed create" }), { status: failure === "server error" ? 500 : failure === "conflict" ? 409 : failure === "empty rejection" ? 400 : 200 }));
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 88, name: "Submitted rows", date: "2026-09-02", unit: "kg", sets: [] }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  const first = render(<QuickWorkout initialSession={null} initialDate="2026-09-01" />);
  fireEvent.change(screen.getByLabelText("Workout name"), { target: { value: "Submitted rows" } });
  fireEvent.change(screen.getByLabelText("Workout date"), { target: { value: "2026-09-02" } });
  fireEvent.change(screen.getByLabelText("Workout units"), { target: { value: "kg" } });
  fireEvent.click(screen.getByRole("button", { name: "Quick workout" }));
  await screen.findByRole("button", { name: "Retry starting workout" });
  for (const name of ["Workout name", "Workout date", "Workout units"]) expect(screen.getByLabelText(name)).toBeDisabled();
  // Even a queued programmatic change cannot mutate the submitted create intent.
  fireEvent.change(screen.getByLabelText("Workout name"), { target: { value: "Later edit" } });
  expect(screen.getByLabelText("Workout name")).toHaveValue("Submitted rows");
  const submitted = JSON.parse(fetchMock.mock.calls[0][1].body);
  first.unmount();
  render(<QuickWorkout initialSession={null} initialDate="2026-09-01" />);
  expect(screen.getByRole("status")).toHaveTextContent("Retry to recover");
  expect(screen.getByLabelText("Workout name")).toHaveValue("Submitted rows");
  expect(screen.getByLabelText("Workout date")).toHaveValue("2026-09-02");
  expect(screen.getByLabelText("Workout units")).toHaveValue("kg");
  expect(screen.getByLabelText("Workout name")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry starting workout" }));
  await screen.findByRole("heading", { name: "Submitted rows" });
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(submitted);
});

it("allows metadata correction with a new key only after a confirmed validation rejection", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "Enter a name from 1 to 140 characters." }), { status: 400 }))
    .mockResolvedValue(new Response(JSON.stringify({ id: 88, name: "Corrected rows", date: "2026-09-02", unit: "kg", sets: [] }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<QuickWorkout initialSession={null} initialDate="2026-09-01" />);
  fireEvent.change(screen.getByLabelText("Workout name"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Quick workout" }));
  await screen.findByText("Enter a name from 1 to 140 characters.");
  for (const name of ["Workout name", "Workout date", "Workout units"]) expect(screen.getByLabelText(name)).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Workout name"), { target: { value: "Corrected rows" } });
  fireEvent.change(screen.getByLabelText("Workout date"), { target: { value: "2026-09-02" } });
  fireEvent.change(screen.getByLabelText("Workout units"), { target: { value: "kg" } });
  fireEvent.click(screen.getByRole("button", { name: "Quick workout" }));
  await screen.findByRole("heading", { name: "Corrected rows" });
  const [rejected, corrected] = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body));
  expect(corrected.requestKey).not.toBe(rejected.requestKey);
  expect(corrected).toMatchObject({ name: "Corrected rows", date: "2026-09-02", unit: "kg" });
});
