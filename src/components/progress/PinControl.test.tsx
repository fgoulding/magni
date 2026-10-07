// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PinControl } from "./PinControl";
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const pins = [1, 2, 3, 4].map(id => ({ id: String(id), name: `Pin ${id}` }));
describe("Progress pins", () => {
  it("requires an explicit replacement at four pins and preserves the selected target in the mutation", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pinned: [...pins.slice(1), { id: "5", name: "New pin" }] }) });
    vi.stubGlobal("fetch", request);
    render(<PinControl exerciseId="5" name="New pin" pinned={false} pins={pins} />);
    fireEvent.click(screen.getByRole("button", { name: "Pin exercise" }));
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Replace selected pin" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Pin 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace selected pin" }));
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ exerciseId: "5", pinned: true, replaceExerciseId: "1" });
    expect(await screen.findByRole("button", { name: "Unpin exercise" })).toBeVisible();
  });
  it("keeps an existing pin and gives a retryable error after a rejected mutation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Please retry." }) }));
    render(<PinControl exerciseId="1" name="Pin 1" pinned pins={pins} />);
    fireEvent.click(screen.getByRole("button", { name: "Unpin exercise" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please retry.");
    expect(screen.getByRole("button", { name: "Unpin exercise" })).toBeEnabled();
  });
});
