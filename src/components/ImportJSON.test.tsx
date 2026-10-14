// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportJSON } from "./ImportJSON";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { sessionStorage.clear(); router.push.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("Import JSON", () => {
  it("retains malformed pasted input and explains the failure without submitting", () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<ImportJSON userId={7} />);
    fireEvent.change(screen.getByLabelText("JSON content"), { target: { value: "{broken" } });
    fireEvent.click(screen.getByRole("button", { name: "Import as draft" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/valid JSON/i);
    expect(screen.getByLabelText("JSON content")).toHaveValue("{broken");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("retries a lost response with the same request and retained content after reload", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(response({ draftId: "6eac2292-b26e-43c5-86c6-45c38527223a", revision: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const first = render(<ImportJSON userId={7} />);
    fireEvent.change(screen.getByLabelText("JSON content"), { target: { value: '{"name":"My file"}' } });
    fireEvent.click(screen.getByRole("button", { name: "Import as draft" }));
    expect(await screen.findByRole("button", { name: "Retry import" })).toBeVisible();
    first.unmount(); render(<ImportJSON userId={7} />);
    expect(screen.getByLabelText("JSON content")).toHaveValue('{"name":"My file"}');
    expect(screen.getByLabelText("JSON content")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry import" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/programs/editor/6eac2292-b26e-43c5-86c6-45c38527223a"));
    expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
    expect(sessionStorage.getItem("magni:program-import:7")).toBeNull();
  });
  it.each([401, 403, 429])("keeps the original request after an uncertain save followed by %i", async status => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("Response lost"))
      .mockResolvedValueOnce(response({ error: "Try again later" }, status))
      .mockResolvedValueOnce(response({ draftId: "6eac2292-b26e-43c5-86c6-45c38527223a", revision: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportJSON userId={7} />);
    fireEvent.change(screen.getByLabelText("JSON content"), { target: { value: "{}" } });
    fireEvent.click(screen.getByRole("button", { name: "Import as draft" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry import" }));
    await screen.findByText("Try again later");
    fireEvent.click(screen.getByRole("button", { name: "Retry import" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    expect(new Set(fetchMock.mock.calls.map(call => call[1].body)).size).toBe(1);
  });
  it("shows useful server field errors and permits corrections after rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "Check the program", issues: [{ path: "program.weeks.0.days.1.exercises.0.name", message: "Enter a name." }] }, 400)));
    render(<ImportJSON userId={7} />);
    fireEvent.change(screen.getByLabelText("JSON content"), { target: { value: "{}" } });
    fireEvent.click(screen.getByRole("button", { name: "Import as draft" }));
    expect(await screen.findByText(/Week 1, day 2, exercise 1/)).toBeVisible();
    expect(screen.getByLabelText("JSON content")).not.toBeDisabled();
  });
});
