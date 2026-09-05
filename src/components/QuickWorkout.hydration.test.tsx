// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuickWorkout } from "./QuickWorkout";

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([false, true])("gates startup until hydration, restores drafts (%s), then submits the entered metadata", async (savedDraft) => {
  if (savedDraft) localStorage.setItem("magni.quick.start.2026-09-01", JSON.stringify({ name: "Restored rows", date: "2026-08-31", unit: "kg" }));
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 88, name: "September pull", date: "2026-09-02", unit: "kg", sets: [] }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  const element = <QuickWorkout initialSession={null} initialDate="2026-09-01" />;
  container.innerHTML = renderToString(element);
  document.body.appendChild(container);
  const card = within(container);
  let root: Root | undefined;
  try {
    expect(card.getByLabelText("Workout name")).toBeDisabled();
    expect(card.getByLabelText("Workout date")).toBeDisabled();
    expect(card.getByLabelText("Workout units")).toBeDisabled();
    expect(card.getByRole("button", { name: "Quick workout" })).toBeDisabled();
    await act(async () => { root = hydrateRoot(container, element); });
    await waitFor(() => expect(card.getByLabelText("Workout name")).toBeEnabled());
    expect(card.getByLabelText("Workout name")).toHaveValue(savedDraft ? "Restored rows" : "Quick Workout");
    expect(card.getByLabelText("Workout date")).toHaveValue(savedDraft ? "2026-08-31" : "2026-09-01");
    expect(card.getByLabelText("Workout units")).toHaveValue(savedDraft ? "kg" : "lb");
    fireEvent.change(card.getByLabelText("Workout name"), { target: { value: "September pull" } });
    fireEvent.change(card.getByLabelText("Workout date"), { target: { value: "2026-09-02" } });
    fireEvent.change(card.getByLabelText("Workout units"), { target: { value: "kg" } });
    fireEvent.click(card.getByRole("button", { name: "Quick workout" }));
    await card.findByRole("heading", { name: "September pull" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ name: "September pull", date: "2026-09-02", unit: "kg", newWorkout: true });
  } finally {
    await act(async () => root?.unmount());
    container.remove();
  }
});
