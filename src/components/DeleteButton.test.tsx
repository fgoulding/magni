// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteButton } from "./DeleteButton";

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

const fetchMock = vi.fn();

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  routerMock.push.mockClear();
  routerMock.refresh.mockClear();
  vi.unstubAllGlobals();
});

function mockJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return {
    ok: init.status === undefined || (init.status >= 200 && init.status < 300),
    status: init.status ?? 200,
    json: async () => body,
  } as Response;
}

describe("DeleteButton", () => {
  it("navigates after confirming a delete with a redirect target", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(mockJsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    render(<DeleteButton endpoint="/api/programs/1" label="program" redirectHref="/programs" />);

    await user.click(screen.getByRole("button", { name: "Delete program" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/programs/1", { method: "DELETE" }));
    expect(routerMock.push).toHaveBeenCalledWith("/programs");
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it("shows an error and re-enables confirm when delete fails", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(mockJsonResponse({ error: "Failed to delete program" }, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<DeleteButton endpoint="/api/programs/1" label="program" />);

    await user.click(screen.getByRole("button", { name: "Delete program" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText("Failed to delete program")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });
});
