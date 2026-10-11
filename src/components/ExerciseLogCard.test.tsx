// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SetLogRow } from "./ExerciseLogCard";

afterEach(cleanup);
const props = { number: 1, reps: "10", weight: "100", unit: "lb", repsLabel: "Reps", weightLabel: "Weight", saved: false, logged: false, pending: false, saving: false, failed: false, saveLabel: "Log set 1", onChange: vi.fn(), onSave: vi.fn(), onUndo: vi.fn() };

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
