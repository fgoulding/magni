// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
});

describe("AuthForm", () => {
  it("keeps the login submit button enabled on initial render", () => {
    render(<AuthForm mode="login" />);

    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
  });

  it("keeps the register submit button enabled on initial render", () => {
    render(<AuthForm mode="register" />);

    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  });
});
