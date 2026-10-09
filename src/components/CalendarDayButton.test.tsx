// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarDayButton, type CalendarDayEntry } from "./CalendarDayButton";

vi.mock("next/link", () => ({ default: ({ prefetch: _prefetch, scroll: _scroll, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean; scroll?: boolean }) => { void _prefetch; void _scroll; return <a {...props} onClick={event => { event.preventDefault(); props.onClick?.(event); }} />; } }));
const events: CalendarDayEntry[] = [
  { key: "occurrence-1", occurrenceId: 1, date: "2026-05-05", title: "Scheduled: Strength - Bench", dayName: "Bench", programName: "Strength", status: "scheduled", href: "/calendar?workout=occurrence-1&view=month" },
  { key: "history-2", date: "2026-05-05", title: "In progress: Mobility", dayName: "Mobility", status: "in_progress", href: "/calendar?workout=history-2&view=month" },
];
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(cleanup);
function open(onOptions?: (key: string) => void) {
  render(<CalendarDayButton date="2026-05-05" events={events} returnTo="/calendar?month=2026-05&date=2026-05-04&view=month" className="" onOptions={onOptions}>May 5</CalendarDayButton>);
  fireEvent.click(screen.getByRole("button", { name: "2 workouts on Tue, May 5" }));
  return screen.getByRole("dialog", { name: "Workouts on Tue, May 5" });
}
describe("Calendar day disclosure", () => {
  it("exposes every workout with status, full name and its original destination", () => {
    const dialog = open();
    for (const event of events) expect(within(dialog).getByRole("link", { name: `${event.title} on ${event.date}` }).getAttribute("href")).toBe(event.href);
    expect(within(dialog).getByRole("link", { name: "Add workout" }).getAttribute("href")).toBe("/workouts/new?date=2026-05-05&returnTo=%2Fcalendar%3Fmonth%3D2026-05%26date%3D2026-05-04%26view%3Dmonth");
    expect(within(dialog).getByRole("link", { name: "See this week" }).getAttribute("href")).toBe("/calendar?month=2026-05&date=2026-05-05");
  });
  it("closes on Escape and can reopen", () => {
    const dialog = open();
    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "2 workouts on Tue, May 5" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
  it("closes the native dialog before handing a scheduled workout to its actions", () => {
    const onOptions = vi.fn(() => expect(document.querySelector("dialog[open]")).toBeNull());
    const dialog = open(onOptions);
    expect(within(dialog).getAllByRole("button", { name: /More options/ })).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "More options for Bench" }));
    expect(onOptions).toHaveBeenCalledWith("occurrence-1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("dismisses the list when opening a workout", () => {
    const dialog = open();
    fireEvent.click(within(dialog).getByRole("link", { name: /In progress: Mobility/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
