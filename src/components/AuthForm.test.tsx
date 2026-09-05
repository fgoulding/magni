// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthForm } from "@/components/AuthForm";

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

afterEach(() => {
  cleanup();
  routerMock.push.mockClear();
  routerMock.refresh.mockClear();
  vi.unstubAllGlobals();
});

describe("AuthForm", () => {
  it.each(["login", "register"] as const)("keeps server-rendered %s controls disabled until hydration, then submits typed values", async (mode) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const container = document.createElement("div");
    container.innerHTML = renderToString(<AuthForm mode={mode} />);
    document.body.appendChild(container);
    const form = within(container);
    const buttonName = mode === "login" ? "Log in" : "Create account";
    let root: Root | undefined;
    try {
      expect(form.getByLabelText("Email")).toBeDisabled();
      expect(form.getByLabelText("Password")).toBeDisabled();
      expect(form.getByRole("button", { name: buttonName })).toBeDisabled();
      await act(async () => { root = hydrateRoot(container, <AuthForm mode={mode} />); });
      await waitFor(() => expect(form.getByLabelText("Email")).toBeEnabled());
      expect(form.getByLabelText("Password")).toBeEnabled();
      expect(form.getByRole("button", { name: buttonName })).toBeEnabled();
      fireEvent.change(form.getByLabelText("Email"), { target: { value: "hydrated@example.test" } });
      fireEvent.change(form.getByLabelText("Password"), { target: { value: "password123" } });
      fireEvent.click(form.getByRole("button", { name: buttonName }));
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      expect(fetch.mock.calls[0][0]).toBe(`/api/auth/${mode}`);
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ email: "hydrated@example.test", password: "password123" });
      await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/today"));
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });
  it("keeps the login submit button enabled on initial render", () => {
    render(<AuthForm mode="login" />);

    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
  });

  it("keeps the register submit button enabled on initial render", () => {
    render(<AuthForm mode="register" />);

    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  });
});
