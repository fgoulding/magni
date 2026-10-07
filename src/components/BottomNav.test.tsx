import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomNav } from "./BottomNav";

const navigation = vi.hoisted(() => ({ pathname: "/programs" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
afterEach(cleanup);

describe("BottomNav", () => {
  it("puts Today before Programs while keeping Programs active on the programs route", () => {
    render(<BottomNav />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Today", "Programs", "Calendar", "Progress", "Settings"]);
    expect(links[0]).toHaveAttribute("href", "/today");
    expect(links[1]).toHaveAttribute("href", "/programs");
    expect(links[2]).toHaveAttribute("href", "/calendar");
    expect(links[1]).toHaveAttribute("aria-current", "page");
    expect(links[1].className).toContain("text-brand-strong");
  });
  it.each(["/history", "/history/exercises", "/history/exercises/abc", "/workouts", "/workouts/42"])("keeps Progress active on %s", (pathname) => {
    navigation.pathname = pathname;
    render(<BottomNav />);
    expect(screen.getByRole("link", { name: "Progress" })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("link").filter(link => link.getAttribute("aria-current") === "page")).toHaveLength(1);
  });
});
// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
