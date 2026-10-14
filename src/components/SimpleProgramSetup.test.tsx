// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import bundled from "../../program-templates/full-body-supersets-3-day.json";
import type { ProgramTemplate } from "@/features/program-templates/template";
import { SimpleProgramSetup } from "./SimpleProgramSetup";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const template = bundled as ProgramTemplate;
const fetchMock = vi.fn();
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
afterEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
function setup() { vi.stubGlobal("fetch", fetchMock); render(<SimpleProgramSetup template={template} startDate="2026-10-13" />); return userEvent.setup(); }

describe("SimpleProgramSetup", () => {
  it("does not describe differing daily prescriptions as shared superset rounds", () => {
    const changed = structuredClone(template);
    changed.days[1].exercises[0].sets = 4;
    render(<SimpleProgramSetup template={changed} startDate="2026-10-13" />);
    expect(screen.queryByText(/A\/B: 5 rounds/)).not.toBeInTheDocument();
    expect(screen.queryByText(/supersets a day/)).not.toBeInTheDocument();
  });
  it("keeps ungrouped exercise days free of superset summaries", () => {
    const changed = structuredClone(template);
    for (const day of changed.days) day.exercises = day.exercises.slice(0, 2).map(exercise => ({ ...exercise, supersetGroup: "", sets: 3 }));
    render(<SimpleProgramSetup template={changed} startDate="2026-10-13" />);
    expect(screen.queryByText(/supersets a day/)).not.toBeInTheDocument();
    expect(screen.queryByText(": 3 rounds")).not.toBeInTheDocument();
  });
  it("creates the rich scheduled program in one action with independent appearance weights", async () => {
    const user = setup();
    fetchMock.mockResolvedValueOnce(response({ revision: 1 })).mockResolvedValueOnce(response({ programId: 42 }));
    expect(screen.getByText("12 workouts · first workout Wed, Oct 14")).toBeInTheDocument();
    expect(screen.getByLabelText("Weeks")).toHaveValue(4);
    await user.click(screen.getByText("Starting weights (optional)"));
    await user.click(screen.getByText(template.days[0].name, { selector: "summary" }));
    await user.type(screen.getByLabelText(`${template.days[0].name}: One-arm dumbbell row (lb)`), "42.5");
    await user.click(screen.getByText(template.days[1].name, { selector: "summary" }));
    await user.type(screen.getByLabelText(`${template.days[1].name}: One-arm dumbbell row (lb)`), "35");
    await user.click(screen.getByRole("button", { name: "Create program" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/programs/42"));
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^\/api\/program-drafts\/[\da-f-]{36}$/);
    const { document, expectedRevision } = JSON.parse(options.body);
    expect(expectedRevision).toBe(0);
    expect(document).toMatchObject({ cycles: 4, weekdays: [1, 3, 5], startDate: "2026-10-13" });
    expect(document.weeks[0].days[0].exercises[1].baseLoad).toBe(42.5);
    expect(document.weeks[0].days[1].exercises[4].baseLoad).toBe(35);
    expect(document.weeks[0].days[2].exercises[4].baseLoad).toBe(0);
    expect(document.weeks[0].days.map((day: { exercises: { sets: unknown[] }[] }) => day.exercises.reduce((n, exercise) => n + exercise.sets.length, 0))).toEqual([26, 26, 26]);
    expect(document.weeks[0].days[0].exercises[3].sets[0]).toMatchObject({ repMin: 6, repMax: 8, tempo: "1-second hover pause" });
    expect(document.weeks[0].days[0].exercises[4].sets[0].loadMode).toBe("bodyweight");
    expect(fetchMock.mock.calls[1][0]).toBe(`${url}/activate`);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ expectedRevision: 1 });
  });

  it("requires exactly three weekdays and focuses a retained schedule error", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Monday" }));
    await user.click(screen.getByRole("button", { name: "Create program" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose exactly 3 training days");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
    expect(screen.getByLabelText("Program name")).toHaveValue(template.title);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recovers a committed save whose response was lost without saving or activating a second document", async () => {
    const user = setup();
    let saved: unknown;
    fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => {
      if (options?.method === "PUT") { saved = JSON.parse(options.body as string).document; throw new TypeError("Connection lost"); }
      if (options?.method === "POST") return response({ programId: 71 });
      return response({ revision: 1, document: saved, activatedProgramId: null });
    });
    await user.click(screen.getByRole("button", { name: "Create program" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/programs/71"));
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "PUT")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });

  it("keeps the same draft and revision after an unknown activation result and double click", async () => {
    const user = setup();
    let saved: unknown; let activationCalls = 0; let rejectActivation: (reason: Error) => void = () => {};
    fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => {
      if (options?.method === "PUT") { saved = JSON.parse(options.body as string).document; return response({ revision: 1 }); }
      if (options?.method === "POST") { if (++activationCalls === 1) return new Promise((_resolve, reject) => { rejectActivation = reject; }); return response({ programId: 83 }); }
      throw new TypeError("Still offline");
    });
    await user.dblClick(screen.getByRole("button", { name: "Create program" }));
    rejectActivation(new TypeError("Connection lost"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Retry"));
    expect(screen.getByLabelText("Program name")).toHaveValue(template.title);
    expect(screen.getByLabelText("Program name")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Retry creation" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/programs/83"));
    const saves = fetchMock.mock.calls.filter(([, options]) => options?.method === "PUT");
    const activations = fetchMock.mock.calls.filter(([, options]) => options?.method === "POST");
    expect(saves).toHaveLength(1);
    expect(activations).toHaveLength(2);
    expect(activations[0]).toEqual(activations[1]);
    expect(saved).toBeDefined();
  });

  it("preserves schedule and weights when opening advanced editing without activation", async () => {
    const user = setup();
    fetchMock.mockResolvedValue(response({ revision: 1 }));
    fireEvent.change(screen.getByLabelText("Weeks"), { target: { value: "6" } });
    await user.click(screen.getByText("Starting weights (optional)"));
    await user.click(screen.getByText(template.days[0].name, { selector: "summary" }));
    fireEvent.change(screen.getByLabelText(`${template.days[0].name}: Barbell back squat (lb)`), { target: { value: "135" } });
    await user.click(screen.getByRole("button", { name: "Customize in workspace" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/programs\/editor\/[\da-f-]{36}$/)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const document = JSON.parse(fetchMock.mock.calls[0][1].body).document;
    expect(document.cycles).toBe(6);
    expect(document.weeks[0].days[0].exercises[0].baseLoad).toBe(135);
  });

  it("opens the day containing an invalid weight and keeps entered values", async () => {
    const user = setup();
    const optional = screen.getByText("Starting weights (optional)").closest("details")!;
    const day = within(optional).getByText(template.days[0].name, { selector: "summary" }).closest("details")!;
    fireEvent.change(screen.getByLabelText(`${template.days[0].name}: Barbell back squat (lb)`), { target: { value: "-5" } });
    await user.click(screen.getByRole("button", { name: "Create program" }));
    await waitFor(() => expect(optional).toHaveAttribute("open")); expect(day).toHaveAttribute("open");
    expect(screen.getByLabelText(`${template.days[0].name}: Barbell back squat (lb)`)).toHaveFocus();
    expect(screen.getByLabelText(`${template.days[0].name}: Barbell back squat (lb)`)).toHaveValue(-5);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("restores an interrupted attempt after reload for the same account and retries the original identity", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const mounted = render(<SimpleProgramSetup template={template} startDate="2026-10-13" userId={7} />);
    fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => {
      if (options?.method === "PUT") return response({ revision: 1 });
      throw new TypeError("Offline");
    });
    fireEvent.change(screen.getByLabelText("Program name"), { target: { value: "My saved setup" } });
    await user.click(screen.getByRole("button", { name: "Create program" }));
    await screen.findByRole("alert");
    const originalActivation = fetchMock.mock.calls.find(([, options]) => options?.method === "POST");
    mounted.unmount();
    const storedKey = Object.keys(sessionStorage).find(key => key.startsWith("magni.program-setup.v1."))!;
    const cached = JSON.parse(sessionStorage.getItem(storedKey)!);
    cached.fields.name = "Outdated local form"; cached.fields.days = []; cached.fields.weeks = "999";
    sessionStorage.setItem(storedKey, JSON.stringify(cached));
    fetchMock.mockResolvedValue(response({ programId: 92 }));
    render(<SimpleProgramSetup template={template} startDate="2026-10-14" userId={7} />);
    await waitFor(() => expect(screen.getByLabelText("Program name")).toHaveValue("My saved setup"));
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-10-13");
    await user.click(screen.getByRole("button", { name: "Retry creation" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/programs/92"));
    expect(fetchMock.mock.calls.at(-1)).toEqual(originalActivation);
    expect(sessionStorage.length).toBe(0);
  });

  it("does not expose another account's pending setup", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockRejectedValue(new TypeError("Offline"));
    const user = userEvent.setup();
    const mounted = render(<SimpleProgramSetup template={template} startDate="2026-10-13" userId={7} />);
    fireEvent.change(screen.getByLabelText("Program name"), { target: { value: "Private setup" } });
    await user.click(screen.getByRole("button", { name: "Create program" }));
    await screen.findByRole("alert");
    mounted.unmount();
    render(<SimpleProgramSetup template={template} startDate="2026-10-13" userId={8} />);
    expect(screen.getByLabelText("Program name")).toHaveValue(template.title);
    expect(screen.getByRole("button", { name: "Create program" })).toBeInTheDocument();
  });

  it("unlocks retained fields only after confirming an interrupted draft was deleted", async () => {
    const user = setup();
    fetchMock.mockResolvedValueOnce(response({ revision: 1 }))
      .mockRejectedValueOnce(new TypeError("Offline"))
      .mockRejectedValueOnce(new TypeError("Offline"));
    await user.click(screen.getByRole("button", { name: "Create program" }));
    await screen.findByRole("alert");
    fetchMock.mockResolvedValueOnce(response({ error: "Draft not found" }, 404))
      .mockResolvedValueOnce(response({ error: "Draft not found" }, 404))
      .mockResolvedValueOnce(response({ error: "This draft was deleted." }, 410));
    await user.click(screen.getByRole("button", { name: "Retry creation" }));
    await waitFor(() => expect(screen.getByLabelText("Program name")).not.toBeDisabled());
    expect(screen.getByLabelText("Program name")).toHaveValue(template.title);
    expect(screen.getByRole("alert")).toHaveTextContent("draft was deleted");
    expect(screen.getByRole("button", { name: "Create program" })).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });
});
