import { parseDateKey, toLocalDateKey } from "@/lib/date-key";
import { db } from "@/lib/db";

export type StatSetRow = Readonly<{
  date: string;
  exercise: string;
  category: string;
  reps: number;
  weight: number;
  /** How many identical sets this row stands in for (flat rows > 1; ramp rows 1). */
  sets?: number;
}>;

export type LiftStat = Readonly<{
  name: string;
  maxWeight: number;
  bestE1rm: number;
  bestReps: number;
  bestWeight: number;
  trend: number[];
  lastDate: string | null;
  /** "main" | "aux" | "accessory" — featured slots prefer a main-category lift. */
  category?: string;
}>;

export type WeeklyPoint = Readonly<{ weekStart: string; value: number }>;

export type CategorySlice = Readonly<{ category: string; volume: number; pct: number }>;

export type TrainingStats = Readonly<{
  hasData: boolean;
  totals: { sessions: number; sets: number; reps: number; volume: number };
  bigThree: LiftStat[];
  weeklyVolume: WeeklyPoint[];
  frequency: {
    thisWeek: number;
    streakWeeks: number;
    avgPerWeek: number;
    weeks: WeeklyPoint[];
  };
  categorySplit: CategorySlice[];
}>;

const BIG_THREE = [
  { label: "Squat", match: (name: string) => /squat/.test(name) },
  { label: "Bench", match: (name: string) => /bench/.test(name) },
  { label: "Deadlift", match: (name: string) => /dead\s*lift|deadlift/.test(name) },
] as const;

// --- pure helpers (unit-tested) ---

/** Epley estimated one-rep max. Epley is undefined at 1 rep (it would inflate an
 *  actual single by ~3.3%), so a single rep returns the weight lifted. */
export function epleyE1rm(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

/** Non-null date-key parse for internally-generated keys (always valid). */
function requireDate(key: string): Date {
  return parseDateKey(key) ?? new Date(Number.NaN);
}

/** Sunday-start week key (YYYY-MM-DD) for the week containing `dateKey`. */
export function weekStartKey(dateKey: string): string {
  const date = requireDate(dateKey);
  date.setDate(date.getDate() - date.getDay());
  return toLocalDateKey(date);
}

function shiftWeeks(weekStart: string, deltaWeeks: number): string {
  const date = requireDate(weekStart);
  date.setDate(date.getDate() + deltaWeeks * 7);
  return toLocalDateKey(date);
}

/** N consecutive Sunday week keys ending at (and including) `currentWeekStart`. */
export function recentWeekKeys(currentWeekStart: string, count: number): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) keys.push(shiftWeeks(currentWeekStart, -i));
  return keys;
}

/** Consecutive weeks with >=1 session counting back from the current week. */
export function computeStreakWeeks(weekKeysWithSessions: ReadonlySet<string>, currentWeekStart: string): number {
  let streak = 0;
  let cursor = currentWeekStart;
  while (weekKeysWithSessions.has(cursor)) {
    streak += 1;
    cursor = shiftWeeks(cursor, -1);
  }
  return streak;
}

function round(value: number): number {
  return Math.round(value);
}

/** Pick the Squat / Bench / Deadlift lifts; fall back to top lifts by volume. */
export function selectFeaturedLifts(perLift: ReadonlyMap<string, LiftStat>, volumeByLift: ReadonlyMap<string, number>): LiftStat[] {
  const featured: LiftStat[] = [];
  const used = new Set<string>();

  for (const { match } of BIG_THREE) {
    let best: LiftStat | null = null;
    let bestVolume = -1;
    for (const [name, stat] of perLift) {
      // Only a MAIN-category lift fills a big-three slot, so an aux/accessory
      // name match (e.g. "Bench Variation") never masquerades as a main lift —
      // the slot stays empty until a real main lift (e.g. "Bench Press") is logged.
      if (used.has(name) || stat.category !== "main" || !match(name.toLowerCase())) continue;
      const volume = volumeByLift.get(name) ?? 0;
      if (volume > bestVolume) {
        best = stat;
        bestVolume = volume;
      }
    }
    if (best) {
      featured.push(best);
      used.add(best.name);
    }
  }

  if (featured.length === 0) {
    return [...perLift.values()]
      .sort((a, b) => (volumeByLift.get(b.name) ?? 0) - (volumeByLift.get(a.name) ?? 0))
      .slice(0, 3);
  }

  return featured;
}

/** Build the full stats object from raw completed-set rows + completed-session dates. */
export function buildTrainingStats(
  setRows: readonly StatSetRow[],
  sessionDates: readonly string[],
  now: Date,
): TrainingStats {
  const currentWeekStart = weekStartKey(toLocalDateKey(now));

  // Totals — a flat row stands in for `sets` identical sets (ramp rows are 1).
  const totals = { sessions: sessionDates.length, sets: 0, reps: 0, volume: 0 };
  for (const row of setRows) {
    const setCount = row.sets ?? 1;
    totals.sets += setCount;
    totals.reps += row.reps * setCount;
    totals.volume += row.reps * row.weight * setCount;
  }

  // Per-lift aggregation
  const perLift = new Map<string, LiftStat>();
  const volumeByLift = new Map<string, number>();
  const trendByLift = new Map<string, Map<string, number>>(); // lift -> (date -> best e1rm)

  for (const row of setRows) {
    if (row.weight <= 0 || row.reps <= 0) continue;
    const name = row.exercise.trim();
    if (!name) continue;
    const e1rm = epleyE1rm(row.weight, row.reps); // per-set metric — never × sets
    const rowVolume = row.reps * row.weight * (row.sets ?? 1);

    volumeByLift.set(name, (volumeByLift.get(name) ?? 0) + rowVolume);

    const existing = perLift.get(name);
    if (!existing || e1rm > existing.bestE1rm) {
      perLift.set(name, {
        name,
        category: row.category,
        maxWeight: Math.max(existing?.maxWeight ?? 0, row.weight),
        bestE1rm: Math.max(existing?.bestE1rm ?? 0, e1rm),
        bestReps: e1rm >= (existing?.bestE1rm ?? 0) ? row.reps : (existing?.bestReps ?? row.reps),
        bestWeight: e1rm >= (existing?.bestE1rm ?? 0) ? row.weight : (existing?.bestWeight ?? row.weight),
        trend: [],
        lastDate: existing?.lastDate ?? null,
      });
    } else {
      perLift.set(name, { ...existing, maxWeight: Math.max(existing.maxWeight, row.weight) });
    }

    const dates = trendByLift.get(name) ?? new Map<string, number>();
    dates.set(row.date, Math.max(dates.get(row.date) ?? 0, e1rm));
    trendByLift.set(name, dates);
  }

  // Attach trend series + lastDate
  for (const [name, stat] of perLift) {
    const dateMap = trendByLift.get(name) ?? new Map<string, number>();
    const sortedDates = [...dateMap.keys()].sort();
    const trend = sortedDates.slice(-10).map((d) => round(dateMap.get(d) ?? 0));
    perLift.set(name, { ...stat, trend, lastDate: sortedDates.at(-1) ?? null });
  }

  const bigThree = selectFeaturedLifts(perLift, volumeByLift).map((lift) => ({
    ...lift,
    maxWeight: round(lift.maxWeight),
    bestE1rm: round(lift.bestE1rm),
    bestWeight: round(lift.bestWeight),
  }));

  // Weekly volume (last 10 weeks, zero-filled)
  const volumeByWeek = new Map<string, number>();
  for (const row of setRows) {
    const week = weekStartKey(row.date);
    volumeByWeek.set(week, (volumeByWeek.get(week) ?? 0) + row.reps * row.weight * (row.sets ?? 1));
  }
  const weeklyVolume: WeeklyPoint[] = recentWeekKeys(currentWeekStart, 10).map((weekStart) => ({
    weekStart,
    value: round(volumeByWeek.get(weekStart) ?? 0),
  }));

  // Frequency
  const sessionsByWeek = new Map<string, number>();
  for (const date of sessionDates) {
    const week = weekStartKey(date);
    sessionsByWeek.set(week, (sessionsByWeek.get(week) ?? 0) + 1);
  }
  const weeksWithSessions = new Set(sessionsByWeek.keys());
  const freqWeeks: WeeklyPoint[] = recentWeekKeys(currentWeekStart, 8).map((weekStart) => ({
    weekStart,
    value: sessionsByWeek.get(weekStart) ?? 0,
  }));
  const firstWeek = [...weeksWithSessions].sort()[0];
  const weekSpan =
    firstWeek !== undefined
      ? Math.max(1, Math.round((requireDate(currentWeekStart).getTime() - requireDate(firstWeek).getTime()) / (7 * 86_400_000)) + 1)
      : 1;
  const frequency = {
    thisWeek: sessionsByWeek.get(currentWeekStart) ?? 0,
    streakWeeks: computeStreakWeeks(weeksWithSessions, currentWeekStart),
    avgPerWeek: Math.round((totals.sessions / weekSpan) * 10) / 10,
    weeks: freqWeeks,
  };

  // Category split
  const volumeByCategory = new Map<string, number>();
  for (const row of setRows) {
    volumeByCategory.set(row.category, (volumeByCategory.get(row.category) ?? 0) + row.reps * row.weight * (row.sets ?? 1));
  }
  const categoryOrder = ["main", "aux", "accessory"];
  const categorySplit: CategorySlice[] = categoryOrder
    .map((category) => ({ category, volume: round(volumeByCategory.get(category) ?? 0) }))
    .filter((slice) => slice.volume > 0)
    .map((slice) => ({ ...slice, pct: totals.volume > 0 ? Math.round((slice.volume / totals.volume) * 100) : 0 }));

  return {
    hasData: totals.sessions > 0 && totals.sets > 0,
    totals: { ...totals, reps: round(totals.reps), volume: round(totals.volume) },
    bigThree,
    weeklyVolume,
    frequency,
    categorySplit,
  };
}

// --- Per-lift detail ---

export type LiftSession = Readonly<{
  date: string;
  topWeight: number;
  bestE1rm: number;
  bestReps: number;
  bestWeight: number;
  sets: number;
  volume: number;
}>;

export type LiftPr = Readonly<{ date: string; e1rm: number; weight: number; reps: number }>;

export type LiftDetail = Readonly<{
  name: string;
  hasData: boolean;
  maxWeight: number;
  bestE1rm: number;
  bestE1rmDate: string | null;
  totalVolume: number;
  sessionCount: number;
  trend: number[];
  sessions: LiftSession[];
  prTimeline: LiftPr[];
}>;

/** Build a single lift's detail (full trend, per-session top sets, PR timeline). */
export function buildLiftDetail(rows: readonly StatSetRow[], name: string): LiftDetail {
  const target = name.trim().toLowerCase();
  const byDate = new Map<string, { topWeight: number; bestE1rm: number; bestReps: number; bestWeight: number; sets: number; volume: number }>();

  for (const row of rows) {
    if (row.weight <= 0 || row.reps <= 0) continue;
    if (row.exercise.trim().toLowerCase() !== target) continue;
    const e1rm = epleyE1rm(row.weight, row.reps); // per-set metric — never × sets
    const setCount = row.sets ?? 1; // a flat row stands in for `sets` sets
    const existing = byDate.get(row.date);
    if (!existing) {
      byDate.set(row.date, {
        topWeight: row.weight,
        bestE1rm: e1rm,
        bestReps: row.reps,
        bestWeight: row.weight,
        sets: setCount,
        volume: row.reps * row.weight * setCount,
      });
    } else {
      existing.topWeight = Math.max(existing.topWeight, row.weight);
      existing.sets += setCount;
      existing.volume += row.reps * row.weight * setCount;
      if (e1rm > existing.bestE1rm) {
        existing.bestE1rm = e1rm;
        existing.bestReps = row.reps;
        existing.bestWeight = row.weight;
      }
    }
  }

  const ascDates = [...byDate.keys()].sort();
  const sessionsAsc: LiftSession[] = ascDates.map((date) => {
    const agg = byDate.get(date)!;
    return {
      date,
      topWeight: round(agg.topWeight),
      bestE1rm: round(agg.bestE1rm),
      bestReps: agg.bestReps,
      bestWeight: round(agg.bestWeight),
      sets: agg.sets,
      volume: round(agg.volume),
    };
  });

  const prTimeline: LiftPr[] = [];
  let runningMax = 0;
  for (const session of sessionsAsc) {
    if (session.bestE1rm > runningMax) {
      runningMax = session.bestE1rm;
      prTimeline.push({
        date: session.date,
        e1rm: session.bestE1rm,
        weight: session.bestWeight,
        reps: session.bestReps,
      });
    }
  }

  let maxWeight = 0;
  let bestE1rm = 0;
  let bestE1rmDate: string | null = null;
  let totalVolume = 0;
  for (const session of sessionsAsc) {
    maxWeight = Math.max(maxWeight, session.topWeight);
    totalVolume += session.volume;
    if (session.bestE1rm > bestE1rm) {
      bestE1rm = session.bestE1rm;
      bestE1rmDate = session.date;
    }
  }

  return {
    name,
    hasData: sessionsAsc.length > 0,
    maxWeight,
    bestE1rm,
    bestE1rmDate,
    totalVolume,
    sessionCount: sessionsAsc.length,
    trend: sessionsAsc.map((s) => s.bestE1rm),
    sessions: [...sessionsAsc].reverse(),
    prTimeline: [...prTimeline].reverse(),
  };
}

// --- DB entry points ---

export function getUserLiftDetail(userId: number, name: string): LiftDetail {
  const rows = db
    .prepare(
      `
        SELECT
          s.date AS date,
          ss.exercise_name AS exercise,
          ss.category AS category,
          COALESCE(ss.actual_reps, ss.reps) AS reps,
          COALESCE(ss.actual_weight, ss.calculated_weight, 0) AS weight,
          MAX(COALESCE(ss.sets, 1), 1) AS sets
        FROM session_sets ss
        JOIN sessions s ON s.id = ss.session_id
        WHERE s.user_id = ? AND s.status = 'completed' AND ss.exercise_name = ? COLLATE NOCASE
      `,
    )
    .all(userId, name) as StatSetRow[];

  return buildLiftDetail(rows, name);
}

export type SessionPr = Readonly<{ exercise: string; e1rm: number; weight: number; reps: number }>;
export type SetRepWeight = Readonly<{ exercise: string; reps: number; weight: number }>;

/**
 * Pure PR detection: an exercise is a PR when its best e1RM in `sessionSets`
 * beats its best in `priorSets`. Requires a prior record (>0), so the first time
 * you ever do a lift isn't flagged. Unit-tested.
 */
export function computeSessionPrs(
  sessionSets: readonly SetRepWeight[],
  priorSets: readonly SetRepWeight[],
): SessionPr[] {
  const best = new Map<string, { e1rm: number; weight: number; reps: number }>();
  for (const row of sessionSets) {
    if (row.weight <= 0 || row.reps <= 0) continue;
    const e1rm = epleyE1rm(row.weight, row.reps);
    const current = best.get(row.exercise);
    if (!current || e1rm > current.e1rm) best.set(row.exercise, { e1rm, weight: row.weight, reps: row.reps });
  }
  if (best.size === 0) return [];

  const priorBest = new Map<string, number>();
  for (const row of priorSets) {
    if (row.weight <= 0 || row.reps <= 0) continue;
    priorBest.set(row.exercise, Math.max(priorBest.get(row.exercise) ?? 0, epleyE1rm(row.weight, row.reps)));
  }

  const prs: SessionPr[] = [];
  for (const [exercise, b] of best) {
    const prior = priorBest.get(exercise) ?? 0;
    if (prior > 0 && b.e1rm > prior + 0.001) {
      prs.push({ exercise, e1rm: round(b.e1rm), weight: round(b.weight), reps: b.reps });
    }
  }
  return prs.sort((a, b) => b.e1rm - a.e1rm);
}

/**
 * Personal records set in one session — its best e1RM per exercise vs the user's
 * best across all their OTHER completed sessions.
 */
export function getSessionPrs(userId: number, sessionId: number): SessionPr[] {
  const setQuery = `
    SELECT ss.exercise_name AS exercise,
      COALESCE(ss.actual_reps, ss.reps) AS reps,
      COALESCE(ss.actual_weight, ss.calculated_weight, 0) AS weight
    FROM session_sets ss
    JOIN sessions s ON s.id = ss.session_id
  `;
  const sessionSets = db
    .prepare(`${setQuery} WHERE s.id = ? AND s.user_id = ?`)
    .all(sessionId, userId) as SetRepWeight[];
  const priorSets = db
    .prepare(`${setQuery} WHERE s.user_id = ? AND s.status = 'completed' AND s.id != ?`)
    .all(userId, sessionId) as SetRepWeight[];
  return computeSessionPrs(sessionSets, priorSets);
}

// How far back we load individual SET rows for the windowed charts (weekly
// volume needs 10 weeks; per-lift trends need ~10 recent session-dates). This
// is what keeps Stats roughly constant-time regardless of history depth — all
// rows stay in the DB; we just don't pull years of them into JS each render.
const STATS_WINDOW_WEEKS = 30;

type PerLiftAgg = Readonly<{
  name: string;
  category: string;
  maxWeight: number;
  volume: number;
  lastDate: string | null;
  bestE1rm: number;
  bestReps: number;
  bestWeight: number;
}>;

/** Featured (big-three) lifts: all-time bests via SQL, recent trend from the window. */
function buildBigThree(perLiftRows: readonly PerLiftAgg[], recentRows: readonly StatSetRow[]): LiftStat[] {
  const perLift = new Map<string, LiftStat>();
  const volumeByLift = new Map<string, number>();
  for (const row of perLiftRows) {
    const name = row.name.trim();
    if (!name) continue;
    perLift.set(name, {
      name,
      category: row.category,
      maxWeight: round(row.maxWeight),
      bestE1rm: round(row.bestE1rm),
      bestReps: row.bestReps,
      bestWeight: round(row.bestWeight),
      trend: [],
      lastDate: row.lastDate,
    });
    volumeByLift.set(name, row.volume);
  }

  const trendByLift = new Map<string, Map<string, number>>();
  for (const row of recentRows) {
    if (row.weight <= 0 || row.reps <= 0) continue;
    const name = row.exercise.trim();
    if (!name) continue;
    const dates = trendByLift.get(name) ?? new Map<string, number>();
    dates.set(row.date, Math.max(dates.get(row.date) ?? 0, epleyE1rm(row.weight, row.reps)));
    trendByLift.set(name, dates);
  }

  return selectFeaturedLifts(perLift, volumeByLift).map((lift) => {
    const dateMap = trendByLift.get(lift.name) ?? new Map<string, number>();
    const trend = [...dateMap.keys()].sort().slice(-10).map((d) => round(dateMap.get(d) ?? 0));
    return { ...lift, trend };
  });
}

export function getUserTrainingStats(userId: number, now: Date = new Date()): TrainingStats {
  const currentWeekStart = weekStartKey(toLocalDateKey(now));
  const windowStart = recentWeekKeys(currentWeekStart, STATS_WINDOW_WEEKS)[0];

  // Recent SET rows only — bounds the per-row JS work to the visible window.
  const recentRows = db
    .prepare(
      `
        SELECT
          s.date AS date,
          ss.exercise_name AS exercise,
          ss.category AS category,
          COALESCE(ss.actual_reps, ss.reps) AS reps,
          COALESCE(ss.actual_weight, ss.calculated_weight, 0) AS weight,
          MAX(COALESCE(ss.sets, 1), 1) AS sets
        FROM session_sets ss
        JOIN sessions s ON s.id = ss.session_id
        WHERE s.user_id = ? AND s.status = 'completed' AND s.date >= ?
      `,
    )
    .all(userId, windowStart) as StatSetRow[];

  // All completed session DATES (cheap — bounded by # sessions, not # sets).
  const sessionDates = (
    db
      .prepare(`SELECT s.date AS date FROM sessions s WHERE s.user_id = ? AND s.status = 'completed'`)
      .all(userId) as { date: string }[]
  ).map((row) => row.date);

  // Windowed charts (weekly volume) + all-time-from-dates frequency come from the
  // pure builder fed bounded set rows + full session dates.
  const windowed = buildTrainingStats(recentRows, sessionDates, now);

  // All-time set-derived scalars via SQL aggregates — full history, no row load.
  const totalsRow = db
    .prepare(
      `
        SELECT
          COALESCE(SUM(MAX(COALESCE(ss.sets, 1), 1)), 0) AS sets,
          COALESCE(SUM(COALESCE(ss.actual_reps, ss.reps) * MAX(COALESCE(ss.sets, 1), 1)), 0) AS reps,
          COALESCE(SUM(COALESCE(ss.actual_reps, ss.reps) * COALESCE(ss.actual_weight, ss.calculated_weight, 0) * MAX(COALESCE(ss.sets, 1), 1)), 0) AS volume
        FROM session_sets ss
        JOIN sessions s ON s.id = ss.session_id
        WHERE s.user_id = ? AND s.status = 'completed'
      `,
    )
    .get(userId) as { sets: number; reps: number; volume: number };

  const categoryRows = db
    .prepare(
      `
        SELECT ss.category AS category,
               COALESCE(SUM(COALESCE(ss.actual_reps, ss.reps) * COALESCE(ss.actual_weight, ss.calculated_weight, 0) * MAX(COALESCE(ss.sets, 1), 1)), 0) AS volume
        FROM session_sets ss
        JOIN sessions s ON s.id = ss.session_id
        WHERE s.user_id = ? AND s.status = 'completed'
        GROUP BY ss.category
      `,
    )
    .all(userId) as { category: string; volume: number }[];

  // Per-lift all-time bests: max weight, total volume, last date, and the set
  // that produced the best Epley e1RM (argmax via a window-function rank).
  const perLiftRows = db
    .prepare(
      `
        WITH base AS (
          SELECT
            ss.exercise_name AS name,
            ss.category AS category,
            s.date AS date,
            COALESCE(ss.actual_reps, ss.reps) AS reps,
            COALESCE(ss.actual_weight, ss.calculated_weight, 0) AS weight,
            COALESCE(ss.actual_reps, ss.reps) * COALESCE(ss.actual_weight, ss.calculated_weight, 0) * MAX(COALESCE(ss.sets, 1), 1) AS vol,
            CASE WHEN COALESCE(ss.actual_reps, ss.reps) = 1
                 THEN COALESCE(ss.actual_weight, ss.calculated_weight, 0)
                 ELSE COALESCE(ss.actual_weight, ss.calculated_weight, 0) * (1 + COALESCE(ss.actual_reps, ss.reps) / 30.0)
            END AS e1rm
          FROM session_sets ss
          JOIN sessions s ON s.id = ss.session_id
          WHERE s.user_id = ? AND s.status = 'completed'
            AND COALESCE(ss.actual_weight, ss.calculated_weight, 0) > 0
            AND COALESCE(ss.actual_reps, ss.reps) > 0
        ),
        ranked AS (
          SELECT name, category, reps, weight, e1rm,
                 MAX(weight) OVER (PARTITION BY name) AS maxWeight,
                 SUM(vol) OVER (PARTITION BY name) AS volume,
                 MAX(date) OVER (PARTITION BY name) AS lastDate,
                 ROW_NUMBER() OVER (PARTITION BY name ORDER BY e1rm DESC, weight DESC) AS rn
          FROM base
        )
        SELECT name, category, maxWeight, volume, lastDate, e1rm AS bestE1rm, reps AS bestReps, weight AS bestWeight
        FROM ranked WHERE rn = 1
      `,
    )
    .all(userId) as PerLiftAgg[];

  const totals = {
    sessions: sessionDates.length,
    sets: totalsRow.sets,
    reps: round(totalsRow.reps),
    volume: round(totalsRow.volume),
  };
  const volumeByCategory = new Map(categoryRows.map((row) => [row.category, row.volume]));
  const categorySplit: CategorySlice[] = ["main", "aux", "accessory"]
    .map((category) => ({ category, volume: round(volumeByCategory.get(category) ?? 0) }))
    .filter((slice) => slice.volume > 0)
    .map((slice) => ({ ...slice, pct: totals.volume > 0 ? Math.round((slice.volume / totals.volume) * 100) : 0 }));

  return {
    hasData: totals.sessions > 0 && totals.sets > 0,
    totals,
    bigThree: buildBigThree(perLiftRows, recentRows),
    weeklyVolume: windowed.weeklyVolume,
    frequency: windowed.frequency,
    categorySplit,
  };
}

// --- Completed-workout recap (what you did + what you skipped) ---

export type RecapExercise = Readonly<{
  name: string;
  bodyweight: boolean;
  skipped: boolean;
  loggedSets: number;
  totalReps: number;
  topWeight: number;
  repScheme: string;
}>;

export type SessionRecap = Readonly<{
  status: string;
  date: string;
  programName: string;
  dayName: string;
  volume: number;
  exercises: RecapExercise[];
  loggedCount: number;
  skippedCount: number;
}>;

/** Recap a completed/skipped session: per-exercise what was logged, and skips. */
export function getSessionRecap(userId: number, sessionId: number): SessionRecap | null {
  const session = db
    .prepare(
      `
        SELECT
          s.status AS status,
          s.date AS date,
          COALESCE(NULLIF(s.program_name, ''), p.name, '') AS programName,
          COALESCE(NULLIF(s.day_name, ''), d.name, pdd.name, '') AS dayName
        FROM sessions s
        LEFT JOIN programs p ON p.id = s.program_id
        LEFT JOIN days d ON d.id = s.day_id
        LEFT JOIN program_definition_days pdd ON pdd.id = s.program_definition_day_id
        WHERE s.id = ? AND s.user_id = ?
      `,
    )
    .get(sessionId, userId) as
    | { status: string; date: string; programName: string; dayName: string }
    | undefined;
  if (!session) return null;

  const rows = db
    .prepare(
      `
        SELECT exercise_name AS name, progression_type AS progressionType,
               actual_reps AS actualReps, actual_weight AS actualWeight, sets AS setCount
        FROM session_sets
        WHERE session_id = ?
        ORDER BY program_definition_exercise_id, set_number, id
      `,
    )
    .all(sessionId) as {
    name: string;
    progressionType: string;
    actualReps: number | null;
    actualWeight: number | null;
    setCount: number;
  }[];

  const order: string[] = [];
  const byName = new Map<string, { bodyweight: boolean; reps: number[]; topWeight: number; volume: number }>();
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    let agg = byName.get(name);
    if (!agg) {
      agg = { bodyweight: row.progressionType === "bodyweight", reps: [], topWeight: 0, volume: 0 };
      byName.set(name, agg);
      order.push(name);
    }
    if (row.actualReps != null) {
      const weight = row.actualWeight ?? 0;
      // A flat row stands in for `setCount` identical sets; a ramp row is one set.
      const setCount = row.setCount > 0 ? row.setCount : 1;
      for (let i = 0; i < setCount; i += 1) {
        agg.reps.push(row.actualReps);
        agg.volume += row.actualReps * weight;
      }
      agg.topWeight = Math.max(agg.topWeight, weight);
    }
  }

  const exercises: RecapExercise[] = order.map((name) => {
    const agg = byName.get(name)!;
    return {
      name,
      bodyweight: agg.bodyweight,
      skipped: agg.reps.length === 0,
      loggedSets: agg.reps.length,
      totalReps: agg.reps.reduce((sum, r) => sum + r, 0),
      topWeight: round(agg.topWeight),
      repScheme: agg.reps.join("/"),
    };
  });

  return {
    status: session.status,
    date: session.date,
    programName: session.programName,
    dayName: session.dayName,
    volume: round(exercises.length ? [...byName.values()].reduce((s, e) => s + e.volume, 0) : 0),
    exercises,
    loggedCount: exercises.filter((e) => !e.skipped).length,
    skippedCount: exercises.filter((e) => e.skipped).length,
  };
}

// --- "Last time" reference: the most recent prior completed performance per lift ---

export type LastPerformance = Readonly<{
  date: string;
  reps: number[];
  topWeight: number;
  bodyweight: boolean;
}>;

/** For every exercise in a session, the logged sets from the most recent OTHER
 *  completed session containing that exercise — so the workout can show what you
 *  did last time. Flat rows (sets > 1) expand to one rep entry per set. */
export function getLastPerformanceByExercise(userId: number, sessionId: number): Record<string, LastPerformance> {
  const rows = db
    .prepare(
      `
        WITH ranked AS (
          SELECT
            ss.exercise_name AS name,
            ss.set_number AS setNumber,
            ss.actual_reps AS reps,
            COALESCE(ss.actual_weight, ss.calculated_weight, 0) AS weight,
            ss.sets AS setCount,
            ss.progression_type AS progressionType,
            s.date AS date,
            DENSE_RANK() OVER (PARTITION BY ss.exercise_name ORDER BY s.date DESC, s.id DESC) AS sessionRank
          FROM session_sets ss
          JOIN sessions s ON s.id = ss.session_id
          WHERE s.user_id = ? AND s.status = 'completed' AND s.id <> ?
            AND ss.actual_reps IS NOT NULL
            AND ss.exercise_name IN (SELECT DISTINCT exercise_name FROM session_sets WHERE session_id = ?)
        )
        SELECT name, setNumber, reps, weight, setCount, progressionType, date
        FROM ranked WHERE sessionRank = 1
        ORDER BY name, setNumber
      `,
    )
    .all(userId, sessionId, sessionId) as {
    name: string;
    reps: number;
    weight: number;
    setCount: number;
    progressionType: string;
    date: string;
  }[];

  const result: Record<string, { date: string; reps: number[]; topWeight: number; bodyweight: boolean }> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    const entry =
      result[name] ?? (result[name] = { date: row.date, reps: [], topWeight: 0, bodyweight: row.progressionType === "bodyweight" });
    const count = row.setCount > 0 ? row.setCount : 1;
    for (let i = 0; i < count; i += 1) entry.reps.push(row.reps);
    entry.topWeight = Math.max(entry.topWeight, Math.round(row.weight));
  }
  return result;
}
