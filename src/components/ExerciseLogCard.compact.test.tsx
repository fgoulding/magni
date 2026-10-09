// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetLogRow } from "./ExerciseLogCard";

afterEach(cleanup);
const defaults = () => ({
  number: 1, reps: "10", weight: "225.25", unit: "lb", repsLabel: "Reps", weightLabel: "Weight",
  saved: false, logged: false, pending: false, saving: false, failed: false, saveLabel: "Save set 1",
  onChange: vi.fn(), onSave: vi.fn(), onUndo: vi.fn(),
});

describe("compact set actions", () => {
  it("replaces the redundant saved check with an explicit Undo action", () => {
    const props = defaults();
    render(<SetLogRow {...props} saved logged />);
    expect(screen.getByText("Saved")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save set 1" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo set 1" }));
    expect(props.onUndo).toHaveBeenCalledOnce();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("keeps both deliberate actions available for an edited saved set", () => {
    const props = defaults();
    render(<SetLogRow {...props} logged pending />);
    expect(screen.getByText("Unsaved")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save set 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo set 1" }));
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(props.onUndo).toHaveBeenCalledOnce();
  });

  it("preserves focused action and input identity as saving becomes Undo and then unlogged", () => {
    const props = defaults();
    const view = render(<SetLogRow {...props} pending />);
    const action = screen.getByRole("button", { name: "Save set 1" });
    const weight = screen.getByRole("spinbutton", { name: "Weight" });
    action.focus();
    view.rerender(<SetLogRow {...props} saved logged />);
    expect(screen.getByRole("button", { name: "Undo set 1" })).toBe(action);
    expect(action).toHaveFocus();
    expect(screen.getByRole("spinbutton", { name: "Weight" })).toBe(weight);
    expect(weight).toHaveValue(225.25);
    view.rerender(<SetLogRow {...props} />);
    expect(screen.getByRole("button", { name: "Save set 1" })).toBe(action);
    expect(action).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Undo set 1" })).not.toBeInTheDocument();
  });

  it("moves an older dirty-row Undo focus to the persistent action slot", () => {
    const props = defaults();
    const view = render(<SetLogRow {...props} logged pending />);
    const primary = screen.getByRole("button", { name: "Save set 1" });
    const undo = screen.getByRole("button", { name: "Undo set 1" });
    undo.focus(); fireEvent.click(undo);
    view.rerender(<SetLogRow {...props} logged pending undoPending saving />);
    expect(screen.getByRole("button", { name: "Retry undo set 1" })).toBe(primary);
    expect(primary).toHaveFocus();
    expect(primary).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save set 1" })).not.toBeInTheDocument();
  });

  it("offers only the explicit Undo retry when the result is unconfirmed", () => {
    const props = defaults();
    render(<SetLogRow {...props} pending undoPending failed />);
    expect(screen.getByText("Undo unconfirmed")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save set 1" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry undo set 1" }));
    expect(props.onUndo).toHaveBeenCalledOnce();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it.each(["saving", "disabled", "saveDisabled"] as const)("keeps all dirty-row actions inert while %s", (flag) => {
    const props = defaults();
    render(<SetLogRow {...props} logged pending {...{ [flag]: true }} />);
    expect(screen.getByRole("button", { name: "Save set 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Undo set 1" })).toBeDisabled();
  });

  it("preserves honest missing-load and aggregate Undo feedback", () => {
    render(<SetLogRow {...defaults()} saved logged missingWeight count={3} weight="" />);
    expect(screen.getByText("Saved · load not recorded")).toBeVisible();
    expect(screen.getByText("3 sets · batch")).toBeVisible();
    expect(screen.getByRole("button", { name: "Undo 3-set log" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Save 3-set log" })).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Weight" })).toHaveValue(null);
  });
});
