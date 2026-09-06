// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveProgramChanges } from "./ActiveProgramChanges";
import { makePreset } from "@/features/program-editor/operations";
import type { EditorPrescriptionSet } from "@/features/program-editor/repository";

const draftId = "11111111-1111-4111-8111-111111111111";
const storageKey = "magni:active-program-change:7";
const list = { draftId, publishedRevisionId: 4, occurrences: [{ occurrenceId: 9, date: "2026-09-06", name: "Row day", status: "scheduled", editable: true, cycle: 1, weekId: "w", weekName: "Week 1", dayId: "d", block: "Build" }] };
const state = { load: 40, trainingMax: 100, reps: 8, consecutiveFailures: 2, lastEvaluatedWeek: 1 };
const preview = { success: true, previewToken: "a".repeat(64), scope: "occurrence", affected: [{ occurrenceId: 9, date: "2026-09-06", name: "Row day", newName: "Edited row day", status: "scheduled", before: [], after: [] }], excluded: [{ occurrenceId: 10, date: "2026-09-07", name: "Started day", status: "in_progress" }], progressionChanges: [{ progressionKey: "key", exerciseName: "Row", beforeState: state, afterState: { ...state, load: 50, consecutiveFailures: 0 }, separated: true }], explanation: "Only the listed unstarted workouts change." };
function prescription(unit: "lb" | "kg"): EditorPrescriptionSet {
  const exercise = makePreset("double", "2026-09-05").weeks[0].days[0].exercises[0];
  return { week_setting_id: 1, legacy_week_setting_id: 1, exercise_id: 1, stable_key: "key", exercise_name: "Row", category: "main", progression_type: "custom", superset_group: "A", week_number: 1, set_number: 1, intensity_pct: 0, reps: 8, sets: 1, rep_out_target: 12, weight: 50, calculated_weight: 50, training_max: 100,
    editor: { exerciseId: "row", progressionKey: "key", baseLoad: 40, trainingMax: 90, rule: null, set: { ...exercise.sets[0], loadMode: "percent", load: 50, effortKind: "rir", effort: 2, restSeconds: 90, tempo: "3-1-1", notes: "Full stretch" }, unit, deload: false, versionId: 1 } };
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let storage: Map<string, string>;
let posts: Record<string, unknown>[];
let applyReply: () => Promise<Response>;
let saveDraft: ReturnType<typeof vi.fn<() => Promise<number | null>>>;

beforeEach(() => {
  storage = new Map(); posts = [];
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  applyReply = async () => response({ success: true, revisionId: 5, changed: 1 });
  saveDraft = vi.fn(async () => 2);
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    if (!init || init.method === "GET") return response(list);
    const body = JSON.parse(init.body); posts.push(body);
    if (body.preview === true) return response({ ...preview, scope: body.scope });
    return applyReply();
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const mount = () => render(<ActiveProgramChanges programId={7} draftId={draftId} saveDraft={saveDraft} />);
async function review() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Review changes" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
  await screen.findByRole("button", { name: "Apply reviewed changes" });
}

describe("active program change review and recovery", () => {
  it("shows affected workouts, protected history, state changes, and saves again before apply", async () => {
    mount(); await review();
    expect(screen.getByText("Edited row day")).toBeInTheDocument();
    expect(screen.getByText(/Started day/)).toBeInTheDocument();
    expect(screen.getByText(/Separate progression/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply reviewed changes" }));
    await screen.findByText(/Applied version 5/);
    expect(saveDraft).toHaveBeenCalledTimes(2);
    expect(posts[1]).toMatchObject({ expectedDraftRevision: 2, scope: "occurrence", occurrenceId: 9, progressionState: "preserve", expectedPreviewToken: preview.previewToken, requestKey: expect.any(String), preview: false });
    expect(storage.has(storageKey)).toBe(false);
  });

  it("requires a new review when the draft changed after preview", async () => {
    mount(); await review(); saveDraft.mockResolvedValue(3);
    fireEvent.click(screen.getByRole("button", { name: "Apply reviewed changes" }));
    await screen.findByText(/draft changed.*review again/i);
    expect(posts).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Apply reviewed changes" })).not.toBeInTheDocument();
  });

  it("shows the original scope and reset policy for a pending operation after reload", async () => {
    applyReply = async () => { throw new Error("Offline"); };
    const first = mount(); await waitFor(() => expect(screen.getByLabelText("Change scope")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Change scope"), { target: { value: "remaining_block" } });
    fireEvent.change(screen.getByLabelText("Progression values"), { target: { value: "use_draft" } });
    await review(); fireEvent.click(screen.getByRole("button", { name: "Apply reviewed changes" }));
    await screen.findByRole("alert"); first.unmount(); mount();
    await screen.findByRole("button", { name: "Retry pending change" });
    expect(screen.getByLabelText("Change scope")).toHaveValue("remaining_block");
    expect(screen.getByLabelText("Progression values")).toHaveValue("use_draft");
  });

  it.each(["network", "server", "invalid success"])("retains %s uncertainty across reload and replays the exact operation before new edits", async failure => {
    applyReply = failure === "network" ? async () => { throw new Error("Offline"); } : async () => response(failure === "server" ? { error: "Try again" } : {}, failure === "server" ? 503 : 200);
    const first = mount(); await review();
    fireEvent.click(screen.getByRole("button", { name: "Apply reviewed changes" }));
    await screen.findByRole("button", { name: "Retry pending change" });
    const original = posts[1]; const persisted = storage.get(storageKey);
    expect(persisted).toBeTruthy();
    first.unmount(); saveDraft.mockResolvedValue(3); mount();
    expect(await screen.findByRole("button", { name: "Retry pending change" })).toBeEnabled();
    expect(screen.getByLabelText("Change scope")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy published definition" })).toBeDisabled();
    expect(storage.get(storageKey)).toBe(persisted);
    applyReply = async () => response({ success: true, revisionId: 5, changed: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Retry pending change" }));
    await screen.findByText(/Applied version 5/);
    expect(posts[2]).toEqual(original);
    expect(saveDraft).toHaveBeenCalledTimes(2);
  });

  it("clears a definite conflict and requires a new review without discarding the draft", async () => {
    applyReply = async () => response({ error: "Workout changed; review again" }, 409);
    mount(); await review(); fireEvent.click(screen.getByRole("button", { name: "Apply reviewed changes" }));
    await screen.findByText("Workout changed; review again");
    expect(storage.has(storageKey)).toBe(false);
    expect(screen.queryByRole("button", { name: "Retry pending change" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review changes" })).toBeEnabled();
  });

  it.each(["empty", "malformed", "missing error"])("retains an unconfirmed %s 400 response and retries the same operation", async body => {
    applyReply = async () => body === "empty" ? new Response(null, { status: 400 }) : body === "malformed" ? new Response("<html>proxy error</html>", { status: 400 }) : response({}, 400);
    mount(); await review(); fireEvent.click(screen.getByRole("button", { name: "Apply reviewed changes" }));
    await screen.findByRole("alert");
    expect(storage.has(storageKey)).toBe(true);
    expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
    const first = posts[1];
    applyReply = async () => response({ success: true, revisionId: 5, changed: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Retry pending change" }));
    await screen.findByText(/Applied version 5/);
    expect(posts[2]).toEqual(first);
  });

  it("does not dispatch if the pending request cannot survive reload", async () => {
    mount(); await review();
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
    fireEvent.click(screen.getByRole("button", { name: "Apply reviewed changes" }));
    await screen.findByText(/device storage/i);
    expect(posts).toHaveLength(1);
  });

  it("uses the chosen scope and explicit reset policy in its preview", async () => {
    mount(); await waitFor(() => expect(screen.getByLabelText("Change scope")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Change scope"), { target: { value: "remaining_block" } });
    fireEvent.change(screen.getByLabelText("Progression values"), { target: { value: "use_draft" } });
    await review();
    expect(posts[0]).toMatchObject({ scope: "remaining_block", progressionState: "use_draft" });
  });

  it("shows complete prescription details and explicit before/after state units", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => !init || init.method === "GET" ? response(list) : response({ ...preview, affected: [{ ...preview.affected[0], before: [prescription("lb")], after: [prescription("kg")] }] })));
    mount(); await review();
    expect(screen.getAllByText(/Row · Superset A/)).toHaveLength(2);
    expect(screen.getByText(/8–12 reps · 50 kg \(50% of 100 kg max\) · RIR 2 · 90s rest · Tempo 3-1-1 · Full stretch/)).toBeInTheDocument();
    expect(screen.getByText(/Working load: 40 lb → 50 kg/)).toBeInTheDocument();
  });

  it("retains a nominal success without an applied version instead of falsely acknowledging it", async () => {
    applyReply = async () => response({ success: true });
    mount(); await review(); fireEvent.click(screen.getByRole("button", { name: "Apply reviewed changes" }));
    await screen.findByText(/Could not confirm the applied version/);
    expect(storage.has(storageKey)).toBe(true);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps a published-copy request separate and retries its exact version and key", async () => {
    applyReply = async () => { throw new Error("Lost copy response"); };
    const first = mount(); await waitFor(() => expect(screen.getByRole("button", { name: "Copy published definition" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Copy published definition" }));
    await screen.findByRole("button", { name: "Retry pending change" });
    expect(posts[0]).toMatchObject({ action: "copy_published", publishedRevisionId: 4, requestKey: expect.any(String) });
    first.unmount(); mount();
    applyReply = async () => response({ success: true, draftId: "22222222-2222-4222-8222-222222222222" });
    fireEvent.click(await screen.findByRole("button", { name: "Retry pending change" }));
    expect(await screen.findByRole("link", { name: "Open copied draft" })).toHaveAttribute("href", "/programs/editor/22222222-2222-4222-8222-222222222222");
    expect(posts[1]).toEqual(posts[0]);
    expect(saveDraft).not.toHaveBeenCalled();
  });
});
