import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNav } from "./BottomNav";

const navigation = vi.hoisted(() => ({ pathname: "/programs", search: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname, useSearchParams: () => new URLSearchParams(navigation.search) }));
beforeEach(() => { navigation.pathname = "/programs"; navigation.search = ""; });
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
  it.each([
    ["/workouts/new", "/calendar?month=2026-10&date=2026-10-11&view=month", "Calendar"],
    ["/workouts/42", "/today", "Today"],
    ["/workouts/42/resume", "/workouts/42?returnTo=%2Ftoday", "Today"],
    ["/workouts/42", "/workouts?q=upper&status=in_progress", "Progress"],
    ["/workouts/42", "/history?period=4w&metric=load%3Akg", "Progress"],
    ["/workouts/42", "https://elsewhere.test/today", "Progress"],
    ["/workouts/42", "/calendar?date=2026-02-30", "Progress"],
    ["/history", "/today", "Progress"],
    ["/workouts", "/today", "Progress"],
  ])("uses only a valid origin for %s returning to %s", (pathname, returnTo, label) => {
    navigation.pathname = pathname;
    navigation.search = new URLSearchParams({ returnTo }).toString();
    render(<BottomNav />);
    expect(screen.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("link").filter(link => link.getAttribute("aria-current") === "page")).toHaveLength(1);
  });
});
// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
