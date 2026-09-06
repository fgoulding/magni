// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { renderToString } from "react-dom/server";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkoutReuse } from "./WorkoutReuse";
import { QuickWorkoutEditor } from "./QuickWorkoutEditor";
import { WorkoutHistoryDetail } from "./WorkoutHistoryDetail";
import type { WorkoutSession } from "@/features/workouts/types";
import { workoutRequest } from "./quick-workout-utils";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fixture = (): WorkoutSession => ({ id: 200, name: "Upper", date: "2026-09-01", unit: "lb", revision: 1, status: "completed", program_id: null, program_name: "", day_name: "Upper", volume: 400, loggedSets: 1, totalSets: 1, recap: null, corrections: [], sets: [{ id: 201, exercise_name: "Row", exercise_key: "row-a", sort_order: 1, notes: "", editor_json: null, reps: 10, sets: 1, set_number: 1, rep_out_target: 10, calculated_weight: 40, actual_reps: 10, actual_weight: 40, superset_group: null }] });
const preview = { progressionEffect: "Future progression unchanged.", comparisons: [] };
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
function Structure() {
  const [session, setSession] = useState(fixture);
  const [error, setError] = useState("");
  return <><QuickWorkoutEditor session={session} disabled={false} onChanged={setSession} onError={setError} /><p>{error}</p></>;
}
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); router.push.mockClear(); });

it.each(["repeat", "routine"])("allows correcting a definite nonwrite %s validation rejection with a new key", async (kind) => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ error: "Enter valid metadata." }, 400)).mockResolvedValueOnce(response({ id: 210 }));
  vi.stubGlobal("fetch", fetcher);
  render(<WorkoutReuse sessionId={200} name="Upper" today="2026-09-05" />);
  const label = kind === "repeat" ? "Repeat workout date" : "Routine name";
  const button = kind === "repeat" ? "Repeat workout" : "Save as routine";
  change(label, kind === "repeat" ? "" : "x".repeat(141));
  fireEvent.click(screen.getByRole("button", { name: button }));
  await screen.findByText("Enter valid metadata.");
  expect(screen.getByLabelText(label)).toBeEnabled();
  expect(screen.getByLabelText(label)).toHaveFocus();
  change(label, kind === "repeat" ? "2026-09-03" : "Reusable upper");
  fireEvent.click(screen.getByRole("button", { name: button }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  const first = JSON.parse(fetcher.mock.calls[0][1].body);
  const second = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(second.requestKey).not.toBe(first.requestKey);
  expect(second[kind === "repeat" ? "date" : "name"]).toBe(kind === "repeat" ? "2026-09-03" : "Reusable upper");
});

it("server-renders repeat metadata disabled until its saved draft and handlers are ready", () => {
  const root = document.createElement("div");
  root.innerHTML = renderToString(<WorkoutReuse sessionId={200} name="Upper" today="2026-09-05" />);
  for (const control of root.querySelectorAll("input,button")) expect(control).toBeDisabled();
  localStorage.setItem("magni.workout.reuse.200", JSON.stringify({ date: "2026-08-31", name: "Saved routine draft" }));
  render(<WorkoutReuse sessionId={200} name="Upper" today="2026-09-05" />);
  expect(screen.getByLabelText("Repeat workout date")).toHaveValue("2026-08-31");
  expect(screen.getByLabelText("Routine name")).toHaveValue("Saved routine draft");
  expect(screen.getByLabelText("Routine name")).toBeEnabled();
});

it("settles the exact committed structure intent before saving a newer local name", async () => {
  const source = fixture();
  let committed = "";
  const bodies: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = String(init.body); bodies.push(body);
    if (!committed) { committed = body; return response({ error: "Response lost" }, 503); }
    const value = JSON.parse(body);
    if (value.requestKey === JSON.parse(committed).requestKey && body !== committed) return response({ error: "This retry key belongs to a different change." }, 409);
    return response({ ...source, name: value.name, revision: value.name === "First name" ? 2 : 3 });
  }));
  render(<Structure />);
  fireEvent.click(screen.getByRole("button", { name: "Edit workout" }));
  expect(screen.getByLabelText("Workout name")).toHaveFocus();
  change("Workout name", "First name");
  fireEvent.click(screen.getByRole("button", { name: "Save workout changes" }));
  await screen.findByText("Response lost");
  change("Workout name", "Newer name");
  fireEvent.click(screen.getByRole("button", { name: /Resolve previous save|Save workout changes/ }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toBe(bodies[0]);
  expect(screen.getByLabelText("Workout name")).toHaveValue("Newer name");
  fireEvent.click(screen.getByRole("button", { name: "Save workout changes" }));
  await waitFor(() => expect(bodies).toHaveLength(3));
  expect(JSON.parse(bodies[2])).toMatchObject({ name: "Newer name", expectedRevision: 2 });
  expect(JSON.parse(bodies[2]).requestKey).not.toBe(JSON.parse(bodies[0]).requestKey);
});

it("settles an uncertain correction before previewing and saving newer actuals", async () => {
  const source = fixture();
  const savedBodies: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.preview) return response(preview);
    savedBodies.push(String(init.body));
    if (savedBodies.length === 1) return response({ error: "Response lost" }, 503);
    if (savedBodies.length === 2 && savedBodies[1] !== savedBodies[0]) return response({ error: "This retry key belongs to a different change." }, 409);
    return response({ ...preview, session: { ...source, revision: savedBodies.length, sets: [{ ...source.sets[0], actual_reps: body.sets[0].actualReps }] } });
  }));
  render(<WorkoutHistoryDetail initialSession={source} today="2026-09-05" />);
  fireEvent.click(screen.getByRole("button", { name: "Correct workout" }));
  expect(screen.getByLabelText("Correct workout date")).toHaveFocus();
  change("Correct reps for set 1", "8");
  fireEvent.click(screen.getByRole("button", { name: "Preview correction" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save correction" }));
  await screen.findByText("Response lost");
  change("Correct reps for set 1", "6");
  const resolve = screen.queryByRole("button", { name: "Resolve previous correction" });
  if (resolve) fireEvent.click(resolve);
  else { fireEvent.click(screen.getByRole("button", { name: "Preview correction" })); fireEvent.click(await screen.findByRole("button", { name: "Save correction" })); }
  await waitFor(() => expect(savedBodies).toHaveLength(2));
  expect(savedBodies[1]).toBe(savedBodies[0]);
  expect(screen.getByLabelText("Correct reps for set 1")).toHaveValue(6);
  fireEvent.click(screen.getByRole("button", { name: "Preview correction" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save correction" }));
  await waitFor(() => expect(savedBodies).toHaveLength(3));
  expect(JSON.parse(savedBodies[2])).toMatchObject({ expectedRevision: 2, sets: [{ setId: 201, actualReps: 6, actualWeight: 40 }] });
  expect(JSON.parse(savedBodies[2]).requestKey).not.toBe(JSON.parse(savedBodies[0]).requestKey);
});

it.each(["structure", "correction"])("requires explicit review before rebasing a conflicting %s draft", async (kind) => {
  const source = fixture();
  const current = { ...source, name: "Other device", date: "2026-09-02", revision: 4, sets: [{ ...source.sets[0], actual_reps: 9 }] };
  let conflicted = false;
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    if (init.method === "GET") return response(current);
    const body = JSON.parse(String(init.body));
    if (body.preview) return response(preview);
    writes.push(body);
    if (!conflicted) { conflicted = true; return response({ error: "This workout changed in another tab or device. Reload the saved workout before editing." }, 409); }
    return response(kind === "structure" ? { ...current, name: body.name, revision: 5 } : { ...preview, session: { ...current, revision: 5 } });
  }));
  if (kind === "structure") {
    render(<Structure />);
    fireEvent.click(screen.getByRole("button", { name: "Edit workout" }));
    change("Workout name", "My name");
    fireEvent.click(screen.getByRole("button", { name: "Save workout changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review saved workout" }));
    await screen.findByText(/Saved workout: Other device/);
    expect(screen.getByLabelText("Saved workout review")).toHaveFocus();
    expect(writes).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep my workout edits" }));
    expect(screen.getByLabelText("Workout name")).toHaveValue("My name");
    expect(screen.getByLabelText("Workout name")).toHaveFocus();
    expect(screen.getByLabelText("Workout date")).toHaveValue("2026-09-02");
    fireEvent.click(screen.getByRole("button", { name: "Save workout changes" }));
  } else {
    render(<WorkoutHistoryDetail initialSession={source} today="2026-09-05" />);
    fireEvent.click(screen.getByRole("button", { name: "Correct workout" }));
    change("Correct reps for set 1", "8");
    fireEvent.click(screen.getByRole("button", { name: "Preview correction" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save correction" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review saved actuals" }));
    await screen.findByText(/Row set 1: 9 reps at 40 lb/);
    expect(screen.getByLabelText("Saved actuals review")).toHaveFocus();
    expect(writes).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep my actual edits" }));
    expect(screen.getByLabelText("Correct reps for set 1")).toHaveValue(8);
    expect(screen.getByLabelText("Correct workout date")).toHaveFocus();
    expect(screen.getByLabelText("Correct workout date")).toHaveValue("2026-09-02");
    fireEvent.click(screen.getByRole("button", { name: "Preview correction" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save correction" }));
  }
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1].expectedRevision).toBe(4);
  expect(writes[1].requestKey).not.toBe(writes[0].requestKey);
});

it.each([503, 400])("keeps a reuse intent frozen through reload after an unconfirmed %s response", async (status) => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status })).mockResolvedValueOnce(response({ id: 210 }));
  vi.stubGlobal("fetch", fetcher);
  const props = { sessionId: 200, name: "Upper", today: "2026-09-05", returnTo: "/calendar?month=2026-09&date=2026-09-03" };
  const first = render(<WorkoutReuse {...props} />);
  change("Repeat workout date", "2026-09-03");
  fireEvent.click(screen.getByRole("button", { name: "Repeat workout" }));
  await screen.findByRole("button", { name: "Retry starting workout" });
  first.unmount();
  render(<WorkoutReuse {...props} />);
  expect(screen.getByLabelText("Repeat workout date")).toHaveValue("2026-09-03");
  expect(screen.getByLabelText("Repeat workout date")).toBeDisabled();
  expect(screen.getByLabelText("Routine name")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry starting workout" }));
  await waitFor(() => expect(router.push).toHaveBeenCalledWith("/workouts/210?returnTo=%2Fcalendar%3Fmonth%3D2026-09%26date%3D2026-09-03"));
  expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body);
});

it("does not acknowledge a routine save with an incomplete success body", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({ id: 40 }));
  vi.stubGlobal("fetch", fetcher);
  render(<WorkoutReuse sessionId={200} name="Upper" today="2026-09-05" />);
  change("Routine name", "Frozen routine");
  fireEvent.click(screen.getByRole("button", { name: "Save as routine" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(screen.queryByText("Routine saved. Find it in Workout history.")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Routine name")).toHaveValue("Frozen routine");
  fireEvent.click(screen.getByRole("button", { name: "Retry saving routine" }));
  await screen.findByText("Routine saved. Find it in Workout history.");
  expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body);
});

it.each([
  [400, { error: "Invalid date" }, true, true], [409, { error: "Revision conflict" }, false, true],
  [403, { error: "Forbidden" }, false, true], [503, { error: "Unavailable" }, false, false],
  [400, null, false, false], [409, {}, false, false], [400, { error: " " }, false, false],
])("classifies only parsed confirmed client errors (%s, %j)", async (status, body, confirmedRejection, confirmedClientError) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body, Number(status))));
  await expect(workoutRequest("/api/example", "POST", {})).rejects.toMatchObject({ status, confirmedRejection, confirmedClientError });
});
