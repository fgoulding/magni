// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProgramWorkspace } from "./ProgramWorkspace";
import { makePreset } from "@/features/program-editor/operations";
import { createSet, validateDraftStructure } from "@/features/program-editor/document";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const id = "4a23c102-35b2-4394-91ba-1539de0bd822";
const document = makePreset("double", "2026-09-05");
const props = { userId: 7, draftId: id, initialDocument: document, initialRevision: 1, activatedProgramId: null };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string,value: string) => storage.set(key,value), removeItem: (key: string) => storage.delete(key) });
  router.push.mockClear(); router.refresh.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const rename = (name: string) => fireEvent.change(screen.getByLabelText("Program name"), { target: { value: name } });

describe("program workspace recovery and authoring", () => {
  it("retains the activation action after an incomplete success response and retries safely", async () => {
    const activationReply = vi.fn().mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({ programId: 42 }));
    const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
      if (url === `/api/program-drafts/${id}/activate` && options.method === "POST") return activationReply();
      if (url === "/api/programs/42/editor-changes" && options.method === "GET") return response({ draftId: id, publishedRevisionId: null, occurrences: [] });
      throw new Error(`Unexpected request: ${options.method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProgramWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Review & activate" }));
    fireEvent.click(screen.getByRole("button", { name: /^Activate program$/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Activation response was incomplete");
    expect(screen.queryByText("Program activated")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Activate program$/ }));
    expect(await screen.findByText("Program activated")).toBeVisible();
    expect(fetchMock.mock.calls[0]).toEqual(fetchMock.mock.calls[1]);
    expect(activationReply).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByLabelText("Change scope")).toBeEnabled());
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/programs/42/editor-changes", expect.objectContaining({ method: "GET" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("restores local pending text after navigation without claiming it is saved", () => {
    const first = render(<ProgramWorkspace {...props} />);
    rename("My pending training");
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    first.unmount();
    render(<ProgramWorkspace {...props} />);
    expect(screen.getByLabelText("Program name")).toHaveValue("My pending training");
    expect(screen.getByText("Unsaved changes")).toBeVisible();
  });
  it("serializes edits made during an in-flight save and only acknowledges the latest value", async () => {
    const resolvers: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(() => new Promise<Response>(resolve => resolvers.push(resolve)));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProgramWorkspace {...props} />);
    rename("First edit"); fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    rename("Newer edit");
    await act(async () => resolvers[0](response({ revision: 2 })));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Draft saved")).not.toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toMatchObject({ expectedRevision: 2, document: { name: "Newer edit" } });
    await act(async () => resolvers[1](response({ revision: 3 })));
    expect(screen.getByText("Draft saved")).toBeVisible();
  });
  it("retains failed saves and retries the same revision after a lost response", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(response({ revision: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProgramWorkspace {...props} />);
    rename("Saved through retry"); fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    expect(await screen.findByText("Save failed — changes retained")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    await waitFor(() => expect(screen.getByText("Draft saved")).toBeVisible());
    expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
  });
  it("makes a server revision conflict explicit and retries a copy with stable identity", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ error: "Revision changed" },409)).mockRejectedValueOnce(new Error("Copy response lost")).mockResolvedValue(response({ revision: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProgramWorkspace {...props} />);
    rename("Keep my edits"); fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    expect(await screen.findByText("Conflicting edits — changes retained")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
    expect(await screen.findByText("Copy response lost")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[1][0]).toBe(fetchMock.mock.calls[2][0]);
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[2][1].body);
  });
  it("retries a lost copy response with stable identity before saving newer edits to that copy", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("Copy response lost"))
      .mockResolvedValueOnce(response({ revision: 1 }))
      .mockResolvedValueOnce(response({ revision: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProgramWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
    expect(await screen.findByText("Copy response lost")).toBeVisible();
    rename("Newer edits after copy failure");
    fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe(fetchMock.mock.calls[1][0]);
    expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
    expect(fetchMock.mock.calls[2][0]).toBe(fetchMock.mock.calls[0][0]);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({
      expectedRevision: 1,
      document: { name: "Newer edits after copy failure copy" },
    });
    expect(router.push).toHaveBeenCalledWith(`/programs/editor/${fetchMock.mock.calls[2][0].split("/").at(-1)}`);
  });
  it("restores newer local edits against an acknowledged in-flight save revision", async () => {
    const resolvers: Array<(response: Response) => void> = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => resolvers.push(resolve))));
    const first = render(<ProgramWorkspace {...props} />);
    rename("Server accepted");
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    rename("Newer local pending");
    await act(async () => resolvers[0](response({ revision: 2 })));
    first.unmount();
    render(<ProgramWorkspace {...props} initialRevision={2} initialDocument={{ ...document, name: "Server accepted" }} />);
    expect(screen.getByLabelText("Program name")).toHaveValue("Newer local pending");
    expect(screen.queryByText("Conflicting edits — changes retained")).not.toBeInTheDocument();
  });
  it("renders an unfinished rule accepted by draft storage without crashing the editor", () => {
    const unfinished = makePreset("double", "2026-09-05");
    unfinished.weeks[0].days[0].exercises[0].rule = {} as never;
    expect(validateDraftStructure(unfinished)).toEqual([]);
    render(<ProgramWorkspace {...props} initialDocument={unfinished} />);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Progression & preview" }))).not.toThrow();
    expect(screen.getByRole("alert")).toHaveTextContent("This saved progression rule is incomplete");
    fireEvent.click(screen.getByRole("button", { name: "Reset this rule to manual" }));
    expect(screen.getByLabelText("Progression condition")).toHaveValue("manual");
    fireEvent.click(screen.getByRole("button", { name: "Structure" }));
    expect(screen.getByLabelText("Program name")).toHaveValue(unfinished.name);
  });
  it("bulk editing can be undone as one operation", () => {
    render(<ProgramWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Prescriptions" }));
    fireEvent.change(screen.getByLabelText("Bulk minimum reps"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply bulk edit" }));
    expect(screen.getByLabelText("Set 1 minimum reps")).toHaveValue(9);
    expect(screen.getByLabelText("Set 3 minimum reps")).toHaveValue(9);
    fireEvent.click(screen.getByRole("button", { name: "Undo last edit" }));
    expect(screen.getByLabelText("Set 1 minimum reps")).toHaveValue(8);
  });
  it("copies a whole block and restores it with one undo", () => {
    const blocks = makePreset("percentage", "2026-09-05");
    render(<ProgramWorkspace {...props} initialDocument={blocks} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy block" }));
    expect(screen.getByLabelText("Block name")).toHaveValue("Build copy");
    expect(screen.getByLabelText("Week").querySelectorAll("option")).toHaveLength(7);
    fireEvent.click(screen.getByRole("button", { name: "Undo last edit" }));
    expect(screen.getByLabelText("Week").querySelectorAll("option")).toHaveLength(4);
  });
  it("fills only selected weeks and exposes the local override", () => {
    const blocks = makePreset("percentage", "2026-09-05");
    render(<ProgramWorkspace {...props} initialDocument={blocks} />);
    fireEvent.click(screen.getByRole("button", { name: "Prescriptions" }));
    fireEvent.click(screen.getByLabelText("Select Week 2"));
    fireEvent.click(screen.getByRole("button", { name: "Fill selected weeks from this exercise" }));
    fireEvent.change(screen.getByLabelText("Week"), { target: { value: "1" } });
    expect(screen.getByLabelText("Set 1 minimum reps")).toHaveValue(8);
    expect(screen.getByText(/Set prescriptions match the first appearance/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Week"), { target: { value: "2" } });
    expect(screen.getByLabelText("Set 1 minimum reps")).toHaveValue(6);
    expect(screen.getByText(/Local set override/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo last edit" }));
    fireEvent.change(screen.getByLabelText("Week"), { target: { value: "1" } });
    expect(screen.getByLabelText("Set 1 minimum reps")).toHaveValue(7);
  });
  it("applies a bulk change only to selected weeks", () => {
    render(<ProgramWorkspace {...props} initialDocument={makePreset("percentage", "2026-09-05")} />);
    fireEvent.click(screen.getByRole("button", { name: "Prescriptions" }));
    fireEvent.change(screen.getByLabelText("Apply to"), { target: { value: "selected" } });
    expect(screen.getByRole("button", { name: "Apply bulk edit" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Select Week 2"));
    fireEvent.click(screen.getByLabelText("Select Week 3"));
    fireEvent.change(screen.getByLabelText("Bulk minimum reps"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply bulk edit" }));
    expect(screen.getByLabelText("Set 1 minimum reps")).toHaveValue(8);
    fireEvent.change(screen.getByLabelText("Week"), { target: { value: "1" } });
    expect(screen.getByLabelText("Set 1 minimum reps")).toHaveValue(9);
    fireEvent.change(screen.getByLabelText("Week"), { target: { value: "2" } });
    expect(screen.getByLabelText("Set 1 minimum reps")).toHaveValue(9);
    fireEvent.change(screen.getByLabelText("Week"), { target: { value: "3" } });
    expect(screen.getByLabelText("Set 1 minimum reps")).toHaveValue(5);
  });
  it("previews the configured rule using individual rep outcomes", () => {
    render(<ProgramWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Progression & preview" }));
    fireEvent.change(screen.getByLabelText("Set 3 reps"), { target: { value: "11" } });
    expect(screen.getByRole("status", { name: "Progression preview result" })).toHaveTextContent(/hold/i);
    fireEvent.change(screen.getByLabelText("Set 3 reps"), { target: { value: "12" } });
    expect(screen.getByRole("status", { name: "Progression preview result" })).toHaveTextContent("42.5");
  });
  it("keeps prescription set numbers in the preview when a warm-up precedes the top set", () => {
    const withWarmup = makePreset("top-backoff", "2026-09-05");
    withWarmup.weeks[0].days[0].exercises[0].sets.unshift({ ...createSet(), role: "warmup", loadMode: "fixed", load: 45 });
    render(<ProgramWorkspace {...props} initialDocument={withWarmup} />);
    fireEvent.click(screen.getByRole("button", { name: "Progression & preview" }));
    expect(screen.queryByLabelText("Set 1 reps")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Set 2 reps")).toHaveValue(8);
  });
});
