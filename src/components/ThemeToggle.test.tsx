// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "./ThemeToggle";

let media: EventTarget & { matches: boolean };

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", vi.fn(() => media));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});

describe("ThemeToggle", () => {
  it("hydrates the saved preference without mismatching the server markup", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<ThemeToggle />);
    document.body.appendChild(container);
    localStorage.setItem("theme", "dark");
    const onRecoverableError = vi.fn();
    let root: Root;

    await act(async () => {
      root = hydrateRoot(container, <ThemeToggle />, { onRecoverableError });
    });

    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    expect(onRecoverableError).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    container.remove();
  });

  it("tracks saved preference changes from another tab", () => {
    render(<ThemeToggle />);
    act(() => {
      localStorage.setItem("theme", "dark");
      window.dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: "dark" }));
    });

    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("persists choices and only follows live OS changes in System mode", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole("button", { name: "Dark" }));
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    act(() => media.dispatchEvent(new Event("change")));
    expect(document.documentElement.dataset.theme).toBe("dark");

    await user.click(screen.getByRole("button", { name: "System" }));
    expect(localStorage.getItem("theme")).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");
    act(() => {
      media.matches = true;
      media.dispatchEvent(new Event("change"));
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
