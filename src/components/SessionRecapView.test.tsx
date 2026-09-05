// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { SessionRecap } from "@/features/programs/training-stats";
import { SessionRecapView } from "./SessionRecapView";

afterEach(cleanup);
const base: SessionRecap = { status: "completed", date: "2026-09-05", unit: "kg", programName: "Rows", dayName: "Pull", volume: 680, loggedCount: 1, skippedCount: 0,
  exercises: [{ name: "Dumbbell Row", bodyweight: false, skipped: false, loggedSets: 2, totalReps: 16, topWeight: 42.5, repScheme: "8/8" }] };
it("shows kilogram volume and the exact recorded fractional load in a Calendar recap", () => {
  render(<SessionRecapView recap={base} />);
  expect(screen.getByText("680 kg volume")).toBeInTheDocument();
  expect(screen.getByText("8/8 @ 42.5 kg")).toBeInTheDocument();
  expect(screen.queryByText(/\blb\b/)).not.toBeInTheDocument();
});
it("preserves fractional pounds and distinguishes an added bodyweight load from unweighted sets", () => {
  render(<SessionRecapView recap={{ ...base, unit: "lb", volume: 250, exercises: [{ ...base.exercises[0], topWeight: 12.75 }, { ...base.exercises[0], name: "Weighted pull-up", bodyweight: true, topWeight: 6.25 }, { ...base.exercises[0], name: "Push-up", bodyweight: true, topWeight: 0 }] }} />);
  expect(screen.getByText("250 lb volume")).toBeInTheDocument();
  expect(screen.getByText("8/8 @ 12.75 lb")).toBeInTheDocument();
  expect(screen.getByText("8/8 BW + 6.25 lb")).toBeInTheDocument();
  expect(screen.getByText("8/8 BW")).toBeInTheDocument();
});
