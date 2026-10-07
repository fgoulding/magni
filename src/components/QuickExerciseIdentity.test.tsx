// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QuickExercisePicker } from "./QuickExercisePicker";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

it("reuses the selected exercise identity, including an uncertain addition retry", async () => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
  const fetcher = vi.fn()
    .mockResolvedValueOnce(response([{ name: "Row", catalogExerciseId: "known-row", sessionId: 1, date: "2026-09-01", sets: [{ reps: 8, weight: 40 }] }]))
    .mockResolvedValueOnce(response({ error: "Response lost" }, 503))
    .mockResolvedValueOnce(response({ sets: [], sessionRevision: 2 }));
  vi.stubGlobal("fetch", fetcher);
  const onAdded = vi.fn();
  render(<QuickExercisePicker sessionId={22} unit="kg" disabled={false} onAdded={onAdded} onError={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Add exercise" }));
  fireEvent.click(await screen.findByRole("button", { name: /Row.*1 sets/ }));
  const retry = await screen.findByRole("button", { name: "Retry adding exercise" });
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ name: "Row", catalogExerciseId: "known-row", prescription: [{ reps: 8, weight: 40 }] });
  fireEvent.click(retry);
  await waitFor(() => expect(onAdded).toHaveBeenCalledOnce());
  expect(fetcher.mock.calls[2][1].body).toBe(fetcher.mock.calls[1][1].body);
});
