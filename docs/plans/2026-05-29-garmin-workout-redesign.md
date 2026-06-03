# Garmin-style Workout Execution Redesign

Date: 2026-05-29

## Vision

Data-centric lifting app inspired by Garmin's strength training UX: one lift at a time, auto-advance, minimal inputs during the workout, rich data after.

No social/feed layer. Every screen shows *your* data.

---

## Phase 1: Workout Execution Overhaul

**Goal:** Replace the current multi-exercise card with a single-lift-at-a-time view. This is the biggest UX win.

### Changes

| File | What changes |
|---|---|
| `src/components/WorkoutCard.tsx` | Rewrite. Single current-lift view with auto-advance. One prominent "Log Set" button. Post-workout summary. |
| `src/app/today/page.tsx` | Add day context (week/day) from the program. Show empty state when no program exists. |
| `src/components/WorkoutCard.test.tsx` | Rewrite tests for new flow. |

### Workout card behavior

1. Load all exercises for the day via `POST /api/programs/[id]/sessions` (same endpoint)
2. Show current exercise prominently (large exercise name, `3 × 5 @ 230 lb`)
3. One input: reps (numeric, large touch target)
4. One primary button: "Log Set" — saves the set, auto-advances to next exercise
5. Upcoming exercises shown below as dimmed cards
6. Completed exercises show a checkmark with reps logged
7. Footer always visible: "Skip workout" + "Finish workout"
8. After finishing: brief summary (lifts completed, any training max increases)

### Data model

No DB changes needed. Uses existing sessions/session_sets API. The WorkoutCard manages exercise index state client-side.

### API

Uses existing endpoints:
- `POST /api/programs/[id]/sessions` — start/resume session
- `PUT /api/sessions/[id]/sets` — log a set
- `POST /api/programs/[id]/complete-and-advance` — finish workout
- `POST /api/programs/[id]/skip-workout` — skip

---

## Phase 2: Tab Restructure & History

**Goal:** 3 focused tabs (Programs | Today | History). Settings moves to a gear icon.

### Changes

| File | What changes |
|---|---|
| `src/components/BottomNav.tsx` | Reduce from 4 to 3 tabs. Add settings gear in top-right corner. |
| `src/app/page.tsx` | Becomes programs list (already is, just rename heading) |
| `src/app/history/page.tsx` | Card feed: each card shows date, program, day, key lifts with weights. Tap to expand set details. |
| `src/app/settings/page.tsx` | Move from tab to `/settings` with gear icon nav. |

### History card format

```
│ May 29 · Starting Strength 3-Day            │
│ Workout A                                   │
│ Squat 230 lb · Bench 190 lb · Deadlift 315  │
│ [Expand for sets]                           │
```

Expanded view shows each set: reps, weight, implied max if calculated.

---

## Phase 3: Data Visualization

**Goal:** Training max progression charts, volume tracking, streaks.

### Changes

| File | What changes |
|---|---|
| `src/components/TmChart.tsx` | New. Simple SVG line chart for training max over time per exercise. |
| `src/app/history/page.tsx` | Add chart section above the feed. Toggle per-exercise. |
| `src/features/history/` | New. Aggregation queries: TM history, volume per session, streaks. |

### Charts

- **Training max line chart:** X = date, Y = training max. One line per lift. Shows progression over weeks.
- **Volume bar chart:** Total lbs moved per session. Shows workload trends.
- **Session streak:** N consecutive sessions completed. Simple counter displayed on Today/History.

### DB queries

Existing `exercise_max_history` table stores TM snapshots. Query by exercise + date range for chart data. Volume = sum of `actual_weight * actual_reps` per session from `session_sets`.

---

## Implementation Order

1. **Phase 1** — the workout execution screen. Highest UX impact, lowest structural change.
2. **Phase 2** — tab restructure and history cards. Medium UX impact, structural cleanup.
3. **Phase 3** — charts. Nice-to-have data viz, add when Phases 1-2 are solid.

Each phase is independently shippable. No phase blocks the next — the app works at every step.
