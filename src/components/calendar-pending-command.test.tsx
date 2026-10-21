// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useCalendarCommand } from "./calendar-pending-command";
const command = (id: string) => ({ body: JSON.stringify({ type: "duplicate", occurrenceId: 1, revision: 3, requestKey: id, date: "2090-07-02" }), context: null });
beforeEach(() => localStorage.clear()); afterEach(cleanup);
it("does not erase a newer tab's command after a late acknowledgement", () => {
  const old = command("old-command"), newer = command("new-command");
  const view = renderHook(() => useCalendarCommand(71));
  act(() => view.result.current.persist(old));
  // Another tab reconciles old, then starts a separate deliberate action.
  localStorage.setItem("magni.calendar.pending:71", JSON.stringify(newer));
  act(() => view.result.current.persist(null, old));
  expect(localStorage.getItem("magni.calendar.pending:71")).toBe(JSON.stringify(newer));
});
it("refuses to overwrite a different pending command before sending", () => {
  const old = command("old-command"), newer = command("new-command");
  const view = renderHook(() => useCalendarCommand(71));
  act(() => view.result.current.persist(old));
  expect(() => view.result.current.persist(newer)).toThrow(/another calendar change/i);
  expect(localStorage.getItem("magni.calendar.pending:71")).toBe(JSON.stringify(old));
});
