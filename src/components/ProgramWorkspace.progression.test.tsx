// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProgramWorkspace } from "./ProgramWorkspace";
import { cloneExercise, cloneWeek, makePreset } from "@/features/program-editor/operations";
import { createDay, createSet, type ProgramDocumentV1 } from "@/features/program-editor/document";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const draftId = "0637d7ce-4e6b-40eb-b783-980f2929fbdb";
const storageKey = `magni:program-draft:7:${draftId}`;
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ revision: 2 }))));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture() {
  const document = makePreset("double", "2026-09-30");
  const source = document.weeks[0].days[0].exercises[0];
  source.name = "Row";
  const target = cloneExercise(source, false);
  target.name = "Squat"; target.baseLoad = 225; target.trainingMax = 315; target.rule = null;
  const secondDay = createDay("Day B"); secondDay.exercises = [target];
  document.weeks[0].days.push(secondDay);
  const secondWeek = cloneWeek(document.weeks[0]); secondWeek.name = "Week 2";
  document.weeks.push(secondWeek);
  return { document, source, target };
}
function open(document: ProgramDocumentV1) {
  render(<ProgramWorkspace userId={7} draftId={draftId} initialDocument={document} initialRevision={1} activatedProgramId={null} />);
  fireEvent.click(screen.getByRole("button", { name: "Progression & preview" }));
}
function pending(): ProgramDocumentV1 {
  return JSON.parse(localStorage.getItem(storageKey)!).document;
}
function openCopy() {
  fireEvent.click(screen.getByText("Copy rule to other lifts", { exact: true }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Squat/ }));
}

describe("progression workspace reuse", () => {
  it("simulates a later rep override from the first shared progression baseline", () => {
    const { document, source } = fixture();
    source.sets.unshift({ ...createSet(), role: "warmup", repMin: 3, repMax: 3 });
    source.rule!.condition = { type: "all_work_sets", target: "minimum" };
    source.rule!.action = { variable: "reps", unit: "reps", operation: "percent", amount: 25, rounding: { mode: "nearest", quantum: 1 }, timing: "per_exposure" };
    const later = document.weeks[1].days[0].exercises[0];
    later.rule = structuredClone(source.rule);
    for (const set of later.sets) { set.repMin = 12; set.repMax = 12; }
    open(document);
    fireEvent.click(within(screen.getByRole("complementary", { name: "Program outline" })).getByRole("button", { name: "Select week 2, day 1: Day A" }));

    const first = screen.getByRole("group", { name: "Hypothetical workout 1" });
    expect(within(first).getByLabelText("Set 1 reps")).toHaveValue(12);
    expect(within(first).getByText("8 reps → 10 reps")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Add hypothetical workout" }));
    const second = screen.getByRole("group", { name: "Hypothetical workout 2" });
    expect(within(second).getByLabelText("Workout 2, set 1 reps")).toHaveValue(14);
    expect(within(second).getAllByText("Target 14 reps · 40 lb")).toHaveLength(later.sets.length);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("keeps progression open when selecting another day", () => {
    const { document } = fixture(); open(document);
    const outline = screen.getByRole("complementary", { name: "Program outline" });
    fireEvent.click(within(outline).getByRole("button", { name: "Select week 1, day 2: Day B" }));
    expect(screen.getByRole("combobox", { name: "Progression condition" })).toHaveValue("manual");
    expect(screen.getByRole("button", { name: "Progression & preview" })).toHaveAttribute("aria-pressed", "true");
  });

  it("previews every affected appearance and copies only the rule with one Undo", () => {
    const { document, source, target } = fixture(); open(document); openCopy();
    const preview = screen.getByRole("region", { name: "Rule copy preview" });
    expect(preview).toHaveTextContent("Week 1"); expect(preview).toHaveTextContent("Week 2");
    expect(preview).toHaveTextContent("2 appearances");
    fireEvent.click(screen.getByRole("button", { name: "Apply rule to selected lifts" }));
    const copied = pending();
    const targets = copied.weeks.flatMap(week => week.days.flatMap(day => day.exercises)).filter(exercise => exercise.progressionKey === target.progressionKey);
    expect(targets).toHaveLength(2);
    for (const exercise of targets) {
      const original = document.weeks.flatMap(week => week.days.flatMap(day => day.exercises)).find(item => item.id === exercise.id)!;
      expect(exercise).toEqual({ ...original, rule: source.rule });
    }
    expect(copied.weeks[0].days[0].exercises[0]).toEqual(source);
    fireEvent.click(screen.getByRole("button", { name: "Undo last edit" }));
    expect(pending()).toEqual(document);
  });

  it("blocks an incompatible designated-set copy without editing any target", () => {
    const { document, source } = fixture();
    source.sets[0].role = "top";
    source.rule!.condition = { type: "designated_set", setId: source.sets[0].id, targetReps: 12 };
    open(document); openCopy();
    expect(screen.getByRole("region", { name: "Rule copy preview" })).toHaveTextContent(/top|designated/i);
    expect(screen.getByRole("button", { name: "Apply rule to selected lifts" })).toBeDisabled();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("reuses a complete exercise as an independent copy with remapped set identity", () => {
    const { document, source } = fixture();
    source.sets[0].role = "top";
    source.rule!.condition = { type: "designated_set", setId: source.sets[0].id, targetReps: 12 };
    source.notes = "Keep this exercise note";
    open(document);
    const outline = screen.getByRole("complementary", { name: "Program outline" });
    fireEvent.click(within(outline).getByRole("button", { name: "Select week 1, day 2: Day B" }));
    fireEvent.click(screen.getByText("Reuse an exercise", { exact: true }));
    fireEvent.change(screen.getByRole("combobox", { name: "Exercise to reuse" }), { target: { value: source.id } });
    fireEvent.click(screen.getByRole("button", { name: "Add independent copy" }));
    const copy = pending().weeks[0].days[1].exercises[1];
    expect(copy.id).not.toBe(source.id);
    expect(copy.progressionKey).not.toBe(source.progressionKey);
    expect(copy.name).toBe(source.name); expect(copy.notes).toBe(source.notes);
    expect(copy.baseLoad).toBe(source.baseLoad); expect(copy.trainingMax).toBe(source.trainingMax);
    expect(copy.sets.map(set => ({ ...set, id: "" }))).toEqual(source.sets.map(set => ({ ...set, id: "" })));
    expect(copy.sets.every(set => !source.sets.some(old => old.id === set.id))).toBe(true);
    expect(copy.rule?.condition).toEqual({ type: "designated_set", setId: copy.sets[0].id, targetReps: 12 });
    fireEvent.click(screen.getByRole("button", { name: "Undo last edit" }));
    expect(pending()).toEqual(document);
  });
});
