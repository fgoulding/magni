// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkoutCard } from "./WorkoutCard";
import type { SessionResponse } from "./workout-card-utils";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const props = { occurrenceId: 19, programId: 4, dayId: 5, programName: "Full body", dayName: "Squat day", currentWeek: 1, currentDay: 1 };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function session(saved = false): SessionResponse {
  return { id: 981, unit: "kg", sets: ["Squat", "Row"].flatMap((name, appearance) => [1, 2].map(number => ({
    id: (appearance + 1) * 10 + number, exercise_name: name, reps: 5, sets: 1, set_number: number, rep_out_target: 8,
    calculated_weight: appearance ? 42.5 : 100, actual_reps: saved ? 8 : null, actual_weight: saved ? (appearance ? 42.5 : 100) : null,
    superset_group: "A", editor_json: JSON.stringify({ exerciseId: name, progressionKey: "shared", unit: "kg",
      set: { id: `${name}-${number}`, role: number === 1 ? "top" : "backoff", effortKind: "rpe", effort: 8, restSeconds: 90, tempo: "3-1-1", notes: `${name} cue` } }),
  }))) };
}
function server(body = session(), handle?: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/sessions/current")) return response(body);
    if (handle) return handle(url, init);
    if (init?.method === "PUT") {
      const data = JSON.parse(init.body as string);
      const set = body.sets.find(set => set.id === data.setId)!;
      set.actual_reps = data.actualReps; set.actual_weight = data.actualWeight;
      return response({ actual_reps: data.actualReps, actual_weight: data.actualWeight });
    }
    return response(body);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, puts: () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT").map(([, init]) => JSON.parse(init!.body as string)) };
}
const setAction = (label = "1a", undo = false) => screen.getByRole("button", { name: `${undo ? "Undo" : "Save"} set ${label}` });
const disclosure = (number = 1, expanded = true) => screen.getByRole("button", { name: `${expanded ? "Collapse" : "Expand"} Round ${number} of superset A` });
const round = (number = 1) => within(screen.getByRole("group", { name: `Round ${number} of superset A` }));
const edit = (name: string, value: string) => fireEvent.change(screen.getByRole("spinbutton", { name }), { target: { value } });
async function ready() { await screen.findByRole("spinbutton", { name: "Squat set 1a reps" }); }
async function logSet(label = "1a") { fireEvent.click(setAction(label)); await waitFor(() => expect(setAction(label, true)).toBeEnabled()); }
async function undoSet(label = "1a") { fireEvent.click(setAction(label, true)); await waitFor(() => expect(setAction(label)).toBeEnabled()); }
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("active superset rounds", () => {
  it("manually collapses each round without writing or replacing entered values", async () => {
    const api = server(); render(<WorkoutCard {...props} />); await ready();
    expect(disclosure()).toHaveAttribute("aria-expanded", "true");
    expect(disclosure(2)).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("button", { name: /^(Save|Undo) round/ })).not.toBeInTheDocument();
    const input = screen.getByRole("spinbutton", { name: "Row set 1b weight (kg)" });
    edit("Row set 1b weight (kg)", "46.25");
    const toggle = disclosure(); toggle.focus(); fireEvent.click(toggle);
    expect(disclosure(1, false)).toBe(toggle); expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("Unsaved changes");
    expect(toggle).toHaveTextContent("Squat + Row");
    expect(input).not.toBeVisible();
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toContainElement(input);
    expect(disclosure(2)).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(screen.getByRole("spinbutton", { name: "Row set 1b weight (kg)" })).toBe(input);
    expect(input).toHaveValue(46.25); expect(input).toBeVisible();
    expect(api.puts()).toEqual([]);
  });

  it("reopens a saved round without undoing it and never collapses on acknowledgement", async () => {
    const api = server(); render(<WorkoutCard {...props} />); await ready();
    await logSet("1a"); await logSet("1b");
    expect(disclosure()).toHaveAttribute("aria-expanded", "true");
    const input = screen.getByRole("spinbutton", { name: "Row set 1b weight (kg)" });
    const writes = structuredClone(api.puts());
    fireEvent.click(disclosure());
    const toggle = disclosure(1, false);
    expect(toggle).toHaveTextContent("2/2 saved");
    expect(toggle).not.toHaveAttribute("aria-pressed");
    fireEvent.click(toggle);
    expect(screen.getByRole("spinbutton", { name: "Row set 1b weight (kg)" })).toBe(input);
    expect(setAction("1a", true)).toHaveAttribute("aria-pressed", "true");
    expect(setAction("1b", true)).toHaveAttribute("aria-pressed", "true");
    expect(api.puts()).toEqual(writes);
  });

  it("marks only rounds with remaining unlogged sets skipped, preserving fully saved rounds", async () => {
    const api = server(); render(<WorkoutCard {...props} />); await ready();
    await logSet("1a"); await logSet("1b"); await logSet("2a");
    const writes = structuredClone(api.puts());
    fireEvent.click(screen.getByRole("button", { name: "Skip lift" }));
    fireEvent.click(disclosure()); fireEvent.click(disclosure(2));
    expect(disclosure(1, false)).toHaveTextContent("2/2 saved");
    expect(disclosure(1, false)).not.toHaveTextContent(/skipped/i);
    expect(disclosure(2, false)).toHaveTextContent("1/2 saved");
    expect(disclosure(2, false)).toHaveTextContent("Remaining sets skipped");
    fireEvent.click(disclosure(1, false));
    expect(setAction("1a", true)).toBeEnabled(); expect(setAction("1b", true)).toBeEnabled();
    expect(api.puts()).toEqual(writes);
    fireEvent.click(screen.getByRole("button", { name: "Do this lift" }));
    expect(disclosure(2, false)).not.toHaveTextContent(/skipped/i);
  });

  it("renders alternating physical rows and keeps every prescription and input stable on save", async () => {
    const api = server(); render(<WorkoutCard {...props} />); await ready();
    expect(screen.getAllByRole("spinbutton").map(input => input.getAttribute("aria-label"))).toEqual([
      "Squat set 1a reps", "Squat set 1a weight (kg)", "Row set 1b reps", "Row set 1b weight (kg)",
      "Squat set 2a reps", "Squat set 2a weight (kg)", "Row set 2b reps", "Row set 2b weight (kg)",
    ]);
    expect(round().getAllByText(/Top-set target · 5–8 reps/)).toHaveLength(2);
    expect(round(2).getAllByText(/Back-off target · 5–8 reps/)).toHaveLength(2);
    expect(round().queryByText(/RPE 8/)).not.toBeInTheDocument();
    const details = screen.getByText("Details", { exact: true }).closest("details")!;
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Details", { exact: true }));
    expect(within(details).getAllByText("RPE 8 · Rest 90 s · Tempo 3-1-1")).toHaveLength(2);
    expect(within(details).getAllByText("Row cue")).toHaveLength(1);
    fireEvent.click(screen.getByText("Details", { exact: true }));
    const input = screen.getByRole("spinbutton", { name: "Row set 1b weight (kg)" });
    input.focus(); edit("Squat set 1a reps", "6"); edit("Row set 1b weight (kg)", "45.5");
    const button = setAction("1b"); await logSet("1a"); await logSet("1b");
    expect(api.puts()).toEqual([
      { setId: 11, actualReps: 6, actualWeight: 100, expectedActual: { reps: null, weight: null } },
      { setId: 21, actualReps: 8, actualWeight: 45.5, expectedActual: { reps: null, weight: null } },
    ]);
    expect(setAction("1b", true)).toBe(button); expect(button).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("spinbutton", { name: "Row set 1b weight (kg)" })).toBe(input); expect(input).toHaveFocus();
    const announcement = round().getByText("2/2 saved");
    expect(announcement).toBeVisible();
    expect(announcement).toHaveAttribute("aria-atomic", "true");
    expect(announcement).toHaveTextContent("Round 1 of superset A: 2/2 saved");
    expect(setAction("2a")).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps same-name appearances and mixed cues distinct in one group disclosure without writing or replacing inputs", async () => {
    const body = session();
    body.sets.forEach(set => { set.exercise_name = "Squat"; });
    const second = JSON.parse(body.sets[1].editor_json!);
    second.set.effortKind = "rir"; second.set.effort = 1; second.set.restSeconds = 150;
    body.sets[1].editor_json = JSON.stringify(second);
    const previous = { sessionId: 71, exerciseId: "same-history", date: "2026-10-01", unit: "kg" as const, reps: [5, 6], topWeight: 80, bodyweight: false };
    body.lastPerformance = Object.fromEntries(body.sets.map(set => [String(set.id), previous]));
    const original = JSON.stringify(body);
    const api = server(body); render(<WorkoutCard {...props} />); await ready();
    const header = screen.getByRole("button", { name: "Collapse Squat · Superset A" });
    expect(header).toHaveTextContent("Superset A");
    expect(header).not.toHaveTextContent("Squat");
    const details = screen.getByText("Details", { exact: true }).closest("details")!;
    for (const link of screen.getAllByRole("link", { name: /^Previous/ })) expect(link).not.toBeVisible();
    expect(within(details).getByText("Squat cue")).not.toBeVisible();
    const input = screen.getByRole("spinbutton", { name: "Squat set 1b weight (kg)" });
    fireEvent.change(input, { target: { value: "45.5" } });
    fireEvent.click(screen.getByText("Details", { exact: true }));
    const first = within(within(details).getByRole("group", { name: "Squat · 1a, 2a" }));
    const other = within(within(details).getByRole("group", { name: "Squat · 1b, 2b" }));
    expect(first.getByText("Squat cue")).toBeVisible();
    expect(first.getByText("1a · RPE 8 · Rest 90 s · Tempo 3-1-1")).toBeVisible();
    expect(first.getByText("2a · RIR 1 · Rest 150 s · Tempo 3-1-1")).toBeVisible();
    expect(other.getByText("RPE 8 · Rest 90 s · Tempo 3-1-1")).toBeVisible();
    expect(other.getByText("Row cue")).toBeVisible();
    expect(within(details).getAllByRole("link", { name: /^Previous/ })).toHaveLength(2);
    expect(within(details).getAllByText("Squat cue")).toHaveLength(1);
    fireEvent.click(screen.getByText("Details", { exact: true }));
    fireEvent.click(header);
    expect(screen.getByRole("button", { name: "Expand Squat · Superset A" })).toHaveTextContent("Squat");
    fireEvent.click(screen.getByRole("button", { name: "Expand Squat · Superset A" }));
    expect(screen.getByRole("spinbutton", { name: "Squat set 1b weight (kg)" })).toBe(input);
    expect(input).toHaveValue(45.5);
    expect(api.puts()).toEqual([]);
    expect(JSON.stringify(body)).toBe(original);
  });

  it.each([
    { mode: "working", compact: "Top-set target · 5–8 reps", full: "Top-set target · 5–8 reps · 0 kg" },
    { mode: "fixed", compact: "Top-set target · 5–8 reps · 0 kg", full: "Top-set target · 5–8 reps · 0 kg" },
    { mode: "bodyweight", compact: "Top-set target · 5–8 reps · BW", full: "Top-set target · 5–8 reps · BW" },
  ])("preserves exact $mode targets without treating prior weight as a prescription", async ({ mode, compact, full }) => {
    const body = session();
    const first = body.sets[0]; first.calculated_weight = 0;
    const metadata = JSON.parse(first.editor_json!); metadata.set.loadMode = mode; first.editor_json = JSON.stringify(metadata);
    body.lastPerformance = { [String(first.id)]: { sessionId: 71, exerciseId: "Squat", date: "2026-10-01", reps: [6], topWeight: 175, bodyweight: false, unit: "kg" } };
    server(body); render(<WorkoutCard {...props} />); await ready();
    const row = within(screen.getByRole("spinbutton", { name: "Squat set 1a reps" }).closest("[data-set-log-row]")! as HTMLElement);
    expect(row.getByText(compact, { exact: true })).toBeVisible();
    expect(row.getByRole("spinbutton", { name: "Squat set 1a weight (kg)" })).toHaveValue(0);
    fireEvent.click(screen.getByText("Details", { exact: true }));
    const details = screen.getByText("Details", { exact: true }).closest("details")!;
    expect(within(details).getByText(`1a · ${full}`)).toBeVisible();
  });

  it("validates the selected member before writing and leaves the other set unlogged", async () => {
    const api = server(); render(<WorkoutCard {...props} />); await ready();
    edit("Row set 1b reps", ""); fireEvent.click(setAction("1b"));
    expect(api.puts()).toEqual([]); expect(screen.getByRole("alert")).toHaveTextContent("Enter whole reps");
    expect(setAction("1a")).toHaveAttribute("aria-pressed", "false");
    expect(setAction("1b")).toHaveAttribute("aria-pressed", "false");
  });

  it("saves only the dirty member with its current baseline and keeps the other member acknowledged", async () => {
    const body = session(true); const api = server(body); render(<WorkoutCard {...props} />); await ready();
    edit("Row set 1b reps", "7"); expect(setAction("1b")).toHaveAttribute("aria-pressed", "false");
    expect(round().getByText("1/2 saved")).toBeVisible();
    await logSet("1b");
    expect(api.puts()).toEqual([{ setId: 21, actualReps: 7, actualWeight: 42.5, expectedActual: { reps: 8, weight: 42.5 } }]);
    expect(setAction("1a", true)).toBeEnabled();
  });

  it("retains partial acknowledgements and retries only the failed member after reopening", async () => {
    let attempts = 0;
    const api = server(session(), async () => ++attempts === 2 ? response({ error: "Connection failed" }, 500) : response({ success: true }));
    render(<WorkoutCard {...props} />); await ready(); await logSet("1a"); fireEvent.click(setAction("1b"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection failed");
    expect(round().getByText("1/2 saved")).toBeVisible();
    expect(setAction("1a", true)).toBeEnabled();
    fireEvent.click(disclosure());
    expect(disclosure(1, false)).toHaveTextContent("Save failed");
    fireEvent.click(disclosure(1, false));
    expect(api.puts().map(data => data.setId)).toEqual([11, 21]);
    await logSet("1b");
    expect(api.puts().map(data => data.setId)).toEqual([11, 21, 21]);
  });

  it("blocks set writes while saving but allows collapse and preserves edits made during the request", async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>(done => { resolve = done; });
    let calls = 0; const api = server(session(), async () => ++calls === 1 ? pending : response({ success: true }));
    render(<WorkoutCard {...props} />); await ready(); fireEvent.click(setAction("1a"));
    expect(setAction("1a")).toBeDisabled(); expect(setAction("1b")).toBeDisabled(); expect(setAction("2a")).toBeDisabled();
    edit("Squat set 1a reps", "6"); edit("Row set 1b reps", "7");
    fireEvent.click(disclosure());
    expect(disclosure(1, false)).toBeEnabled(); expect(disclosure(1, false)).toHaveTextContent("Saving…");
    await act(async () => { resolve(response({ success: true })); });
    await waitFor(() => expect(disclosure(1, false)).toHaveTextContent("Unsaved changes"));
    expect(disclosure(1, false)).toHaveTextContent("0/2 saved");
    fireEvent.click(disclosure(1, false));
    expect(screen.getByRole("spinbutton", { name: "Row set 1b reps" })).toHaveValue(7);
    await logSet("1a"); await logSet("1b");
    expect(api.puts().map(data => [data.setId, data.actualReps, data.expectedActual])).toEqual([
      [11, 8, { reps: null, weight: null }], [11, 6, { reps: 8, weight: 100 }], [21, 7, { reps: null, weight: null }],
    ]);
  });

  it("undoes only the chosen set without discarding values or changing its partner", async () => {
    const api = server(session(true)); render(<WorkoutCard {...props} />); await ready();
    await undoSet("1b");
    expect(round().getByText("1/2 saved")).toBeVisible(); expect(setAction("1a", true)).toBeEnabled();
    await logSet("1b"); await undoSet("1a"); await undoSet("1b");
    expect(round().getByText("0/2 saved")).toBeVisible();
    expect(api.puts().map(data => [data.setId, data.actualReps, data.actualWeight])).toEqual([[21, null, null], [21, 8, 42.5], [11, null, null], [21, null, null]]);
    expect(screen.getByRole("spinbutton", { name: "Row set 1b weight (kg)" })).toHaveValue(42.5);
  });

  it("surfaces unresolved Undo in the closed header without retrying when reopened", async () => {
    const api = server(session(true), async () => new Response("", { status: 200 }));
    render(<WorkoutCard {...props} />); await ready(); fireEvent.click(setAction("1a", true));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not confirm Undo");
    expect(screen.getByRole("button", { name: "Retry undo set 1a" })).toBeEnabled();
    expect(setAction("1b", true)).toBeEnabled();
    fireEvent.click(disclosure());
    expect(disclosure(1, false)).toHaveTextContent("Undo unconfirmed");
    expect(disclosure(1, false)).toHaveTextContent("1/2 saved");
    fireEvent.click(disclosure(1, false));
    expect(screen.getByRole("button", { name: "Retry undo set 1a" })).toBeEnabled();
    expect(api.puts()).toHaveLength(1);
  });

  it("recovers a lost individual Undo after reload without repeating its partner's acknowledged Undo", async () => {
    const body = session(true); let count = 0;
    const api = server(body, async (_url, init) => {
      const data = JSON.parse(init!.body as string);
      if (++count === 2) throw new Error("Undo response lost");
      const set = body.sets.find(set => set.id === data.setId)!;
      set.actual_reps = data.actualReps; set.actual_weight = data.actualWeight;
      return response({ actual_reps: data.actualReps, actual_weight: data.actualWeight });
    });
    const first = render(<WorkoutCard {...props} />); await ready(); await undoSet("1a"); fireEvent.click(setAction("1b", true));
    expect(await screen.findByRole("alert")).toHaveTextContent("Undo response lost");
    expect(setAction("1a")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Retry undo set 1b" })).toBeEnabled();
    first.unmount(); render(<WorkoutCard {...props} />); await ready();
    fireEvent.click(disclosure()); expect(disclosure(1, false)).toHaveTextContent("Undo unconfirmed"); fireEvent.click(disclosure(1, false));
    fireEvent.click(screen.getByRole("button", { name: "Retry undo set 1b" }));
    await waitFor(() => expect(setAction("1b")).toBeEnabled());
    expect(round().getByText("0/2 saved")).toBeVisible();
    expect(api.puts()).toEqual([
      { setId: 11, actualReps: null, actualWeight: null, expectedActual: { reps: 8, weight: 100 } },
      { setId: 21, actualReps: null, actualWeight: null, expectedActual: { reps: 8, weight: 42.5 } },
      { setId: 21, actualReps: null, actualWeight: null, expectedActual: { reps: 8, weight: 42.5 } },
    ]);
    expect(screen.getByRole("spinbutton", { name: "Squat set 1a reps" })).toHaveValue(8);
    expect(screen.getByRole("spinbutton", { name: "Row set 1b weight (kg)" })).toHaveValue(42.5);
  });

  it("surfaces a conflict in the closed header until that member is explicitly resolved", async () => {
    const body = session(); const latest = session(true);
    body.sets[2] = latest.sets[2];
    const api = server(body, async (_url, init) => init?.method === "PUT" ? response({ error: "Changed elsewhere" }, 409) : response(latest));
    render(<WorkoutCard {...props} />); await ready(); fireEvent.click(setAction("1a"));
    expect(await screen.findByText("Saved elsewhere: 8 reps at 100 kg.")).toBeVisible();
    expect(setAction("1a")).toBeDisabled();
    fireEvent.click(disclosure());
    expect(disclosure(1, false)).toHaveTextContent("Resolve conflicting changes");
    expect(disclosure(1, false)).toHaveTextContent("1/2 saved");
    fireEvent.click(disclosure(1, false));
    expect(api.puts()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Use saved values" }));
    expect(setAction("1a", true)).toBeEnabled(); expect(round().getByText("2/2 saved")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("retains the error while another member remains conflicted, then clears it after the last resolution", async () => {
    const latest = session(true);
    server(session(), async (_url, init) => init?.method === "PUT" ? response({ error: "Changed elsewhere" }, 409) : response(latest));
    render(<WorkoutCard {...props} />); await ready();
    fireEvent.click(screen.getByRole("button", { name: "Save set 1a" }));
    await screen.findByText("Saved elsewhere: 8 reps at 100 kg.");
    fireEvent.click(screen.getByRole("button", { name: "Save set 1b" }));
    await screen.findByText("Saved elsewhere: 8 reps at 42.5 kg.");
    const row = screen.getByRole("spinbutton", { name: "Row set 1b reps" }).closest("[data-set-log-row]")!;
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Use saved values" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Changed elsewhere");
    expect(setAction("1a")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Use saved values" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(setAction("1a", true)).toBeEnabled();
  });

  it("clears a resolved row error after failed save, further editing, and discard", async () => {
    const api = server(session(), async () => response({ error: "Could not save Squat" }, 500));
    render(<WorkoutCard {...props} />); await ready();
    fireEvent.click(screen.getByRole("button", { name: "Save set 1a" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save Squat");
    edit("Squat set 1a reps", "6");
    expect(screen.queryByText("Save failed")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard set 1a changes" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Squat set 1a reps" })).toHaveValue(8);
    expect(setAction("1a")).toBeEnabled();
    expect(api.puts()).toHaveLength(1);
  });

  it("retains a different member's save failure when accepting a conflicted member's saved values", async () => {
    server(session(), async (_url, init) => {
      if (init?.method !== "PUT") return response(session(true));
      return JSON.parse(init.body as string).setId === 11 ? response({ error: "Changed elsewhere" }, 409) : response({ error: "Could not save Row" }, 500);
    });
    render(<WorkoutCard {...props} />); await ready();
    fireEvent.click(screen.getByRole("button", { name: "Save set 1a" }));
    await screen.findByText("Saved elsewhere: 8 reps at 100 kg.");
    fireEvent.click(screen.getByRole("button", { name: "Save set 1b" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not save Row"));
    fireEvent.click(disclosure()); expect(disclosure(1, false)).toHaveTextContent("Resolve conflicting changes"); fireEvent.click(disclosure(1, false));
    fireEvent.click(screen.getByRole("button", { name: "Use saved values" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save Row");
    expect(screen.getByText("Save failed")).toBeVisible();
    fireEvent.click(disclosure()); expect(disclosure(1, false)).toHaveTextContent("Save failed"); fireEvent.click(disclosure(1, false));
    fireEvent.click(screen.getByRole("button", { name: "Discard set 1b changes" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(setAction("1b")).toBeEnabled();
  });

  it("does not erase an unrelated add-exercise error when resolving the last set conflict", async () => {
    server(session(), async (_url, init) => init?.method === "POST" ? response({ error: "Could not add Curl" }, 500) : init?.method === "PUT" ? response({ error: "Changed elsewhere" }, 409) : response(session(true)));
    render(<WorkoutCard {...props} />); await ready(); fireEvent.click(setAction("1a"));
    await screen.findByText("Saved elsewhere: 8 reps at 100 kg.");
    fireEvent.click(screen.getByRole("button", { name: "Add exercise" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New exercise name" }), { target: { value: "Curl" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to workout" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not add Curl");
    fireEvent.click(screen.getByRole("button", { name: "Use saved values" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not add Curl");
  });

  it("keeps dirty values through manual collapse and remount without making fake saves", async () => {
    const api = server(); const first = render(<WorkoutCard {...props} />); await ready();
    edit("Row set 1b weight (kg)", "46.25");
    const input = screen.getByRole("spinbutton", { name: "Row set 1b weight (kg)" }); const id = input.id;
    fireEvent.click(screen.getByRole("button", { name: "Collapse Squat + Row · Superset A" }));
    expect(input).not.toBeVisible(); expect(screen.getByRole("button", { name: "Expand Squat + Row · Superset A" })).toHaveTextContent("Unsaved changes");
    fireEvent.click(screen.getByRole("button", { name: "Expand Squat + Row · Superset A" })); expect(input).toBeVisible(); expect(input.id).toBe(id);
    first.unmount(); render(<WorkoutCard {...props} />); await ready();
    expect(screen.getByRole("spinbutton", { name: "Row set 1b weight (kg)" })).toHaveValue(46.25); expect(api.puts()).toEqual([]);
    await logSet("1a"); await logSet("1b"); expect(api.puts().map(data => data.actualWeight)).toEqual([100, 46.25]);
  });

  it("preserves unequal three-lift rounds and their exact row labels through independent disclosure", async () => {
    const body = session();
    const third = { ...body.sets[0], id: 31, exercise_name: "Curl", editor_json: JSON.stringify({ ...JSON.parse(body.sets[0].editor_json!), exerciseId: "Curl" }) };
    body.sets.push(third);
    const api = server(body); render(<WorkoutCard {...props} />); await ready();
    expect(round().getAllByRole("spinbutton").map(input => input.getAttribute("aria-label"))).toEqual([
      "Squat set 1a reps", "Squat set 1a weight (kg)", "Row set 1b reps", "Row set 1b weight (kg)", "Curl set 1c reps", "Curl set 1c weight (kg)",
    ]);
    expect(round(2).getAllByRole("spinbutton")).toHaveLength(4);
    expect(disclosure()).toHaveTextContent("0/3 saved"); expect(disclosure(2)).toHaveTextContent("0/2 saved");
    fireEvent.click(disclosure());
    expect(disclosure(1, false)).toHaveTextContent("Squat + Row + Curl");
    expect(round(2).getAllByRole("spinbutton")).toHaveLength(4);
    fireEvent.click(disclosure(1, false));
    expect(screen.queryByRole("spinbutton", { name: "Curl set 2c reps" })).not.toBeInTheDocument();
    expect(api.puts()).toEqual([]);
  });

  it("retains explicit batch rows without a physical round action", async () => {
    const body = session(); body.sets[0].sets = 3; server(body); render(<WorkoutCard {...props} />);
    expect(await screen.findByText("Squat · 3 sets · batch")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Round \d+ of superset/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save 3-set log" })).toBeEnabled();
  });
});
