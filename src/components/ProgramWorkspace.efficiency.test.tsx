// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as documents from "@/features/program-editor/document";
import { makePreset } from "@/features/program-editor/operations";
import * as builderOperations from "./program-builder-operations";
import { ProgramWorkspace } from "./ProgramWorkspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ revision: 2 }))));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function openWorkspace() {
  render(<ProgramWorkspace userId={7} draftId="4a23c102-35b2-4394-91ba-1539de0bd822"
    initialDocument={makePreset("manual-ab", "2026-10-13")} initialRevision={1} activatedProgramId={null} />);
}
const review = () => fireEvent.click(screen.getAllByRole("button", { name: "Review & start" })[0]);

describe("editor document work budget", () => {
  it("validates once per document change across workspace and builder, retaining current warnings", () => {
    const validate = vi.spyOn(documents, "validateDocument");
    openWorkspace();
    expect(validate).toHaveBeenCalledTimes(1);
    review();
    expect(validate).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Program name"), { target: { value: "" } });
    expect(validate).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Program validation")).toHaveTextContent(/name/i);
    fireEvent.change(screen.getByLabelText("Program name"), { target: { value: "Full body" } });
    expect(validate).toHaveBeenCalledTimes(3);
    expect(screen.queryByLabelText("Program validation")).not.toBeInTheDocument();
  });

  it("expands the schedule only in review and refreshes it when the draft changes", () => {
    const schedule = vi.spyOn(builderOperations, "previewBuilderSchedule");
    openWorkspace();
    expect(schedule).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Program name"), { target: { value: "Updated program" } });
    expect(schedule).not.toHaveBeenCalled();
    review();
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/First workout:/)).toHaveTextContent("2026-10-14");
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-11-03" } });
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/First workout:/)).toHaveTextContent("2026-11-04");
    fireEvent.click(screen.getByRole("button", { name: "Back to editing" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Draft editing actions" })).getByRole("button", { name: "Undo last edit" }));
    expect(schedule).toHaveBeenCalledTimes(2);
    review();
    expect(screen.getByText(/First workout:/)).toHaveTextContent("2026-10-14");
  });
});
