// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AddSessionExerciseForm } from "./AddSessionExerciseForm";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("labels the current weight unit persistently and submits a decimal without rounding", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sets: [] }), { status: 201 })); vi.stubGlobal("fetch", fetchMock);
  const onAdded = vi.fn();
  render(<AddSessionExerciseForm sessionId={42} unit="kg" onAdded={onAdded} onError={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Add exercise" }));
  fireEvent.change(screen.getByLabelText("New exercise name"), { target: { value: "Accessory row" } });
  fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "225.25" } });
  expect(screen.getByText("Weight (kg)")).toBeVisible();
  expect(screen.getByLabelText("Weight")).toBeValid();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add to workout" })));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: "Accessory row", sets: 3, reps: 10, weight: 225.25 });
  expect(onAdded).toHaveBeenCalledWith([]);
});
