# Program Definition/Run Full Cutover Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `program_definitions` and `program_runs` the app's source of truth for program management, shared sync, scheduling, and user-owned workout history.

**Architecture:** This is a full ownership cutover, not a compatibility-first migration. Route and page code should resolve programs through `program_runs` joined to `program_definitions`; shared program updates create definition versions; user state remains on runs. Legacy `programs/days/exercises/week_settings` may remain only as generated execution rows while `session_sets.week_setting_id` still requires them.

**Tech Stack:** Next.js App Router route handlers/server components, TypeScript, better-sqlite3, Vitest, SQLite migrations.

---

### Task 1: Canonical Program Service

**Files:**
- Create: `src/features/programs/program-service.ts`
- Test: `src/features/programs/program-service.test.ts`
- Modify: `src/lib/db/schema.sql`
- Modify: `src/lib/db/migrations.ts`

**Steps:**
1. Write failing tests for creating a custom definition/run with stable definition day/exercise rows and generated execution rows.
2. Write failing tests proving run schedule/current week/current day live on `program_runs`, not `programs`.
3. Add generic stable keys for definition exercises and run expected maxes.
4. Implement service functions:
   - `createProgramRun`
   - `getProgramRunDetailByLegacyProgramId`
   - `updateProgramRun`
   - `archiveProgramRun`
   - `addDefinitionDayForRun`
   - `addDefinitionExerciseForDay`
5. Keep legacy execution rows generated from definitions until session storage is moved.
6. Run focused tests and commit.

### Task 2: Program Routes Use Runs/Definitions

**Files:**
- Modify: `src/app/api/programs/route.ts`
- Modify: `src/app/api/programs/[id]/route.ts`
- Modify: `src/app/api/programs/[id]/days/route.ts`
- Modify: `src/app/api/days/[dayId]/exercises/route.ts`
- Test: `src/app/api/programs/program-routes.test.ts`

**Steps:**
1. Add route tests that mutate API data, then assert definition/run tables are canonical.
2. Refactor routes to call `program-service`.
3. Keep response shapes compatible for current UI.
4. Run focused route tests and commit.

### Task 3: Workout Sessions Use Program Runs

**Files:**
- Modify: `src/app/api/programs/[id]/sessions/route.ts`
- Modify: `src/app/api/programs/[id]/complete-and-advance/route.ts`
- Modify: `src/app/api/programs/[id]/skip-workout/route.ts`
- Test: `src/app/api/sessions/session-routes.test.ts`

**Steps:**
1. Add tests proving session creation snapshots `program_run_id` and advances `program_runs.current_week/current_day`.
2. Refactor session creation/completion/skip to read state from `program_runs`.
3. Preserve user-owned history and durable program/day names.
4. Run focused session tests and commit.

### Task 4: Shared Sync Targets Definitions

**Files:**
- Modify: `src/features/shared-programs/sync.ts`
- Modify: `src/features/shared-programs/reverse-materialize.ts`
- Test: `src/features/shared-programs/sync.test.ts`
- Test: `src/features/shared-programs/reverse-materialize.test.ts`

**Steps:**
1. Add failing tests proving apply/rollback creates or selects `program_definitions` versions and preserves user run state.
2. Refactor shared sync to create definition rows before creating/updating a run.
3. Store expected maxes on the run, while still updating the shared max gauge table.
4. Refactor reverse materialization to read definitions instead of legacy program structure.
5. Run focused shared-program tests and commit.

### Task 5: Pages Read Runs/Definitions

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/today/page.tsx`
- Modify: `src/app/calendar/page.tsx`
- Modify: `src/app/programs/[id]/page.tsx`
- Test: existing page coverage in `src/app/api/programs/program-routes.test.ts`

**Steps:**
1. Add tests where legacy `programs` state disagrees with `program_runs`; UI must show run state.
2. Refactor page queries to join `program_runs` and `program_definitions`.
3. Keep route URLs using the legacy execution program id until routes are renamed.
4. Run focused page tests and commit.

### Task 6: Cleanup and Verification

**Files:**
- Modify docs as needed.
- Update tests that manually seed legacy-only `programs`.

**Steps:**
1. Search for remaining app-level direct legacy ownership queries.
2. Convert tests and code to seed via the service where possible.
3. Run `npm run typecheck`.
4. Run `npm run test`.
5. Run `npm run lint`.
6. Commit final cleanup.
