// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSet, type ProgramSetV1 } from "@/features/program-editor/document";
import { SetPrescriptionEditor } from "./SetPrescriptionEditor";

afterEach(cleanup);

function Editor({ initialSet = createSet() }: { initialSet?: ProgramSetV1 }) {
  const [set, setSet] = useState(initialSet);
  return <SetPrescriptionEditor set={set} index={0} count={2} unit="kg" workingLoad={50} onChange={patch => setSet(value => ({ ...value, ...patch }))} onMove={vi.fn()} onCopy={vi.fn()} onRemove={vi.fn()} />;
}

describe("prescription rows", () => {
  it("edits reps and rest without opening advanced fields and summarizes hidden targets", () => {
    render(<Editor initialSet={{ ...createSet(), effortKind: "rpe", effort: 8, tempo: "3-1-1", notes: "Pause at the bottom" }} />);
    const details = screen.getByRole("button", { name: "Set 1 details" });
    expect(details).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Tempo")).not.toBeInTheDocument();
    expect(screen.getByText("RPE 8 · Tempo 3-1-1 · Pause at the bottom")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Set 1 minimum reps"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("Set 1 maximum reps"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Set 1 rest (seconds)"), { target: { value: "150" } });
    expect(screen.getByLabelText("Set 1 minimum reps")).toHaveValue(6);
    expect(screen.getByLabelText("Set 1 maximum reps")).toHaveValue(9);
    expect(screen.getByLabelText("Set 1 rest (seconds)")).toHaveValue(150);
    fireEvent.click(details);
    expect(details).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Tempo")).toHaveValue("3-1-1");
    expect(screen.getByLabelText("Set notes")).toHaveValue("Pause at the bottom");
  });

  it("retains editable values across all five load bases", () => {
    render(<Editor />);
    expect(screen.getByText("50 kg")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Set 1 details" }));
    for (const mode of ["fixed", "percent", "added"]) {
      fireEvent.change(screen.getByLabelText("Load basis"), { target: { value: mode } });
      fireEvent.change(screen.getByLabelText(mode === "percent" ? "Set 1 percent of max" : "Set 1 load (kg)"), { target: { value: "72.5" } });
      expect(screen.getByLabelText(mode === "percent" ? "Set 1 percent of max" : "Set 1 load (kg)")).toHaveValue(72.5);
    }
    fireEvent.change(screen.getByLabelText("Load basis"), { target: { value: "bodyweight" } });
    expect(screen.queryByLabelText("Set 1 load (kg)")).not.toBeInTheDocument();
    expect(screen.getByText("Bodyweight", { selector: "span" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Load basis"), { target: { value: "working" } });
    expect(screen.getByText("50 kg")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Load basis"), { target: { value: "fixed" } });
    expect(screen.getByLabelText("Set 1 load (kg)")).toHaveValue(72.5);
  });
});
