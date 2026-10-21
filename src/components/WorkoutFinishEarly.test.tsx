// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkoutCard } from "./WorkoutCard";
import { QuickWorkout } from "./QuickWorkout";
import type { SessionResponse } from "./workout-card-utils";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("./WorkoutTmEditor", () => ({ WorkoutTmEditor: () => null }));
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const initial: SessionResponse = { id: 42, unit: "lb", sets: [1, 2, 3].map(id => ({ id, exercise_name: "Row", sets: 1, reps: 10, rep_out_target: 10, set_number: id, calculated_weight: 40, actual_reps: id === 1 ? 10 : null, actual_weight: id === 1 ? 40 : null, superset_group: null })) };
type Kind = "planned" | "quick";
const draftKey = (kind: Kind) => `magni.${kind === "planned" ? "planned-workout" : "quick-workout"}.42.draft.v1`;
const finish = () => screen.getByRole("button", { name: /^Finish workout$/i });
const dialog = () => screen.getByRole("dialog", { name: "Finish with saved sets?" });
const confirm = () => within(dialog()).getByRole("button", { name: "Finish with saved sets" });
const reps = (kind: Kind, number: number) => screen.getByRole("spinbutton", { name: kind === "planned" ? `Row set ${number} reps` : `Reps for set ${number}` });
const weight = (kind: Kind, number: number) => screen.getByRole("spinbutton", { name: kind === "planned" ? `Row set ${number} weight (lb)` : `Weight for set ${number}` });
function server(options: { complete?: () => Promise<Response>; canonical?: () => Promise<Response>; save?: () => Promise<Response> } = {}) {
  const api = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/sessions/current")) return response(initial);
    if (url === "/api/sessions/42" && (!init?.method || init.method === "GET")) return options.canonical?.() ?? response(initial);
    if (url.endsWith("/sets")) return options.save?.() ?? response({ actual_reps: 10, actual_weight: 40 });
    if (url.endsWith("/complete-and-advance") || init?.method === "PATCH") return options.complete?.() ?? response({ success: true, volume: 400, loggedCount: 1, skippedCount: 2 });
    return response({ prs: [] });
  });
  vi.stubGlobal("fetch", api);
  return api;
}
async function mount(kind: Kind) {
  const view = render(kind === "planned" ? <WorkoutCard programId={4} dayId={5} occurrenceId={19} programName="Strength" dayName="Rows" currentWeek={1} currentDay={1} /> : <QuickWorkout initialSession={initial} />);
  await screen.findByRole("spinbutton", { name: kind === "planned" ? "Row set 1 reps" : "Reps for set 1" });
  return view;
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe.each<Kind>(["planned", "quick"])("%s finish with saved sets", kind => {
  it("allows prefilled unfinished sets to finish without writing any unperformed actuals", async () => {
    const api = server();
    await mount(kind);
    fireEvent.change(weight(kind, 2), { target: { value: "42.5" } });
    fireEvent.change(reps(kind, 3), { target: { value: "" } });
    expect(finish()).toBeEnabled();
    fireEvent.click(finish());
    expect(within(dialog()).getByRole("button", { name: "Keep training" })).toHaveFocus();
    expect(localStorage.getItem(draftKey(kind))).not.toBeNull();
    fireEvent.click(confirm());
    await screen.findByText(kind === "planned" ? "Workout complete" : "Quick workout complete");
    expect(screen.getByText(/400 lb total/)).toBeVisible();
    expect(api.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
    expect(localStorage.getItem(draftKey(kind))).toBeNull();
  });

  it.each(["Keep training", "Escape"])("%s preserves changed saved and unlogged inputs, and returns focus", async choice => {
    const api = server();
    await mount(kind);
    fireEvent.change(reps(kind, 1), { target: { value: "7" } });
    fireEvent.change(weight(kind, 2), { target: { value: "42.5" } });
    const pending = localStorage.getItem(draftKey(kind));
    const trigger = finish();
    fireEvent.click(trigger);
    if (choice === "Escape") fireEvent(dialog(), new Event("cancel", { bubbles: true, cancelable: true }));
    else fireEvent.click(within(dialog()).getByRole("button", { name: choice }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(reps(kind, 1)).toHaveValue(7);
    expect(weight(kind, 2)).toHaveValue(42.5);
    expect(localStorage.getItem(draftKey(kind))).toBe(pending);
    expect(api.mock.calls.filter(([, init]) => init?.method && init.method !== "GET")).toHaveLength(0);
  });

  it("keeps drafts and the dialog through a failed completion, then retries using the saved result", async () => {
    let calls = 0;
    const api = server({ complete: async () => ++calls === 1 ? response({ error: "Connection interrupted" }, 503) : response({ success: true, volume: 400, loggedCount: 1, skippedCount: 2 }) });
    await mount(kind);
    fireEvent.change(reps(kind, 1), { target: { value: "7" } });
    const pending = localStorage.getItem(draftKey(kind));
    fireEvent.click(finish()); fireEvent.click(confirm());
    await waitFor(() => expect(within(dialog()).getByRole("alert")).toHaveTextContent("Connection interrupted"));
    expect(localStorage.getItem(draftKey(kind))).toBe(pending);
    expect(confirm()).toBeEnabled();
    fireEvent.click(confirm());
    await screen.findByText(kind === "planned" ? "Workout complete" : "Quick workout complete");
    expect(screen.getByText(/400 lb total/)).toBeVisible();
    expect(api.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
    expect(calls).toBe(2);
  });

  it("blocks finishing while saving and after a failed save even if its inputs are edited again", async () => {
    let reject!: (reason: Error) => void;
    server({ save: () => new Promise((_resolve, fail) => { reject = fail; }) });
    await mount(kind);
    fireEvent.change(reps(kind, 1), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Save set 1" }));
    expect(finish()).toBeDisabled();
    await act(async () => reject(new Error("Save response lost")));
    expect(finish()).toBeDisabled();
    fireEvent.change(reps(kind, 1), { target: { value: "8" } });
    expect(finish()).toBeDisabled();
  });

  it("preserves the acknowledged baseline when a saved-row correction is kept after cancellation", async () => {
    const api = server({ save: async () => response({ actual_reps: 7, actual_weight: 40 }) });
    await mount(kind);
    fireEvent.change(reps(kind, 1), { target: { value: "7" } });
    fireEvent.click(finish());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Keep training" }));
    fireEvent.click(screen.getByRole("button", { name: "Save set 1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo set 1" })).toBeEnabled());
    const writes = api.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0][1]!.body as string)).toEqual({ setId: 1, actualReps: 7, actualWeight: 40, expectedActual: { reps: 10, weight: 40 } });
  });

  it("keeps conflicting actuals blocked until their explicit recovery", async () => {
    server({ save: async () => response({ error: "Changed on another device" }, 409) });
    await mount(kind);
    fireEvent.change(reps(kind, 1), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Save set 1" }));
    await screen.findByRole("button", { name: "Use saved values" });
    expect(finish()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Use saved values" }));
    expect(finish()).toBeEnabled();
  });

  it("keeps confirmation and drafts locked through the completion response", async () => {
    let resolve!: (result: Response) => void;
    const api = server({ complete: () => new Promise(done => { resolve = done; }) });
    await mount(kind);
    fireEvent.change(weight(kind, 2), { target: { value: "42.5" } });
    fireEvent.click(finish()); fireEvent.click(confirm());
    const pending = localStorage.getItem(draftKey(kind));
    expect(within(dialog()).getByRole("button", { name: "Keep training" })).toBeDisabled();
    fireEvent(dialog(), new Event("cancel", { bubbles: true, cancelable: true }));
    expect(dialog()).toBeVisible();
    expect(localStorage.getItem(draftKey(kind))).toBe(pending);
    expect(api.mock.calls.filter(([, init]) => ["POST", "PATCH"].includes(init?.method ?? ""))).toHaveLength(1);
    await act(async () => resolve(response({ success: true, volume: 400, loggedCount: 1, skippedCount: 2 })));
    await screen.findByText(kind === "planned" ? "Workout complete" : "Quick workout complete");
  });

  it("keeps a persisted unconfirmed Undo blocked", async () => {
    localStorage.setItem(draftKey(kind), JSON.stringify({ 1: { reps: "10", weight: "40", intent: "undo" } }));
    server(); await mount(kind);
    expect(finish()).toBeDisabled();
  });
});

it("loads canonical planned actuals after an acknowledged finish, including a recovered lost save", async () => {
  localStorage.setItem(draftKey("planned"), JSON.stringify({ 1: { reps: "12", weight: "45", expectedActual: { reps: 10, weight: 40 } }, 2: { reps: "10", weight: "42.5" } }));
  const canonical = { ...initial, sets: initial.sets.map(set => set.id === 1 ? { ...set, actual_reps: 12, actual_weight: 45 } : set) };
  const api = server({ canonical: async () => response(canonical) });
  await mount("planned");
  fireEvent.click(finish()); fireEvent.click(confirm());
  await screen.findByText("Workout complete");
  expect(screen.getByText("540 lb total")).toBeVisible();
  const requests = api.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`);
  expect(requests.indexOf("GET /api/sessions/42")).toBeGreaterThan(requests.indexOf("POST /api/programs/4/complete-and-advance"));
  expect(requests.some(request => request.startsWith("PUT"))).toBe(false);
});

it("retains planned drafts if canonical result retrieval fails, and supports completion retry", async () => {
  let reads = 0;
  server({ canonical: async () => ++reads === 1 ? response({ error: "Result unavailable" }, 503) : response(initial) });
  await mount("planned");
  fireEvent.change(weight("planned", 2), { target: { value: "42.5" } });
  const pending = localStorage.getItem(draftKey("planned"));
  fireEvent.click(finish()); fireEvent.click(confirm());
  await waitFor(() => expect(within(dialog()).getByRole("alert")).toHaveTextContent(/result|saved/i));
  expect(screen.queryByText("Workout complete")).not.toBeInTheDocument();
  expect(localStorage.getItem(draftKey("planned"))).toBe(pending);
  fireEvent.click(confirm());
  await screen.findByText("Workout complete");
  expect(localStorage.getItem(draftKey("planned"))).toBeNull();
});

it("retains the explicit missing-template hold choice inside an early-finish retry", async () => {
  let completions = 0;
  const api = server({ complete: async () => ++completions === 1 ? response({ error: "Template unavailable", code: "missing_legacy_template" }, 409) : response({ success: true }) });
  await mount("planned");
  fireEvent.change(weight("planned", 2), { target: { value: "42.5" } });
  fireEvent.click(finish()); fireEvent.click(confirm());
  const hold = await within(dialog()).findByRole("button", { name: "Finish without changing affected training maxes" });
  fireEvent.click(hold);
  await screen.findByText("Workout complete");
  const requests = api.mock.calls.filter(([url]) => url.endsWith("/complete-and-advance"));
  expect(JSON.parse(requests[1][1]!.body as string)).toEqual({ sessionId: 42, unavailableTemplatePolicy: "hold" });
});

it("uses Quick's authoritative completion recap for an ordinary restored draft with uncertain prior acknowledgement", async () => {
  localStorage.setItem(draftKey("quick"), JSON.stringify({ 1: { reps: "12", weight: "45", base: { reps: 10, weight: 40 } } }));
  const api = server({ complete: async () => response({ volume: 540, loggedCount: 1, skippedCount: 2 }) });
  await mount("quick");
  fireEvent.click(finish()); fireEvent.click(confirm());
  await screen.findByText("Quick workout complete");
  expect(screen.getByText(/540 lb total/)).toBeVisible();
  expect(api.mock.calls).toHaveLength(1);
  expect(api.mock.calls[0]).toEqual(["/api/sessions/42", { method: "PATCH" }]);
  expect(localStorage.getItem(draftKey("quick"))).toBeNull();
});
