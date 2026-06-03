import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BottomNav } from "./BottomNav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/programs",
}));

describe("BottomNav", () => {
  it("puts Today before Programs while keeping Programs active on the programs route", () => {
    render(<BottomNav />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Today", "Programs", "Calendar", "Stats", "Settings"]);
    expect(links[0]).toHaveAttribute("href", "/today");
    expect(links[1]).toHaveAttribute("href", "/programs");
    expect(links[2]).toHaveAttribute("href", "/calendar");
    expect(links[1]).toHaveAttribute("aria-current", "page");
    expect(links[1].className).toContain("text-brand-strong");
  });
});
// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
