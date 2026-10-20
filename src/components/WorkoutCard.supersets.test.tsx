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
const action = (number = 1, undo = false) => screen.getByRole("button", { name: `${undo ? "Undo" : "Save"} round ${number} of superset A` });
const round = (number = 1) => within(screen.getByRole("group", { name: `Round ${number} of superset A` }));
const edit = (name: string, value: string) => fireEvent.change(screen.getByRole("spinbutton", { name }), { target: { value } });
async function ready() { await screen.findByRole("spinbutton", { name: "Squat set 1a reps" }); }
async function saved(number = 1) { await waitFor(() => expect(action(number, true)).toBeEnabled()); }
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("active superset rounds", () => {
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
    const button = action(); fireEvent.click(button); await saved();
    expect(api.puts()).toEqual([
      { setId: 11, actualReps: 6, actualWeight: 100, expectedActual: { reps: null, weight: null } },
      { setId: 21, actualReps: 8, actualWeight: 45.5, expectedActual: { reps: null, weight: null } },
    ]);
    expect(action(1, true)).toBe(button); expect(button).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("spinbutton", { name: "Row set 1b weight (kg)" })).toBe(input); expect(input).toHaveFocus();
    const announcement = round().getByText("2 of 2 saved");
    expect(announcement).toBeVisible();
    expect(announcement).toHaveAttribute("aria-atomic", "true");
    expect(announcement).toHaveTextContent("Round 1: 2 of 2 saved");
    expect(action(2)).toHaveAttribute("aria-pressed", "false");
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

  it("validates every submitted member before writing any row", async () => {
    const api = server(); render(<WorkoutCard {...props} />); await ready();
    edit("Row set 1b reps", ""); fireEvent.click(action());
    expect(api.puts()).toEqual([]); expect(screen.getByRole("alert")).toHaveTextContent("Enter whole reps");
    expect(action()).toHaveAttribute("aria-pressed", "false");
  });

  it("excludes acknowledged members and saves dirty members with their current baseline", async () => {
    const body = session(true); const api = server(body); render(<WorkoutCard {...props} />); await ready();
    edit("Row set 1b reps", "7"); expect(action()).toHaveAttribute("aria-pressed", "false");
    expect(round().getByText("1 of 2 saved")).toBeVisible();
    fireEvent.click(action()); await saved();
    expect(api.puts()).toEqual([{ setId: 21, actualReps: 7, actualWeight: 42.5, expectedActual: { reps: 8, weight: 42.5 } }]);
  });

  it("retains partial acknowledgements and retries only failed or unattempted members", async () => {
    let attempts = 0;
    const api = server(session(), async () => ++attempts === 2 ? response({ error: "Connection failed" }, 500) : response({ success: true }));
    render(<WorkoutCard {...props} />); await ready(); fireEvent.click(action());
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection failed");
    expect(round().getByText("1 of 2 saved")).toBeVisible(); expect(action()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Undo set 1a" })).toBeEnabled();
    fireEvent.click(action()); await saved();
    expect(api.puts().map(data => data.setId)).toEqual([11, 21, 21]);
  });

  it("blocks all round actions during a write and preserves edits made while that write is pending", async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>(done => { resolve = done; });
    let calls = 0; const api = server(session(), async () => ++calls === 1 ? pending : response({ success: true }));
    render(<WorkoutCard {...props} />); await ready(); fireEvent.click(action());
    expect(action()).toBeDisabled(); expect(action(2)).toBeDisabled(); expect(action()).toHaveAttribute("aria-pressed", "false");
    edit("Squat set 1a reps", "6");
    edit("Row set 1b reps", "7");
    await act(async () => { resolve(response({ success: true })); });
    await waitFor(() => expect(action()).toBeEnabled());
    expect(round().getByText("0 of 2 saved")).toBeVisible();
    expect(screen.getByRole("spinbutton", { name: "Row set 1b reps" })).toHaveValue(7);
    fireEvent.click(action()); await saved();
    expect(api.puts().map(data => [data.setId, data.actualReps, data.expectedActual])).toEqual([
      [11, 8, { reps: null, weight: null }], [21, 8, { reps: null, weight: null }], [11, 6, { reps: 8, weight: 100 }], [21, 7, { reps: 8, weight: 42.5 }],
    ]);
  });

  it("supports individual Undo then round save and acknowledged round Undo without discarding entered values", async () => {
    const api = server(session(true)); render(<WorkoutCard {...props} />); await ready();
    fireEvent.click(screen.getByRole("button", { name: "Undo set 1b" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save set 1b" })).toBeEnabled());
    expect(action()).toHaveAttribute("aria-pressed", "false"); fireEvent.click(action()); await saved();
    fireEvent.click(action(1, true));
    await waitFor(() => expect(round().getByText("0 of 2 saved")).toBeVisible());
    expect(api.puts().map(data => [data.setId, data.actualReps, data.actualWeight])).toEqual([[21, null, null], [21, 8, 42.5], [11, null, null], [21, null, null]]);
    expect(screen.getByRole("spinbutton", { name: "Row set 1b weight (kg)" })).toHaveValue(42.5);
  });

  it("protects unresolved Undo and leaves individual retry available", async () => {
    const api = server(session(true), async () => new Response("", { status: 200 }));
    render(<WorkoutCard {...props} />); await ready(); fireEvent.click(action(1, true));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not confirm Undo");
    expect(action()).toBeDisabled(); expect(action()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Retry undo set 1a" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Retry undo set 1b" })).toBeEnabled();
    fireEvent.click(action()); expect(api.puts()).toHaveLength(1);
  });

  it("recovers a partially acknowledged round Undo after reload through individual retry", async () => {
    const body = session(true); let count = 0;
    const api = server(body, async (_url, init) => {
      const data = JSON.parse(init!.body as string);
      if (++count === 2) throw new Error("Undo response lost");
      const set = body.sets.find(set => set.id === data.setId)!;
      set.actual_reps = data.actualReps; set.actual_weight = data.actualWeight;
      return response({ actual_reps: data.actualReps, actual_weight: data.actualWeight });
    });
    const first = render(<WorkoutCard {...props} />); await ready(); fireEvent.click(action(1, true));
    expect(await screen.findByRole("alert")).toHaveTextContent("Undo response lost");
    expect(screen.getByRole("button", { name: "Save set 1a" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Retry undo set 1b" })).toBeEnabled();
    expect(action()).toBeDisabled();
    first.unmount(); render(<WorkoutCard {...props} />); await ready();
    expect(action()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry undo set 1b" }));
    await waitFor(() => expect(action()).toBeEnabled());
    expect(round().getByText("0 of 2 saved")).toBeVisible();
    expect(api.puts()).toEqual([
      { setId: 11, actualReps: null, actualWeight: null, expectedActual: { reps: 8, weight: 100 } },
      { setId: 21, actualReps: null, actualWeight: null, expectedActual: { reps: 8, weight: 42.5 } },
      { setId: 21, actualReps: null, actualWeight: null, expectedActual: { reps: 8, weight: 42.5 } },
    ]);
    expect(screen.getByRole("spinbutton", { name: "Squat set 1a reps" })).toHaveValue(8);
    expect(screen.getByRole("spinbutton", { name: "Row set 1b weight (kg)" })).toHaveValue(42.5);
  });

  it("blocks a conflicting round until the user resolves that member explicitly", async () => {
    const body = session(); const latest = session(true);
    body.sets[2] = latest.sets[2];
    const api = server(body, async (_url, init) => init?.method === "PUT" ? response({ error: "Changed elsewhere" }, 409) : response(latest));
    render(<WorkoutCard {...props} />); await ready(); fireEvent.click(action());
    expect(await screen.findByText("Saved elsewhere: 8 reps at 100 kg.")).toBeVisible();
    expect(action()).toBeDisabled(); expect(action()).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Use saved values" }));
    expect(action(1, true)).toBeEnabled(); expect(round().getByText("2 of 2 saved")).toBeVisible(); expect(api.puts()).toHaveLength(1);
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
    expect(action()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Use saved values" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(action(1, true)).toBeEnabled();
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
    expect(action()).toBeEnabled();
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
    fireEvent.click(screen.getByRole("button", { name: "Use saved values" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save Row");
    expect(screen.getByText("Save failed")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Discard set 1b changes" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(action()).toBeEnabled();
  });

  it("does not erase an unrelated add-exercise error when resolving the last set conflict", async () => {
    server(session(), async (_url, init) => init?.method === "POST" ? response({ error: "Could not add Curl" }, 500) : init?.method === "PUT" ? response({ error: "Changed elsewhere" }, 409) : response(session(true)));
    render(<WorkoutCard {...props} />); await ready(); fireEvent.click(action());
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
    fireEvent.click(action()); await saved(); expect(api.puts().map(data => data.actualWeight)).toEqual([100, 46.25]);
  });

  it("retains explicit batch rows without a physical round action", async () => {
    const body = session(); body.sets[0].sets = 3; server(body); render(<WorkoutCard {...props} />);
    expect(await screen.findByText("Squat · 3 sets · batch")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Save round/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save 3-set log" })).toBeEnabled();
  });
});
