// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ExerciseLogCard, SetLogRow } from "./ExerciseLogCard";

afterEach(cleanup);
const props = { number: 1, reps: "10", weight: "100", unit: "lb", repsLabel: "Reps", weightLabel: "Weight", saved: false, logged: false, pending: false, saving: false, failed: false, saveLabel: "Log set 1", onChange: vi.fn(), onSave: vi.fn(), onUndo: vi.fn() };

it("uses a compact open title while retaining full disclosure names and mounted edits when closed", () => {
  render(<ExerciseLogCard name="Squat + Row" expandedName="Superset A" saved={0} total={4}><input aria-label="Working weight" defaultValue="42.5" /></ExerciseLogCard>);
  const collapse = screen.getByRole("button", { name: "Collapse Squat + Row · Superset A" });
  expect(collapse).toHaveTextContent("Superset A");
  expect(collapse).not.toHaveTextContent("Squat + Row");
  const input = screen.getByRole("textbox", { name: "Working weight" });
  fireEvent.change(input, { target: { value: "45.5" } });
  fireEvent.click(collapse);
  expect(screen.getByRole("button", { name: "Expand Squat + Row · Superset A" })).toHaveTextContent("Squat + Row");
  expect(input).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Expand Squat + Row · Superset A" }));
  expect(screen.getByRole("textbox", { name: "Working weight" })).toBe(input);
  expect(input).toHaveValue("45.5");
});

it("quiets only routine unlogged status while keeping acknowledgement and recovery visible", () => {
  const { rerender } = render(<SetLogRow {...props} />);
  const status = screen.getByText("Not logged");
  expect(status).toHaveClass("sr-only");
  expect(status).toHaveAttribute("aria-live", "polite");
  for (const state of [
    { saved: true, logged: true, text: "Saved" },
    { pending: true, text: "Unsaved" },
    { saving: true, text: "Saving…" },
    { failed: true, text: "Save failed" },
    { saved: true, missingWeight: true, text: "Saved · load not recorded" },
  ]) {
    rerender(<SetLogRow {...props} {...state} />);
    expect(screen.getByText(state.text)).not.toHaveClass("sr-only");
  }
});

it("keeps the same check and inputs while toggling an acknowledged set off", () => {
  const onSave = vi.fn(), onUndo = vi.fn();
  const { rerender } = render(<SetLogRow {...props} onSave={onSave} onUndo={onUndo} />);
  const check = screen.getByRole("button", { name: "Log set 1" });
  const input = screen.getByRole("spinbutton", { name: "Weight" });
  const icon = check.querySelector("svg");
  check.focus();
  fireEvent.click(check);
  expect(onSave).toHaveBeenCalledOnce();
  rerender(<SetLogRow {...props} saved logged onSave={onSave} onUndo={onUndo} />);
  expect(screen.getByRole("button", { name: "Undo set 1", pressed: true })).toBe(check);
  expect(check).toHaveFocus();
  expect(check).toHaveTextContent("");
  expect(icon).toBeVisible();
  expect(screen.getByRole("spinbutton", { name: "Weight" })).toBe(input);
  fireEvent.click(check);
  expect(onUndo).toHaveBeenCalledOnce();
  rerender(<SetLogRow {...props} onSave={onSave} onUndo={onUndo} />);
  expect(screen.getByRole("button", { name: "Log set 1", pressed: false })).toBe(check);
});

it("keeps uncertain undo retry accessible without presenting the set as saved", () => {
  const onUndo = vi.fn();
  render(<SetLogRow {...props} logged undoPending failed onUndo={onUndo} />);
  const check = screen.getByRole("button", { name: "Retry undo set 1", pressed: false });
  expect(check).toHaveTextContent("");
  expect(screen.getByText("Undo unconfirmed")).toBeVisible();
  fireEvent.click(check);
  expect(onUndo).toHaveBeenCalledOnce();
});
