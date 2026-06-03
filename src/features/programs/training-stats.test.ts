import { describe, expect, it } from "vitest";
import {
  buildLiftDetail,
  buildTrainingStats,
  computeStreakWeeks,
  epleyE1rm,
  recentWeekKeys,
  selectFeaturedLifts,
  weekStartKey,
  type LiftStat,
  type StatSetRow,
} from "./training-stats";

describe("epleyE1rm", () => {
  it("returns the weight for a single rep", () => {
    expect(epleyE1rm(200, 1)).toBeCloseTo(206.67, 1);
  });

  it("scales up with reps", () => {
    expect(epleyE1rm(100, 5)).toBeCloseTo(116.67, 1);
  });

  it("guards against zero/negative input", () => {
    expect(epleyE1rm(0, 5)).toBe(0);
    expect(epleyE1rm(100, 0)).toBe(0);
  });
});

describe("weekStartKey", () => {
  it("snaps to the preceding Sunday", () => {
    // 2026-06-02 is a Tuesday -> week starts Sunday 2026-05-31
    expect(weekStartKey("2026-06-02")).toBe("2026-05-31");
    // A Sunday maps to itself
    expect(weekStartKey("2026-05-31")).toBe("2026-05-31");
  });
});

describe("recentWeekKeys", () => {
  it("returns N consecutive ascending Sunday keys ending at the current week", () => {
    expect(recentWeekKeys("2026-05-31", 3)).toEqual(["2026-05-17", "2026-05-24", "2026-05-31"]);
  });
});

describe("computeStreakWeeks", () => {
  it("counts consecutive weeks back from the current week", () => {
    const weeks = new Set(["2026-05-31", "2026-05-24", "2026-05-10"]);
    expect(computeStreakWeeks(weeks, "2026-05-31")).toBe(2); // 05-17 missing breaks the run
  });

  it("is zero when the current week has no session", () => {
    const weeks = new Set(["2026-05-24"]);
    expect(computeStreakWeeks(weeks, "2026-05-31")).toBe(0);
  });
});

describe("selectFeaturedLifts", () => {
  const lift = (name: string): LiftStat => ({
    name,
    maxWeight: 100,
    bestE1rm: 100,
    bestReps: 1,
    bestWeight: 100,
    trend: [],
    lastDate: null,
  });

  it("prefers squat/bench/deadlift in order", () => {
    const perLift = new Map<string, LiftStat>([
      ["Barbell Row", lift("Barbell Row")],
      ["Back Squat", lift("Back Squat")],
      ["Bench Press", lift("Bench Press")],
      ["Deadlift", lift("Deadlift")],
    ]);
    const vol = new Map<string, number>();
    expect(selectFeaturedLifts(perLift, vol).map((l) => l.name)).toEqual([
      "Back Squat",
      "Bench Press",
      "Deadlift",
    ]);
  });

  it("falls back to top lifts by volume when no big-three present", () => {
    const perLift = new Map<string, LiftStat>([
      ["Curl", lift("Curl")],
      ["Press", lift("Press")],
    ]);
    const vol = new Map<string, number>([
      ["Curl", 500],
      ["Press", 900],
    ]);
    expect(selectFeaturedLifts(perLift, vol).map((l) => l.name)).toEqual(["Press", "Curl"]);
  });
});

describe("buildTrainingStats", () => {
  const now = new Date(2026, 5, 2); // Tue 2026-06-02

  const rows: StatSetRow[] = [
    // this week (week of 05-31)
    { date: "2026-06-01", exercise: "Bench Press", category: "main", reps: 5, weight: 185 },
    { date: "2026-06-01", exercise: "Bench Press", category: "main", reps: 3, weight: 205 },
    { date: "2026-06-01", exercise: "Triceps", category: "accessory", reps: 12, weight: 40 },
    // last week (week of 05-24)
    { date: "2026-05-26", exercise: "Bench Press", category: "main", reps: 5, weight: 175 },
  ];
  const sessionDates = ["2026-06-01", "2026-05-26"];

  it("computes totals, big-three PRs, split, and frequency", () => {
    const stats = buildTrainingStats(rows, sessionDates, now);

    expect(stats.hasData).toBe(true);
    expect(stats.totals.sessions).toBe(2);
    expect(stats.totals.sets).toBe(4);
    expect(stats.totals.reps).toBe(25);

    const bench = stats.bigThree.find((l) => l.name === "Bench Press");
    expect(bench).toBeDefined();
    expect(bench!.maxWeight).toBe(205);
    // best e1rm from 205x3 = 205*(1+3/30)=225.5 -> 226 (beats 185x5=216)
    expect(bench!.bestE1rm).toBe(226);
    expect(bench!.bestWeight).toBe(205);
    expect(bench!.bestReps).toBe(3);

    expect(stats.frequency.thisWeek).toBe(1);
    expect(stats.frequency.streakWeeks).toBe(2);
    expect(stats.weeklyVolume).toHaveLength(10);
    expect(stats.frequency.weeks).toHaveLength(8);

    const main = stats.categorySplit.find((c) => c.category === "main");
    const accessory = stats.categorySplit.find((c) => c.category === "accessory");
    expect(main).toBeDefined();
    expect(accessory).toBeDefined();
    expect((main!.pct + accessory!.pct)).toBe(100);
  });

  it("reports no data for an empty log", () => {
    const stats = buildTrainingStats([], [], now);
    expect(stats.hasData).toBe(false);
    expect(stats.totals.volume).toBe(0);
    expect(stats.bigThree).toEqual([]);
  });
});

describe("buildLiftDetail", () => {
  const rows: StatSetRow[] = [
    { date: "2026-05-10", exercise: "Squat", category: "main", reps: 5, weight: 225 },
    { date: "2026-05-10", exercise: "Squat", category: "main", reps: 5, weight: 225 },
    { date: "2026-05-17", exercise: "Squat", category: "main", reps: 5, weight: 235 }, // PR
    { date: "2026-05-24", exercise: "Squat", category: "main", reps: 3, weight: 235 }, // lower e1rm, no PR
    { date: "2026-05-31", exercise: "Squat", category: "main", reps: 5, weight: 245 }, // PR
    { date: "2026-05-31", exercise: "Bench", category: "main", reps: 5, weight: 185 }, // other lift, ignored
  ];

  it("matches by name (case-insensitive) and ignores other lifts", () => {
    const detail = buildLiftDetail(rows, "squat");
    expect(detail.hasData).toBe(true);
    expect(detail.sessionCount).toBe(4);
    expect(detail.maxWeight).toBe(245);
  });

  it("records only new-PR sessions in the timeline, most recent first", () => {
    const detail = buildLiftDetail(rows, "Squat");
    expect(detail.prTimeline.map((p) => p.date)).toEqual(["2026-05-31", "2026-05-17", "2026-05-10"]);
    expect(detail.prTimeline[0].weight).toBe(245);
  });

  it("returns sessions most-recent-first with a chronological trend", () => {
    const detail = buildLiftDetail(rows, "Squat");
    expect(detail.sessions[0].date).toBe("2026-05-31");
    expect(detail.trend).toHaveLength(4);
    expect(detail.trend[0]).toBeLessThan(detail.trend[detail.trend.length - 1]);
  });

  it("reports no data for an unknown lift", () => {
    const detail = buildLiftDetail(rows, "Overhead Press");
    expect(detail.hasData).toBe(false);
    expect(detail.sessionCount).toBe(0);
  });
});
