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
const props = { event: source, events: [source], weekStart: "2090-06-05", returnTo: "/calendar?month=2090-06&date=2090-06-05&view=month" };
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ operationId: "moved", changes: [] })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("Move from selected calendar workout", () => {
  it("opens the collision chooser for a direct drop when only the server knows the destination is occupied", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ error: "Choose how to move this workout.", conflicts: [{ key: "occurrence-2", id: 2, date: "2090-07-02", name: "Upper", revision: 4, canSwap: true }] }, 409));
    function Drop() {
      const controller = useCalendarActions([source], props.weekStart);
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
    fireEvent.click(screen.getByRole("button", { name: "Save date" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    const bodies = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(init!.body as string));
    expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]);
  });

  it.each(["completed", "skipped"])("protects %s history from a move action", status => {
    render(<CalendarMoveButton {...props} event={{ ...source, status }} />);
    expect(screen.queryByRole("button", { name: "Move to date" })).not.toBeInTheDocument();
  });
});
