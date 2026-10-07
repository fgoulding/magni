import { describe, expect, it } from "vitest";
import {
  buildLiftDetail,
  buildTrainingStats,
  computeSessionPrs,
  computeStreakWeeks,
  epleyE1rm,
  recentWeekKeys,
  selectFeaturedLifts,
  weekStartKey,
  type LiftStat,
  type StatSetRow,
} from "./training-stats";

describe("computeSessionPrs", () => {
  it("flags an exercise only when this session beats the prior best e1RM", () => {
    const prior = [
      { exerciseId: "test:Squat", exercise: "Squat", reps: 5, weight: 300 }, // e1RM 350
      { exerciseId: "test:Bench", exercise: "Bench", reps: 5, weight: 200 }, // e1RM 233.3
    ];
    const session = [
      { exerciseId: "test:Squat", exercise: "Squat", reps: 3, weight: 330 }, // e1RM 363 > 350 → PR
      { exerciseId: "test:Bench", exercise: "Bench", reps: 5, weight: 195 }, // e1RM 227.5 < 233.3 → no PR
    ];
    expect(computeSessionPrs(session, prior)).toEqual([
      { exercise: "Squat", e1rm: 363, weight: 330, reps: 3 },
    ]);
  });

  it("does not flag a lift with no prior history (first time isn't a PR)", () => {
    expect(computeSessionPrs([{ exerciseId: "test:Curl", exercise: "Curl", reps: 10, weight: 50 }], [])).toEqual([]);
  });

  it("takes the best set in the session and sorts PRs by e1RM", () => {
    const prior = [
      { exerciseId: "test:Squat", exercise: "Squat", reps: 1, weight: 100 },
      { exerciseId: "test:Deadlift", exercise: "Deadlift", reps: 1, weight: 100 },
    ];
    const session = [
      { exerciseId: "test:Squat", exercise: "Squat", reps: 8, weight: 120 }, // best of two Squat sets
      { exerciseId: "test:Squat", exercise: "Squat", reps: 3, weight: 130 },
      { exerciseId: "test:Deadlift", exercise: "Deadlift", reps: 5, weight: 200 },
    ];
    const prs = computeSessionPrs(session, prior);
    expect(prs.map((p) => p.exercise)).toEqual(["Deadlift", "Squat"]);
    // 8×120 → e1RM 152 beats 3×130 → e1RM 143, so the 8-rep set is the PR.
    expect(prs.find((p) => p.exercise === "Squat")).toEqual({
      exercise: "Squat",
      e1rm: 152,
      weight: 120,
      reps: 8,
    });
  });
});

describe("epleyE1rm", () => {
  it("returns the weight for a single rep", () => {
    expect(epleyE1rm(200, 1)).toBe(200);
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
  it("snaps to the preceding Monday", () => {
    // Tuesday and the following Sunday share the Monday boundary.
    expect(weekStartKey("2026-06-02")).toBe("2026-06-01");
    expect(weekStartKey("2026-06-07")).toBe("2026-06-01");
    expect(weekStartKey("2026-06-01")).toBe("2026-06-01");
  });
});

describe("recentWeekKeys", () => {
  it("returns N consecutive ascending Monday keys ending at the current week", () => {
    expect(recentWeekKeys("2026-06-01", 3)).toEqual(["2026-05-18", "2026-05-25", "2026-06-01"]);
  });
});

describe("computeStreakWeeks", () => {
  it("counts consecutive weeks back from the current week", () => {
    const weeks = new Set(["2026-06-01", "2026-05-25", "2026-05-11"]);
    expect(computeStreakWeeks(weeks, "2026-06-01")).toBe(2); // 05-18 missing breaks the run
  });

  it("is zero when the current week has no session", () => {
    const weeks = new Set(["2026-05-25"]);
    expect(computeStreakWeeks(weeks, "2026-06-01")).toBe(0);
  });
});

describe("selectFeaturedLifts", () => {
  const lift = (name: string, category = "main"): LiftStat => ({
    name,
    category,
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

  it("won't feature an aux/accessory name match as a main lift", () => {
    const perLift = new Map<string, LiftStat>([
      ["Bench Variation", lift("Bench Variation", "aux")],
      ["Back Squat", lift("Back Squat", "main")],
    ]);
    // The aux variation has far more volume, but only the main squat is featured.
    const vol = new Map<string, number>([
      ["Bench Variation", 9000],
      ["Back Squat", 100],
    ]);
    expect(selectFeaturedLifts(perLift, vol).map((l) => l.name)).toEqual(["Back Squat"]);
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
    // this week (week of 06-01)
    { exerciseId: "test:Bench Press", date: "2026-06-01", exercise: "Bench Press", category: "main", reps: 5, weight: 185 },
    { exerciseId: "test:Bench Press", date: "2026-06-01", exercise: "Bench Press", category: "main", reps: 3, weight: 205 },
    { exerciseId: "test:Triceps", date: "2026-06-01", exercise: "Triceps", category: "accessory", reps: 12, weight: 40 },
    // last week (week of 05-25)
    { exerciseId: "test:Bench Press", date: "2026-05-26", exercise: "Bench Press", category: "main", reps: 5, weight: 175 },
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
  const rows = [
    { sessionId: 1, exerciseId: "squat", date: "2026-05-10", exercise: "Squat", category: "main", reps: 5, weight: 225 },
    { sessionId: 1, exerciseId: "squat", date: "2026-05-10", exercise: "Squat", category: "main", reps: 5, weight: 225 },
    { sessionId: 2, exerciseId: "squat", date: "2026-05-17", exercise: "Squat", category: "main", reps: 5, weight: 235 }, // PR
    { sessionId: 3, exerciseId: "squat", date: "2026-05-24", exercise: "Squat", category: "main", reps: 3, weight: 235 }, // lower e1rm, no PR
    { sessionId: 4, exerciseId: "squat", date: "2026-05-31", exercise: "Squat", category: "main", reps: 5, weight: 245 }, // PR
    { sessionId: 4, exerciseId: "bench", date: "2026-05-31", exercise: "Bench", category: "main", reps: 5, weight: 185 }, // other lift, ignored
  ];

  it("matches by identity and ignores other lifts", () => {
    const detail = buildLiftDetail(rows, "squat", "squat");
    expect(detail.hasData).toBe(true);
    expect(detail.sessionCount).toBe(4);
    expect(detail.maxWeight).toBe(245);
  });

  it("records only new-PR sessions in the timeline, most recent first", () => {
    const detail = buildLiftDetail(rows, "squat", "Squat");
    expect(detail.prTimeline.map((p) => p.date)).toEqual(["2026-05-31", "2026-05-17"]);
    expect(detail.prTimeline[0].weight).toBe(245);
  });

  it("returns sessions most-recent-first with a chronological trend", () => {
    const detail = buildLiftDetail(rows, "squat", "Squat");
    expect(detail.sessions[0].date).toBe("2026-05-31");
    expect(detail.trend).toHaveLength(4);
    expect(detail.trend[0]).toBeLessThan(detail.trend[detail.trend.length - 1]);
  });

  it("reports no data for an unknown lift", () => {
    const detail = buildLiftDetail(rows, "overhead-press", "Overhead Press");
    expect(detail.hasData).toBe(false);
    expect(detail.sessionCount).toBe(0);
  });
});


describe("recorded attempt accuracy", () => {
  it("retains separate workouts performed on one date", () => {
    const rows = [
      { exerciseId: "selected", sessionId: 11, date: "2026-09-01", exercise: "Row", category: "accessory", reps: 10, weight: 40 },
      { exerciseId: "selected", sessionId: 12, date: "2026-09-01", exercise: "Row", category: "accessory", reps: 10, weight: 45 },
    ];
    const detail = buildLiftDetail(rows, "selected", "Row");
    expect(detail.sessionCount).toBe(2);
    expect(detail.sessions.map(row => row.sessionId)).toEqual([12, 11]);
    expect(detail.prTimeline).toHaveLength(1);
    expect(detail.totalVolume).toBe(850);
  });

  it("retains zero-load work and failed attempts without inventing estimated strength", () => {
    const rows = [
      { exerciseId: "selected", sessionId: 11, date: "2026-09-01", exercise: "Pull-up", category: "accessory", reps: 8, weight: 0 },
      { exerciseId: "selected", sessionId: 12, date: "2026-09-02", exercise: "Pull-up", category: "accessory", reps: 0, weight: 5 },
      { exerciseId: "selected", sessionId: 13, date: "2026-09-03", exercise: "Pull-up", category: "accessory", reps: 9, weight: null },
    ];
    const detail = buildLiftDetail(rows, "selected", "Pull-up");
    expect(detail.hasData).toBe(true);
    expect(detail.sessionCount).toBe(3);
    expect(detail.sessions.map(row => row.bestReps)).toEqual([9, 0, 8]);
    expect(detail.sessions.map(row => row.bestE1rm)).toEqual([null, null, null]);
    expect(detail.sessions.map(row => row.topWeight)).toEqual([null, 5, 0]);
    expect(detail.prTimeline).toEqual([]);
  });
});

it("compares identity rather than colliding labels when detecting records", () => {
  const prior = [{ exerciseId: "barbell-row", exercise: "Row", reps: 5, weight: 40 }];
  const session = [
    { exerciseId: "dumbbell-row", exercise: "Row", reps: 5, weight: 60 },
    { exerciseId: "barbell-row", exercise: "Renamed barbell row", reps: 5, weight: 45 },
  ];
  expect(computeSessionPrs(session, prior)).toEqual([{ exercise: "Renamed barbell row", e1rm: 53, weight: 45, reps: 5 }]);
});
