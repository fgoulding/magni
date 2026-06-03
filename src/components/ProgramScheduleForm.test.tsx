// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProgramScheduleForm } from "./ProgramScheduleForm";

const routerMock = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

const fetchMock = vi.fn();

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
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

describe("ProgramScheduleForm", () => {
  it("renders seven weekday toggle buttons", () => {
    render(<ProgramScheduleForm programId={123} initialScheduleWeekdays={[]} />);

    for (const label of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("saves selected weekdays in sorted order", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(mockJsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProgramScheduleForm programId={123} initialScheduleWeekdays={[]} />);

    await user.click(screen.getByRole("button", { name: "Thu" }));
    await user.click(screen.getByRole("button", { name: "Sun" }));
    await user.click(screen.getByRole("button", { name: "Tue" }));
    await user.click(screen.getByRole("button", { name: "Save schedule" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/programs/123",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleWeekdays: [0, 2, 4] }),
      }),
    );
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it("clears all weekdays", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(mockJsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProgramScheduleForm programId={123} initialScheduleWeekdays={[1, 3]} />);

    await user.click(screen.getByRole("button", { name: "Mon" }));
    await user.click(screen.getByRole("button", { name: "Wed" }));
    await user.click(screen.getByRole("button", { name: "Save schedule" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/programs/123",
      expect.objectContaining({
        body: JSON.stringify({ scheduleWeekdays: [] }),
      }),
    );
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it("shows API errors", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(mockJsonResponse({ error: "scheduleWeekdays must contain unique weekdays from 0 to 6" }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProgramScheduleForm programId={123} initialScheduleWeekdays={[]} />);

    await user.click(screen.getByRole("button", { name: "Save schedule" }));

    expect(await screen.findByText("scheduleWeekdays must contain unique weekdays from 0 to 6")).toBeInTheDocument();
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });

  it("warns when scheduled weekdays exceed definition days", async () => {
    const user = userEvent.setup();

    render(<ProgramScheduleForm programId={123} initialScheduleWeekdays={[1, 3]} dayCount={2} />);

    expect(screen.queryByText(/compressed into less than one week/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Fri" }));

    expect(screen.getByText(/compressed into less than one week/i)).toBeInTheDocument();
  });
});
