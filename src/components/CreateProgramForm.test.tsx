// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateProgramForm } from "@/components/CreateProgramForm";
import { getProgramDefault, listProgramDefaults } from "@/features/program-defaults/defaults";

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
  routerMock.push.mockClear();
  routerMock.refresh.mockClear();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function mockJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return {
    ok: init.status === undefined || (init.status >= 200 && init.status < 300),
    status: init.status ?? 200,
    json: async () => body,
  } as Response;
}

describe("CreateProgramForm", () => {
  function liftCount(snapshot: { days: readonly { exercises: readonly unknown[] }[] }): number {
    return snapshot.days.reduce((total, day) => total + day.exercises.length, 0);
  }

  it("renders source buttons instead of a plain select", () => {
    render(<CreateProgramForm programDefaults={listProgramDefaults()} />);

    expect(screen.queryByLabelText("Start from")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Blank Custom" })).toHaveAttribute("aria-pressed", "true");
    for (const label of [
      "Basic Strength 3-Day",
      "SBS Hypertrophy 4-Day",
      "Starting Strength 3-Day",
      "StrongLifts 5x5",
      "PHUL 4-Day",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("preloads the selected default and creates a program with its snapshot", async () => {
    const user = userEvent.setup();
    const defaultProgram = getProgramDefault("basic-strength-3-day");
    expect(defaultProgram).toBeDefined();
    fetchMock.mockResolvedValue(mockJsonResponse({ id: 42 }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<CreateProgramForm programDefaults={listProgramDefaults()} />);

    await user.click(screen.getByRole("button", { name: "Basic Strength 3-Day" }));

    expect(screen.getByLabelText("Program name")).toHaveValue(defaultProgram!.snapshot.name);
    expect(screen.getByLabelText("Weeks")).toHaveValue(defaultProgram!.snapshot.numWeeks);
    expect(screen.getByText(`${defaultProgram!.snapshot.numWeeks} weeks`)).toBeInTheDocument();
    expect(screen.getByText(`${defaultProgram!.snapshot.days.length} days`)).toBeInTheDocument();
    expect(screen.getByText(`${liftCount(defaultProgram!.snapshot)} lifts`)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create program" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/programs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: defaultProgram!.snapshot.name,
          numWeeks: defaultProgram!.snapshot.numWeeks,
          snapshot: defaultProgram!.snapshot,
        }),
      }),
    );
    expect(routerMock.push).toHaveBeenCalledWith("/programs/42");
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it("can publish a loaded shared definition by posting only its snapshot to a supplied endpoint", async () => {
    const user = userEvent.setup();
    const loadedSnapshot = getProgramDefault("sbs-hypertrophy-4-day")?.snapshot;
    expect(loadedSnapshot).toBeDefined();
    fetchMock.mockResolvedValue(mockJsonResponse({ versionId: 7 }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CreateProgramForm
        programDefaults={listProgramDefaults()}
        initialSnapshot={loadedSnapshot}
        initialSnapshotLabel="Shared v2"
        submitEndpoint="/api/shared-programs/9/versions"
        submitMode="snapshot-only"
      />,
    );

    expect(screen.getByRole("button", { name: "Shared v2" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Program name")).toHaveValue(loadedSnapshot!.name);
    expect(screen.getByText(`${loadedSnapshot!.numWeeks} weeks`)).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Program name"));
    await user.type(screen.getByLabelText("Program name"), "Shared v3");
    await user.click(screen.getByRole("button", { name: "Publish update" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/shared-programs/9/versions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          snapshot: { ...loadedSnapshot!, name: "Shared v3" },
        }),
      }),
    );
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it("can save a loaded shared definition as a new private program", async () => {
    const user = userEvent.setup();
    const loadedSnapshot = getProgramDefault("basic-strength-3-day")?.snapshot;
    expect(loadedSnapshot).toBeDefined();
    fetchMock.mockResolvedValue(mockJsonResponse({ id: 77 }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<CreateProgramForm initialSnapshot={loadedSnapshot} initialSnapshotLabel="Shared v1" />);

    await user.click(screen.getByRole("button", { name: "Create program" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/programs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: loadedSnapshot!.name,
          numWeeks: loadedSnapshot!.numWeeks,
          snapshot: loadedSnapshot,
        }),
      }),
    );
    expect(routerMock.push).toHaveBeenCalledWith("/programs/77");
  });

  it("shows expected max inputs for each exercise when a default is selected", async () => {
    const user = userEvent.setup();
    const defaultProgram = getProgramDefault("basic-strength-3-day");
    expect(defaultProgram).toBeDefined();

    render(<CreateProgramForm programDefaults={listProgramDefaults()} />);

    await user.click(screen.getByRole("button", { name: "Basic Strength 3-Day" }));

    for (const day of defaultProgram!.snapshot.days) {
      expect(screen.getByText(day.name)).toBeInTheDocument();
      for (const exercise of day.exercises) {
        expect(screen.getByLabelText(exercise.name)).toBeInTheDocument();
      }
    }
  });

  it("sends expectedMaxes for filled exercises and omits unfilled ones", async () => {
    const user = userEvent.setup();
    const defaultProgram = getProgramDefault("sbs-hypertrophy-4-day");
    expect(defaultProgram).toBeDefined();
    fetchMock.mockResolvedValue(mockJsonResponse({ id: 99 }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<CreateProgramForm programDefaults={listProgramDefaults()} />);

    await user.click(screen.getByRole("button", { name: "SBS Hypertrophy 4-Day" }));

    const firstExercise = defaultProgram!.snapshot.days[0].exercises[0];
    await user.type(screen.getByLabelText(firstExercise.name), "315");

    await user.click(screen.getByRole("button", { name: "Create program" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const calls = fetchMock.mock.calls[0] as [string, { body: string }];
    const parsedBody = JSON.parse(calls[1].body);
    expect(parsedBody.expectedMaxes).toEqual({
      [firstExercise.key]: 315,
    });
  });
});
