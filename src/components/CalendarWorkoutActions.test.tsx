// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarActionSheets, CalendarMoveButton, useCalendarActions } from "./CalendarWorkoutActions";
import type { AgendaEvent } from "./CalendarAgenda";

const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const source: AgendaEvent = { key: "occurrence-1", occurrenceId: 1, revision: 3, date: "2090-06-05", title: "Lower", dayName: "Lower", programName: "Strength", currentWeek: 2, href: "/calendar?workout=occurrence-1", status: "scheduled" };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const props = { userId: 71, event: source, events: [source], weekStart: "2090-06-05", returnTo: "/calendar?month=2090-06&date=2090-06-05&view=month" };
beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ operationId: "moved", changes: [] })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("Move from selected calendar workout", () => {
  it("opens the collision chooser for a direct drop when only the server knows the destination is occupied", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ error: "Choose how to move this workout.", conflicts: [{ key: "occurrence-2", id: 2, date: "2090-07-02", name: "Upper", revision: 4, canSwap: true }] }, 409));
    function Drop() {
      const controller = useCalendarActions(71, [source], props.weekStart);
      return <><button onClick={() => void controller.openMove(source, "2090-07-02")}>Drop workout</button><CalendarActionSheets controller={controller} /></>;
    }
    render(<Drop />);
    fireEvent.click(screen.getByRole("button", { name: "Drop workout" }));
    const dialog = await screen.findByRole("dialog", { name: "Move Lower" });
    expect(within(dialog).getByText(/already has Upper/)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Swap with Upper" })).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Move here · keep both" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toMatchObject({ type: "move", occurrenceId: 1, revision: 3, date: "2090-07-02", collision: "move" });
  });

  it("offers the same date picker and preserves month selection after an acknowledged scheduled move", async () => {
    render(<CalendarMoveButton {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to date" }));
    expect(screen.getByRole("dialog", { name: "Move Lower" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Another date"), { target: { value: "2090-07-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Save date" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/calendar?month=2090-07&date=2090-07-02&view=month&workout=occurrence-1", { scroll: false }));
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ type: "move", occurrenceId: 1, revision: 3, date: "2090-07-02", requestKey: expect.any(String) });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves an active session using both revisions and offers keep-both without swapping", async () => {
    const active = { ...source, status: "in_progress", sessionId: 15, sessionRevision: 8 };
    vi.mocked(fetch).mockResolvedValueOnce(response({ id: 15, status: "in_progress", date: source.date, revision: 9 }));
    const target = { ...source, key: "occurrence-2", occurrenceId: 2, date: "2090-06-06", dayName: "Upper" };
    render(<CalendarMoveButton {...props} event={active} events={[active, target]} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to date" }));
    fireEvent.click(await screen.findByRole("button", { name: "Tue, Jun 6" }));
    expect(screen.getByText(/already has Upper/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Swap with/ })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/sessions/15");
    fireEvent.click(screen.getByRole("button", { name: "Move here · keep both" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toMatchObject({ type: "move", occurrenceId: 1, revision: 3, sessionRevision: 9, date: "2090-06-06", collision: "move" });
  });

  it("retains the chosen date and request identity through a lost response, blocking dismissal during save", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((_resolve, failed) => { reject = failed; })).mockResolvedValue(response({ operationId: "retry", changes: [] }));
    render(<CalendarMoveButton {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to date" }));
    fireEvent.change(screen.getByLabelText("Another date"), { target: { value: "2090-07-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Save date" }));
    const dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(dialog).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Close calendar action" })).toBeDisabled();
    await act(async () => reject(new Error("Connection lost")));
    expect(screen.getByRole("alert")).toHaveTextContent("Connection lost");
    expect(screen.getByLabelText("Another date")).toHaveValue("2090-07-02");
    fireEvent.click(screen.getByRole("button", { name: "Retry calendar change" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    const bodies = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(init!.body as string));
    expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]);
  });

  it.each(["completed", "skipped"])("protects %s history from a move action", status => {
    render(<CalendarMoveButton {...props} event={{ ...source, status }} />);
    expect(screen.queryByRole("button", { name: "Move to date" })).not.toBeInTheDocument();
  });
});

describe("persistent calendar command recovery", () => {
  function Duplicate({ owner = 71 }: { owner?: number }) {
    const controller = useCalendarActions(owner, [source], props.weekStart);
    return <section aria-label={`Owner ${owner}`}><button onClick={() => controller.setMenu(source)}>Options</button><CalendarActionSheets controller={controller} /></section>;
  }
  it("reconciles an original lost Duplicate after remount before allowing a deliberate later Duplicate", async () => {
    const commands: string[] = [];
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      commands.push(String(init?.body));
      if (commands.length === 1) throw new Error("Response lost");
      return response({ operationId: "duplicate", changes: [] });
    });
    const first = render(<Duplicate />);
    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate workout" }));
    fireEvent.change(screen.getByLabelText("Another date"), { target: { value: "2090-07-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Save date" }));
    await screen.findByText("Response lost");
    first.unmount(); render(<Duplicate />);
    fireEvent.click(screen.getByRole("button", { name: "Retry calendar change" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(commands).toHaveLength(2); expect(commands[1]).toBe(commands[0]);
    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate workout" }));
    fireEvent.change(screen.getByLabelText("Another date"), { target: { value: "2090-07-03" } });
    fireEvent.click(screen.getByRole("button", { name: "Save date" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(2));
    expect(JSON.parse(commands[2])).toMatchObject({ type: "duplicate", date: "2090-07-03" });
    expect(JSON.parse(commands[2]).requestKey).not.toBe(JSON.parse(commands[0]).requestKey);
  });
  it("does not replace an uncertain original command when the date input changes", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Response lost"));
    render(<CalendarMoveButton {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to date" }));
    fireEvent.change(screen.getByLabelText("Another date"), { target: { value: "2090-07-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Save date" }));
    await screen.findByText("Response lost");
    expect(screen.getByLabelText("Another date")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Another date"), { target: { value: "2090-07-03" } });
    fireEvent.click(screen.getByRole("button", { name: "Save date" }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Retry calendar change" })).toBeEnabled();
  });
  it("does not send a command that cannot be persisted", async () => {
    render(<CalendarMoveButton {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to date" }));
    fireEvent.change(screen.getByLabelText("Another date"), { target: { value: "2090-07-02" } });
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
    fireEvent.click(screen.getByRole("button", { name: "Save date" }));
    expect(fetch).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Device storage is unavailable");
    storage.mockRestore();
  });
});

it("shares the in-flight lock and pending recovery between controls for the same owner only", async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((_done, fail) => { reject = fail; }));
  render(<><section aria-label="First"><CalendarMoveButton {...props} /></section><section aria-label="Second"><CalendarMoveButton {...props} /></section><section aria-label="Other owner"><CalendarMoveButton {...props} userId={72} /></section></>);
  fireEvent.click(within(screen.getByRole("region", { name: "First" })).getByRole("button", { name: "Move to date" }));
  fireEvent.change(screen.getByLabelText("Another date"), { target: { value: "2090-07-02" } });
  fireEvent.click(screen.getByRole("button", { name: "Save date" }));
  expect(within(screen.getByRole("region", { name: "Second" })).getByRole("button", { name: "Move to date" })).toBeDisabled();
  expect(within(screen.getByRole("region", { name: "Other owner" })).getByRole("button", { name: "Move to date" })).toBeEnabled();
  await act(async () => reject(new Error("Response lost")));
  expect(within(screen.getByRole("region", { name: "Second" })).getByRole("button", { name: "Retry calendar change" })).toBeEnabled();
  expect(within(screen.getByRole("region", { name: "Other owner" })).queryByRole("button", { name: "Retry calendar change" })).not.toBeInTheDocument();
  vi.mocked(fetch).mockResolvedValue(response({ operationId: "restored", changes: [] }));
  fireEvent.click(within(screen.getByRole("region", { name: "Second" })).getByRole("button", { name: "Retry calendar change" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Retry calendar change" })).not.toBeInTheDocument());
  expect(vi.mocked(fetch).mock.calls[1][1]?.body).toBe(vi.mocked(fetch).mock.calls[0][1]?.body);
});

it.each([401, 429, 500, 200])("retains the original command through an inconclusive %s retry response", async status => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error("Response lost")).mockResolvedValueOnce(response(status === 200 ? {} : { error: "Try again" }, status)).mockResolvedValue(response({ operationId: "restored", changes: [] }));
  render(<CalendarMoveButton {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Move to date" }));
  fireEvent.change(screen.getByLabelText("Another date"), { target: { value: "2090-07-02" } });
  fireEvent.click(screen.getByRole("button", { name: "Save date" }));
  await screen.findByText("Response lost");
  fireEvent.click(screen.getByRole("button", { name: "Retry calendar change" }));
  await screen.findByText(status === 200 ? "Could not confirm the calendar change. Retry to recover it safely." : "Try again");
  fireEvent.click(screen.getByRole("button", { name: "Retry calendar change" }));
  await waitFor(() => expect(router.replace).toHaveBeenCalled());
  const bodies = vi.mocked(fetch).mock.calls.map(([, init]) => init?.body);
  expect(bodies).toHaveLength(3); expect(new Set(bodies).size).toBe(1);
});

it("does not persist or POST while another tab owns the calendar Web Lock", async () => {
  const request = vi.fn(async (_name, _options, callback) => callback(null));
  const original = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
  try {
    render(<CalendarMoveButton {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to date" }));
    fireEvent.change(screen.getByLabelText("Another date"), { target: { value: "2090-07-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Save date" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Another tab is confirming a calendar change");
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem("magni.calendar.pending:71")).toBeNull();
    expect(request).toHaveBeenCalledWith("magni.calendar.pending:71", { ifAvailable: true }, expect.any(Function));
  } finally {
    if (original) Object.defineProperty(navigator, "locks", original);
    else Reflect.deleteProperty(navigator, "locks");
  }
});
