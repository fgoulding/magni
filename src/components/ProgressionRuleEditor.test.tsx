// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSet } from "@/features/program-editor/document";
import type { ProgressionRuleV1 } from "@/features/program-editor/progression";
import { defaultEditorRule, ProgressionRuleEditor } from "./ProgressionRuleEditor";

const sets = [createSet(), createSet()];
const state = { load: 40, trainingMax: 100, reps: 8, consecutiveFailures: 0, lastEvaluatedWeek: null };
const onChange = vi.fn();
function Editor({ initialRule = defaultEditorRule("lb") }: { initialRule?: ProgressionRuleV1 | null }) {
  const [rule, setRule] = useState(initialRule);
  return <ProgressionRuleEditor rule={rule} onChange={value => { onChange(value); setRule(value); }} sets={sets} state={state} initialReps={state.reps} unit="lb" week={1} isDeload={false} />;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); onChange.mockClear(); });

describe("progression authoring", () => {
  it("shows effective weekly timing even when an older weekly rule says per exposure", () => {
    render(<Editor initialRule={{ ...defaultEditorRule("lb"), condition: { type: "weekly" } }} />);
    expect(screen.getByRole("group", { name: "When" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Frequency" })).toBeVisible();
    expect(screen.getByLabelText("Evaluate")).toHaveValue("weekly");
    expect(screen.getByLabelText("Evaluate")).toBeDisabled();
    expect(screen.getByText(/A weekly condition always evaluates once per logical program week/)).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("applies only a selected rule preset and reports incompatible top-set choices", () => {
    const originalSets = structuredClone(sets);
    render(<Editor />);
    fireEvent.change(screen.getByLabelText("Rule starting point"), { target: { value: "top" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply rule preset" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/top|AMRAP/i);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Rule starting point"), { target: { value: "weekly" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply rule preset" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ condition: { type: "weekly" } }));
    expect(sets).toEqual(originalSets);
  });

  it("distinguishes unlogged from zero reps without authoring or training writes", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<Editor />);
    const preview = screen.getByRole("status", { name: "Progression preview result" });
    fireEvent.change(screen.getByLabelText("Set 1 reps"), { target: { value: "" } });
    expect(preview).toHaveTextContent(/Partial exposure/);
    fireEvent.change(screen.getByLabelText("Set 1 reps"), { target: { value: "0" } });
    expect(preview).toHaveTextContent(/consecutive failures: 1/);
    expect(onChange).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("carries failure counts across trials, then resets only hypothetical work", () => {
    const rule = { ...defaultEditorRule("lb"), failureReset: { afterFailures: 2, percent: 10, rounding: { mode: "nearest" as const, quantum: 1 } } };
    render(<Editor initialRule={rule} />);
    fireEvent.change(screen.getByLabelText("Set 1 reps"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Add hypothetical workout" }));
    const second = screen.getByRole("group", { name: "Hypothetical workout 2" });
    fireEvent.change(within(second).getByLabelText("Workout 2, set 1 reps"), { target: { value: "0" } });
    expect(within(second).getByRole("status")).toHaveTextContent(/2 consecutive failed exposures/);
    expect(within(second).getByText("40 lb → 36 lb")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Reset simulation" }));
    expect(screen.queryByRole("group", { name: "Hypothetical workout 2" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Set 1 reps")).toHaveValue(12);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("holds repeated trials in the same logical week and gives deload precedence", () => {
    render(<Editor initialRule={{ ...defaultEditorRule("lb"), condition: { type: "weekly" }, skipPolicy: "count_failure" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add hypothetical workout" }));
    const second = screen.getByRole("group", { name: "Hypothetical workout 2" });
    fireEvent.change(within(second).getByLabelText("Workout 2 logical week"), { target: { value: "1" } });
    expect(within(second).getByRole("status")).toHaveTextContent(/already been evaluated/);
    fireEvent.change(screen.getByLabelText("Workout status (hypothetical)"), { target: { value: "skipped" } });
    fireEvent.click(screen.getByLabelText("Deload (hypothetical)"));
    expect(screen.getByRole("status", { name: "Progression preview result" })).toHaveTextContent(/Fixed deload/);
  });

  it("seeds new trials from progressed rep targets and preserves entered later outcomes", () => {
    const base = defaultEditorRule("lb");
    render(<Editor initialRule={{ ...base, action: { ...base.action, variable: "reps", unit: "reps", amount: 1, rounding: { mode: "nearest", quantum: 1 } } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add hypothetical workout" }));
    const second = screen.getByRole("group", { name: "Hypothetical workout 2" });
    expect(within(second).getByLabelText("Workout 2, set 1 reps")).toHaveValue(13);
    expect(within(second).getAllByText("Target 9–13 reps · 40 lb")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Set 1 reps"), { target: { value: "8" } });
    expect(within(second).getByLabelText("Workout 2, set 1 reps")).toHaveValue(13);
    expect(within(second).getAllByText("Target 8–12 reps · 40 lb")).toHaveLength(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("bounds trials at eight and removes a trial without changing the authored rule", () => {
    render(<Editor />);
    const add = screen.getByRole("button", { name: "Add hypothetical workout" });
    for (let index = 1; index < 8; index++) fireEvent.click(add);
    expect(add).toBeDisabled();
    expect(screen.getAllByRole("group", { name: /^Hypothetical workout/ })).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "Remove hypothetical workout 4" }));
    expect(add).toBeEnabled();
    expect(screen.getAllByRole("group", { name: /^Hypothetical workout/ })).toHaveLength(7);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("identifies an invalid hypothetical workout and recovers without discarding the rule", () => {
    render(<Editor />);
    fireEvent.change(screen.getByLabelText("Logical week (hypothetical)"), { target: { value: "0" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/Workout 1/);
    expect(screen.getByRole("button", { name: "Add hypothetical workout" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Logical week (hypothetical)"), { target: { value: "1" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Progression preview result" })).toHaveTextContent("42.5");
    expect(onChange).not.toHaveBeenCalled();
  });
});
