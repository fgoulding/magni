// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkoutCard } from "@/components/WorkoutCard";

const routerMock = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  routerMock.refresh.mockClear();
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

// The card fetches /sessions/current on mount to resume an in-progress workout.
// Route that to "no session" so it doesn't consume each test's mocked sequence;
// the inner mock still records the real calls the assertions check.
function stubFetch(inner: ReturnType<typeof vi.fn>) {
  const call = inner as unknown as (url: string, init?: RequestInit) => Promise<Response>;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) =>
      typeof url === "string" && url.includes("/sessions/current")
        ? Promise.resolve(jsonResponse(null))
        : call(url, init),
    ),
  );
}

function makeCardProps(overrides?: Partial<Parameters<typeof WorkoutCard>[0]>) {
  return {
    programId: 1,
    dayId: 2,
    programName: "Starting Strength",
    dayName: "Workout A",
    currentWeek: 1,
    currentDay: 1,
    ...overrides,
  };
}

describe("WorkoutCard", () => {
  it("shows Start and Skip buttons before a session", () => {
    render(<WorkoutCard {...makeCardProps()} />);

    expect(screen.getByRole("button", { name: "Start Workout" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    expect(screen.getByText(/Week 1/)).toBeInTheDocument();
    expect(screen.getByText(/Day 1/)).toBeInTheDocument();
  });

  it("starts a session and shows the first lift", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          id: 42,
          sets: [
            {
              id: 7,
              exercise_name: "Squat",
              reps: 5,
              sets: 1,
              set_number: 1,
              rep_out_target: 5,
              calculated_weight: 225,
              actual_reps: null,
              actual_weight: null,
            },
            {
              id: 8,
              exercise_name: "Bench Press",
              reps: 5,
              sets: 1,
              set_number: 1,
              rep_out_target: 5,
              calculated_weight: 185,
              actual_reps: null,
              actual_weight: null,
            },
          ],
        }),
    );
    stubFetch(fetchMock);

    render(<WorkoutCard {...makeCardProps()} />);
    await user.click(screen.getByRole("button", { name: "Start Workout" }));

    expect(await screen.findByText("Squat")).toBeInTheDocument();
    // Flat single lift shows a weight hero + scheme.
    expect(screen.getByText("225")).toBeInTheDocument();
    expect(screen.getByText("1 × 5")).toBeInTheDocument();
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
  });

  it("shows a clean error (not a JSON parse error) when start returns a non-JSON body", async () => {
    const user = userEvent.setup();
    // A 500 with an HTML/empty body: response.json() would throw a SyntaxError.
    const fetchMock = vi.fn().mockResolvedValue(new Response("Internal Server Error", { status: 500 }));
    stubFetch(fetchMock);

    render(<WorkoutCard {...makeCardProps()} />);
    await user.click(screen.getByRole("button", { name: "Start Workout" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not start workout");
    expect(alert).not.toHaveTextContent(/Unexpected token|not valid JSON|JSON\.parse/i);
  });

  it("logs a set and advances to the next lift", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 42,
          sets: [
            { id: 7, exercise_name: "Squat", reps: 5, sets: 1, set_number: 1, rep_out_target: 5, calculated_weight: 225, actual_reps: null, actual_weight: null },
            { id: 8, exercise_name: "Bench Press", reps: 5, sets: 1, set_number: 1, rep_out_target: 5, calculated_weight: 185, actual_reps: null, actual_weight: null },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    stubFetch(fetchMock);

    render(<WorkoutCard {...makeCardProps()} />);
    await user.click(screen.getByRole("button", { name: "Start Workout" }));
    await screen.findByText("Squat");

    await user.click(screen.getByRole("button", { name: "Log & Next" }));

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/sessions/42/sets",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ setId: 7, actualReps: 5, actualWeight: 225 }),
      }),
    );
  });

  it("completes workout and shows summary", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 42,
          sets: [
            { id: 7, exercise_name: "Squat", reps: 5, sets: 1, set_number: 1, rep_out_target: 5, calculated_weight: 225, actual_reps: null, actual_weight: null },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    stubFetch(fetchMock);

    render(<WorkoutCard {...makeCardProps()} />);
    await user.click(screen.getByRole("button", { name: "Start Workout" }));
    await screen.findByText("Squat");

    await user.click(screen.getByRole("button", { name: "Log Set" }));
    await user.click(screen.getByRole("button", { name: "Finish Workout" }));

    expect(await screen.findByText("Workout complete")).toBeInTheDocument();
    expect(screen.getByText("Squat")).toBeInTheDocument();
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });

  it("summarizes completed workout reps per set with entered reps only on the final set", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 42,
          sets: [
            { id: 7, exercise_name: "Squat", reps: 5, sets: 1, set_number: 1, rep_out_target: 5, calculated_weight: 225, actual_reps: null, actual_weight: null },
            { id: 8, exercise_name: "Squat", reps: 5, sets: 1, set_number: 2, rep_out_target: 5, calculated_weight: 225, actual_reps: null, actual_weight: null },
            { id: 9, exercise_name: "Squat", reps: 5, sets: 1, set_number: 3, rep_out_target: 5, calculated_weight: 225, actual_reps: null, actual_weight: null },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    stubFetch(fetchMock);

    render(<WorkoutCard {...makeCardProps()} />);
    await user.click(screen.getByRole("button", { name: "Start Workout" }));
    await screen.findByText("Squat");

    const repsInput = screen.getByRole("spinbutton", { name: "Reps" });
    await user.clear(repsInput);
    await user.type(repsInput, "10");
    await user.click(screen.getByRole("button", { name: "Log Set" }));
    await user.click(screen.getByRole("button", { name: "Finish Workout" }));

    expect(await screen.findByText("Workout complete")).toBeInTheDocument();
    expect(screen.getAllByText("Squat")).toHaveLength(1);
    expect(screen.getByText("20 reps @ 225 lb")).toBeInTheDocument();
    expect(screen.getByText("4,500 lb total")).toBeInTheDocument();
  });

  it("handles set save failure", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 42,
          sets: [
            { id: 7, exercise_name: "Squat", reps: 5, sets: 1, set_number: 1, rep_out_target: 5, calculated_weight: 225, actual_reps: null, actual_weight: null },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: "Network error" }, { status: 503 }));
    stubFetch(fetchMock);

    render(<WorkoutCard {...makeCardProps()} />);
    await user.click(screen.getByRole("button", { name: "Start Workout" }));
    await screen.findByText("Squat");

    await user.click(screen.getByRole("button", { name: "Log Set" }));

    expect(await screen.findByText("Network error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log Set" })).toBeInTheDocument();
  });

  it("resumes an in-progress workout, restoring logged sets, and re-opens one to edit", async () => {
    const user = userEvent.setup();
    const session = {
      id: 42,
      sets: [
        { id: 7, exercise_name: "Squat", reps: 5, sets: 1, set_number: 1, rep_out_target: 5, calculated_weight: 225, actual_reps: 5, actual_weight: 225 },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        typeof url === "string" && url.includes("/sessions/current")
          ? Promise.resolve(jsonResponse(session))
          : Promise.resolve(jsonResponse({ success: true })),
      ),
    );

    render(<WorkoutCard {...makeCardProps()} />);

    // Resumed straight into the workout (no Start), with the set shown as logged.
    expect(await screen.findByText("Squat")).toBeInTheDocument();
    expect(screen.getByText("Logged")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Workout" })).not.toBeInTheDocument();

    // Editing re-enables the reps input (pre-filled with the logged value).
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("spinbutton", { name: "Reps" })).toBeInTheDocument();
  });

  it("skips a workout", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ success: true }));
    stubFetch(fetchMock);

    render(<WorkoutCard {...makeCardProps()} />);
    await user.click(screen.getByRole("button", { name: "Skip" }));

    expect(await screen.findByText("Workout skipped")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/programs/1/skip-workout",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ dayId: 2 }),
      }),
    );
  });

  it("hot-adds an exercise to the active session", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 42,
          sets: [
            { id: 7, exercise_name: "Squat", reps: 5, sets: 1, set_number: 1, rep_out_target: 5, calculated_weight: 225, actual_reps: null, actual_weight: null },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            sets: [
              { id: 99, exercise_name: "Cable Fly", reps: 12, sets: 1, set_number: 1, rep_out_target: 12, calculated_weight: 40, actual_reps: null, actual_weight: null },
            ],
          },
          { status: 201 },
        ),
      );
    stubFetch(fetchMock);

    render(<WorkoutCard {...makeCardProps()} />);
    await user.click(screen.getByRole("button", { name: "Start Workout" }));
    await screen.findByText("Squat");

    await user.click(screen.getByRole("button", { name: "Add exercise" }));
    await user.type(screen.getByLabelText("New exercise name"), "Cable Fly");
    await user.click(screen.getByRole("button", { name: "Add to workout" }));

    expect(await screen.findByText("Cable Fly")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/sessions/42/sets",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
