// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBlankDocument, type ProgramDocumentV1 } from "@/features/program-editor/document";
import { makePreset } from "@/features/program-editor/operations";
import { ProgramBuilder } from "./ProgramBuilder";
afterEach(cleanup);
function Harness({ initial = createBlankDocument() }: { initial?: ProgramDocumentV1 }) {
  const [document, setDocument] = useState(initial);
  return <ProgramBuilder document={document} onChange={update => setDocument(current => { const next = structuredClone(current); update(next); return next; })} onActivate={vi.fn()} activating={false} activeId={null} onAdvanced={vi.fn()} onExport={vi.fn()} />;
}
describe("day-based program builder", () => {
  it("builds a day and paired exercises without structure tabs", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Program name"), { target: { value: "Three day strength" } });
    fireEvent.click(screen.getByRole("button", { name: "Add superset" }));
    expect(screen.getByText("Superset A · 3 rounds")).toBeVisible();
    const cards = screen.getAllByRole("group", { name: /Exercise \d/ });
    fireEvent.change(within(cards[0]).getByLabelText("Exercise name"), { target: { value: "Squat" } });
    fireEvent.change(within(cards[0]).getByLabelText("Sets"), { target: { value: "5" } });
    expect(screen.getByText("Superset A · 5 / 3 sets")).toBeVisible();
    expect(within(cards[1]).getByLabelText("Sets")).toHaveValue(3);
    fireEvent.click(screen.getByRole("button", { name: "Add day" }));
    expect(screen.getByLabelText("Day name")).toHaveValue("Day 2");
    expect(screen.queryByRole("button", { name: "Prescriptions" })).toBeNull();
  });
  it("focuses newly added fields and announces reorder results", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Add superset" }));
    expect(screen.getAllByLabelText("Exercise name")[0]).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Add day" }));
    expect(screen.getByLabelText("Day name")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Move day earlier" }));
    expect(screen.getByRole("status")).toHaveTextContent("Day moved earlier.");
  });
  it("shows advanced individual sets and preserves them through ordinary name edits", () => {
    render(<Harness initial={makePreset("top-backoff", "2026-10-13")} />);
    expect(screen.getAllByText(/Individual sets/)[0]).toBeVisible();
    expect(screen.getAllByText(/Top set/).length).toBeGreaterThan(0);
    const card = screen.getAllByRole("group", { name: /Exercise \d/ })[0];
    fireEvent.change(within(card).getByLabelText("Exercise name"), { target: { value: "Paused squat" } });
    expect(within(card).queryByLabelText("Sets")).toBeNull();
    fireEvent.click(within(card).getByText("Edit individual sets"));
    expect(within(card).getByLabelText("Set 1 minimum reps")).toBeVisible();
  });
  it("deduplicates technique cues while retaining full authored notes", () => {
    const initial = makePreset("manual-ab", "2026-10-13");
    const exercise = initial.weeks[0].days[0].exercises[0];
    exercise.notes = "Pause at the bottom.";
    exercise.sets.forEach(set => { set.notes = "Pause at the bottom. Choose your working weight before logging."; });
    render(<Harness initial={initial} />);
    const card = screen.getAllByRole("group", { name: /Exercise \d/ })[0];
    const cues = within(card).getByLabelText("Exercise cues");
    expect(cues.textContent?.match(/Pause at the bottom/g)).toHaveLength(1);
    fireEvent.click(within(card).getByText("Details", { selector: "summary" }));
    expect(within(card).getByLabelText("Exercise notes")).toHaveValue("Pause at the bottom.");
  });
  it("associates mixed effort targets with their sets and offers a footer review action", () => {
    render(<Harness initial={makePreset("top-backoff", "2026-10-13")} />);
    const card = screen.getAllByRole("group", { name: /Exercise \d/ })[0];
    const sets = within(card).getAllByRole("listitem");
    expect(sets[0]).toHaveTextContent(/Top set.*RPE 8/);
    expect(sets[1]).toHaveTextContent(/Back-off/);
    expect(within(card).getByLabelText("Exercise cues")).not.toHaveTextContent("Skipped exposures");
    const reviews = screen.getAllByRole("button", { name: "Review & start" });
    expect(reviews).toHaveLength(2);
    fireEvent.click(reviews[1]);
    expect(screen.getByRole("heading", { name: "Review your program" })).toBeVisible();
  });
  it("returns from review to the chosen day with focus", () => {
    const initial = makePreset("manual-ab", "2026-10-13");
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Review & start" })[0]);
    fireEvent.click(screen.getByRole("button", { name: `Edit ${initial.weeks[0].days[1].name}` }));
    expect(screen.getByLabelText("Day name")).toHaveValue(initial.weeks[0].days[1].name);
    expect(screen.getByLabelText("Day name")).toHaveFocus();
  });
  it("reviews workout content and actual schedule before starting", () => {
    render(<Harness initial={makePreset("manual-ab", "2026-10-13")} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Review & start" })[0]);
    expect(screen.getByRole("heading", { name: "Review your program" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Start program" })).toBeVisible();
    expect(screen.getByText(/First workout:/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back to editing" }));
    expect(screen.getByLabelText("Day name")).toBeVisible();
  });
});
