# Shared Program Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build versioned shared workout programs with invited admins, sync-with-review, rollback, personal expected maxes, default program starts, and a more execution-first Today experience.

**Architecture:** Add shared program entities alongside the existing private runnable program tables. Shared versions store immutable JSON snapshots; syncing materializes a version into the user's private `programs/days/exercises/week_settings` rows while preserving personal maxes and workout history through stable shared day/exercise keys. Existing private programs must keep working throughout the migration.

**Tech Stack:** Next.js app router/API routes, React client components, SQLite via `better-sqlite3`, Vitest, Testing Library.

---

## Notes Before Starting

- Read `AGENTS.md` and the relevant Next.js docs under `node_modules/next/dist/docs/` before editing app routes or page conventions.
- Use `superpowers:test-driven-development` for each task.
- Keep commits small and runnable.
- Existing DB initialization only executes `schema.sql`; because existing SQLite databases will not gain new columns from `CREATE TABLE IF NOT EXISTS`, add an idempotent migration helper before adding columns to existing tables.
- Preserve private program behavior. New shared behavior is additive.

---

### Task 1: Add Idempotent DB Migrations For Shared Program Support

**Files:**
- Create: `src/lib/db/migrations.ts`
- Modify: `src/lib/db/index.ts`
- Modify: `src/lib/db/schema.sql`
- Test: `src/lib/db/__tests__/db.test.ts`

**Step 1: Write failing DB tests**

Add tests that assert:

```ts
it("creates shared program tables", () => {
  const tables = dbModule.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];

  expect(tables.map((row) => row.name)).toEqual(
    expect.arrayContaining([
      "shared_programs",
      "shared_program_members",
      "shared_program_versions",
      "shared_program_expected_maxes",
      "shared_program_applied_versions",
    ]),
  );
});

it("adds shared sync columns to private runnable rows", () => {
  const programColumns = dbModule.db.prepare("PRAGMA table_info(programs)").all() as { name: string }[];
  const dayColumns = dbModule.db.prepare("PRAGMA table_info(days)").all() as { name: string }[];
  const exerciseColumns = dbModule.db.prepare("PRAGMA table_info(exercises)").all() as { name: string }[];

  expect(programColumns.map((column) => column.name)).toEqual(
    expect.arrayContaining(["shared_program_id", "shared_program_version_id", "archived_at"]),
  );
  expect(dayColumns.map((column) => column.name)).toEqual(
    expect.arrayContaining(["shared_day_key", "archived_at"]),
  );
  expect(exerciseColumns.map((column) => column.name)).toEqual(
    expect.arrayContaining(["shared_exercise_key", "archived_at"]),
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/db/__tests__/db.test.ts`

Expected: FAIL because the shared tables/columns do not exist.

**Step 3: Implement migration helper and schema additions**

In `src/lib/db/migrations.ts`, add:

```ts
import type Database from "better-sqlite3";

function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
  return columns.some((column) => column.name === columnName);
}

function addColumn(db: Database.Database, tableName: string, definition: string): void {
  const columnName = definition.split(/\s+/)[0];
  if (!hasColumn(db, tableName, columnName)) {
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`).run();
  }
}

export function runMigrations(db: Database.Database): void {
  addColumn(db, "programs", "shared_program_id INTEGER");
  addColumn(db, "programs", "shared_program_version_id INTEGER");
  addColumn(db, "programs", "archived_at TEXT");
  addColumn(db, "days", "shared_day_key TEXT");
  addColumn(db, "days", "archived_at TEXT");
  addColumn(db, "exercises", "shared_exercise_key TEXT");
  addColumn(db, "exercises", "archived_at TEXT");
}
```

Call `runMigrations(db)` after `db.exec(schema)` in `initDb()`.

Add shared tables to `schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS shared_programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active_version_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shared_program_members (
  shared_program_id INTEGER NOT NULL REFERENCES shared_programs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner','admin','member')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (shared_program_id, user_id)
);

CREATE TABLE IF NOT EXISTS shared_program_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shared_program_id INTEGER NOT NULL REFERENCES shared_programs(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  published_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(shared_program_id, version_number)
);

CREATE TABLE IF NOT EXISTS shared_program_expected_maxes (
  shared_program_id INTEGER NOT NULL REFERENCES shared_programs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_exercise_key TEXT NOT NULL,
  expected_max REAL NOT NULL CHECK(expected_max > 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (shared_program_id, user_id, shared_exercise_key)
);

CREATE TABLE IF NOT EXISTS shared_program_applied_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shared_program_id INTEGER NOT NULL REFERENCES shared_programs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES shared_program_versions(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN ('apply','rollback')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/db/__tests__/db.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/db/migrations.ts src/lib/db/index.ts src/lib/db/schema.sql src/lib/db/__tests__/db.test.ts
git commit -m "feat: add shared program storage"
```

---

### Task 2: Add Shared Program Snapshot Types And Diffing

**Files:**
- Create: `src/features/shared-programs/types.ts`
- Create: `src/features/shared-programs/snapshot.ts`
- Test: `src/features/shared-programs/snapshot.test.ts`

**Step 1: Write failing tests**

Cover:

- Valid snapshots round-trip through JSON.
- Day and exercise keys are stable and required.
- Diff reports added/removed/renamed/reordered days.
- Diff reports added/removed/renamed/reordered exercise slots.
- Diff reports template and week-scheme changes.

Example test shape:

```ts
it("diffs renamed exercise slots by stable key", () => {
  const before = makeSnapshot({
    exercises: [{ key: "squat", name: "Squat", dayKey: "lower", category: "main", progressionType: "sbs" }],
  });
  const after = makeSnapshot({
    exercises: [{ key: "squat", name: "Comp Squat", dayKey: "lower", category: "main", progressionType: "sbs" }],
  });

  expect(diffSharedProgramSnapshots(before, after).exerciseChanges).toContainEqual({
    type: "renamed",
    key: "squat",
    from: "Squat",
    to: "Comp Squat",
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/features/shared-programs/snapshot.test.ts`

Expected: FAIL because the module does not exist.

**Step 3: Implement snapshot types and diffing**

Use readonly types:

```ts
export type SharedProgramSnapshot = Readonly<{
  schemaVersion: 1;
  name: string;
  description: string;
  numWeeks: number;
  days: readonly SharedProgramDaySnapshot[];
}>;
```

Each day owns exercise slots; each exercise slot has:

- `key`
- `name`
- `category`
- `progressionType`
- `weeks`

Export:

- `parseSharedProgramSnapshot(json: string): SharedProgramSnapshot`
- `serializeSharedProgramSnapshot(snapshot: SharedProgramSnapshot): string`
- `diffSharedProgramSnapshots(before, after): SharedProgramSnapshotDiff`

Keep validation small: enough to reject malformed shape, duplicate keys, missing days, and unsupported categories.

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/features/shared-programs/snapshot.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/shared-programs/types.ts src/features/shared-programs/snapshot.ts src/features/shared-programs/snapshot.test.ts
git commit -m "feat: add shared program snapshots"
```

---

### Task 3: Add Shared Program Repository And Permission Rules

**Files:**
- Create: `src/features/shared-programs/repository.ts`
- Test: `src/features/shared-programs/repository.test.ts`

**Step 1: Write failing tests**

Cover:

- Owner can create a shared program.
- Owner can add member/admin roles.
- Admin can publish a version.
- Member cannot publish a version.
- Non-member cannot read shared program details.
- Publishing creates immutable incrementing version numbers and updates `active_version_id`.

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/features/shared-programs/repository.test.ts`

Expected: FAIL.

**Step 3: Implement repository functions**

Export functions:

- `createSharedProgram({ ownerUserId, name, description, snapshot })`
- `addSharedProgramMember({ sharedProgramId, actingUserId, targetUserId, role })`
- `getSharedProgramForUser(sharedProgramId, userId)`
- `publishSharedProgramVersion({ sharedProgramId, actingUserId, snapshot })`
- `getLatestSharedProgramVersion(sharedProgramId, userId)`
- `assertSharedProgramAdmin(sharedProgramId, userId)`
- `assertSharedProgramMember(sharedProgramId, userId)`

Use explicit transactions for create/publish.

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/features/shared-programs/repository.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/shared-programs/repository.ts src/features/shared-programs/repository.test.ts
git commit -m "feat: add shared program repository"
```

---

### Task 4: Add Lift History, Version Context, Reordering, And Skip Storage

**Files:**
- Modify: `src/lib/db/migrations.ts`
- Modify: `src/lib/db/schema.sql`
- Modify: `src/lib/db/__tests__/db.test.ts`

**Step 1: Write failing DB tests**

Cover:

- `sessions` has `status`, `skipped_at`, `skip_reason`, and `shared_program_version_id`.
- `days` and `exercises` keep `sort_order` available for reorderable program editing.
- `exercise_max_history` exists and can store training max, working weight, implied max, and source session/set context.
- Existing private session rows survive migration and backfill `status` from the existing `completed` flag.
- Running migrations twice is idempotent.

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/db/__tests__/db.test.ts`

Expected: FAIL because the new history/session fields do not exist.

**Step 3: Implement storage changes**

Add idempotent migrations for session/version/skip fields:

```ts
addColumn(db, "sessions", "status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed','skipped'))");
addColumn(db, "sessions", "skipped_at TEXT");
addColumn(db, "sessions", "skip_reason TEXT NOT NULL DEFAULT ''");
addColumn(db, "sessions", "shared_program_version_id INTEGER REFERENCES shared_program_versions(id)");
```

Add the same fields to fresh `schema.sql`.

After adding `sessions.status`, run an idempotent backfill:

```sql
UPDATE sessions
SET status = CASE WHEN completed = 1 THEN 'completed' ELSE 'in_progress' END
WHERE status = 'in_progress';
```

This preserves old completed history while giving unfinished sessions a runnable state.

Add:

```sql
CREATE TABLE IF NOT EXISTS exercise_max_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id INTEGER REFERENCES exercises(id) ON DELETE SET NULL,
  shared_program_id INTEGER REFERENCES shared_programs(id) ON DELETE CASCADE,
  shared_exercise_key TEXT,
  session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  session_set_id INTEGER REFERENCES session_sets(id) ON DELETE SET NULL,
  training_max REAL,
  working_weight REAL,
  actual_reps INTEGER,
  implied_max REAL,
  source TEXT NOT NULL CHECK(source IN ('sync','manual','set','progression','import')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Use this as durable facts for future charts and analytics; do not build chart UI in this task.

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/db/__tests__/db.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/db/migrations.ts src/lib/db/schema.sql src/lib/db/__tests__/db.test.ts
git commit -m "feat: add workout history storage"
```

---

### Task 5: Add Materialize, Sync, Expected Max, And Rollback Logic

**Files:**
- Create: `src/features/shared-programs/sync.ts`
- Test: `src/features/shared-programs/sync.test.ts`

**Step 1: Write failing tests**

Cover:

- Applying a first version creates a private runnable program.
- Applying a newer version updates the private program structure.
- Training maxes are preserved by `shared_exercise_key`.
- Expected maxes are written to `exercise_max_history` when applied during sync.
- Reordered days/exercises update `sort_order` while preserving stable keys.
- Removed exercises are archived instead of hard-deleted when they have session history.
- New exercises require expected maxes.
- Expected max gauges include other members' maxes.
- Rollback applies an earlier version and records action `rollback`.
- Rollback preserves historical sessions and their shared version context.
- Sync is transactional if expected max input is invalid.

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/features/shared-programs/sync.test.ts`

Expected: FAIL.

**Step 3: Implement sync functions**

Export:

- `getSharedProgramSyncReview({ sharedProgramId, userId, targetVersionId })`
- `applySharedProgramVersion({ sharedProgramId, userId, targetVersionId, expectedMaxes })`
- `rollbackSharedProgramVersion({ sharedProgramId, userId, targetVersionId, expectedMaxes })`
- `getExpectedMaxGauge({ sharedProgramId, sharedExerciseKey, userId })`

Rules:

- If no local private program exists, create one.
- If it exists, update program name/description/week count and active version.
- Match days by `shared_day_key`.
- Match exercises by `shared_exercise_key`.
- Preserve `exercises.training_max` when an exercise key already exists.
- Use supplied expected max for new exercises.
- Record expected max changes in `exercise_max_history` with `source = 'sync'`.
- Archive removed days/exercises with `archived_at = datetime('now')`.
- Create future `week_settings` from the target snapshot.
- Do not mutate completed sessions or session sets.
- Do not mutate skipped sessions.

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/features/shared-programs/sync.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/shared-programs/sync.ts src/features/shared-programs/sync.test.ts
git commit -m "feat: sync shared programs into personal workouts"
```

---

### Task 6: Add Shared Program API Routes

**Files:**
- Create: `src/app/api/shared-programs/route.ts`
- Create: `src/app/api/shared-programs/[id]/route.ts`
- Create: `src/app/api/shared-programs/[id]/members/route.ts`
- Create: `src/app/api/shared-programs/[id]/versions/route.ts`
- Create: `src/app/api/shared-programs/[id]/sync-review/route.ts`
- Create: `src/app/api/shared-programs/[id]/sync/route.ts`
- Create: `src/app/api/shared-programs/[id]/rollback/route.ts`
- Create: `src/app/api/programs/[id]/skip-workout/route.ts`
- Test: `src/app/api/shared-programs/shared-program-routes.test.ts`
- Test: `src/app/api/sessions/session-routes.test.ts`

**Step 1: Write failing route tests**

Cover:

- Unauthenticated requests return `401`.
- Owner creates shared program from snapshot.
- Owner/admin publishes versions.
- Member can fetch sync review.
- Member can apply sync with expected maxes.
- Member can rollback.
- Member cannot publish.
- Non-member cannot read/apply.
- Skipping a workout records a skipped session with program/day/week/shared-version context and does not apply progression.

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/app/api/shared-programs/shared-program-routes.test.ts`

Expected: FAIL.

**Step 3: Implement routes**

Use existing helpers from `src/lib/api.ts`, `requireUser()`, and the repository/sync functions.

Keep JSON bodies explicit:

- Create: `{ name, description, snapshot }`
- Add member: `{ userId, role }`
- Publish: `{ snapshot }`
- Sync: `{ targetVersionId, expectedMaxes }`
- Rollback: `{ targetVersionId, expectedMaxes }`
- Skip workout: `{ dayId, reason? }`

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/app/api/shared-programs/shared-program-routes.test.ts src/app/api/sessions/session-routes.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/app/api/shared-programs src/app/api/programs/[id]/skip-workout/route.ts src/app/api/shared-programs/shared-program-routes.test.ts src/app/api/sessions/session-routes.test.ts
git commit -m "feat: add shared program api"
```

---

### Task 7: Add Default Program Library And Start Flow

**Files:**
- Create: `src/features/program-defaults/types.ts`
- Create: `src/features/program-defaults/defaults.ts`
- Create: `src/features/program-defaults/defaults.test.ts`
- Modify: `src/components/CreateProgramForm.tsx`
- Modify: `src/app/programs/new/page.tsx`
- Test: `src/components/CreateProgramForm.test.tsx`

**Step 1: Write failing tests**

Cover:

- Default programs expose stable keys and valid shared snapshots.
- Create program form lists defaults.
- Starting from a default sends selected default snapshot/name/week count.
- A loaded default or existing shared version can be saved as a new program.
- A loaded shared definition can be saved as a published update when the user is an admin.

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/features/program-defaults/defaults.test.ts src/components/CreateProgramForm.test.tsx`

Expected: FAIL.

**Step 3: Implement defaults**

Start with two conservative defaults:

- `basic-strength-3-day`: Lower / Upper / Full Body with common main lifts.
- `sbs-hypertrophy-4-day`: four days using the existing SBS training template defaults.

Do not overbuild a marketplace yet. Keep defaults local, versioned, and open-source friendly.

**Step 4: Update create flow**

Let the user choose:

- Blank program.
- Basic Strength 3-Day.
- SBS Hypertrophy 4-Day.

Creating from a default can initially create a private runnable program. The form should preserve stable day/exercise keys so the same loaded structure can later be saved as a new shared program or published as an update.

Support reordering lifts within a day in the edit payload/model used by defaults. UI controls can remain minimal in this task, but the data shape and tests should prove order is represented by `sort_order`/snapshot order.

**Step 5: Run test to verify it passes**

Run: `npm run test -- src/features/program-defaults/defaults.test.ts src/components/CreateProgramForm.test.tsx`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/features/program-defaults src/components/CreateProgramForm.tsx src/app/programs/new/page.tsx src/components/CreateProgramForm.test.tsx
git commit -m "feat: add default workout programs"
```

---

### Task 8: Add Shared Program UI For Publish, Members, Review, And Rollback

**Files:**
- Modify: `src/app/programs/[id]/page.tsx`
- Create: `src/app/shared-programs/[id]/sync/page.tsx`
- Create: `src/components/SharedProgramPanel.tsx`
- Create: `src/components/SharedProgramSyncReview.tsx`
- Test: `src/components/SharedProgramPanel.test.tsx`
- Test: `src/components/SharedProgramSyncReview.test.tsx`

**Step 1: Write failing component tests**

Cover:

- Owner/admin sees publish and member controls.
- Member sees update available and sync review link.
- Non-shared private programs do not show shared controls.
- Sync review renders day/exercise/template changes.
- Expected max inputs show gauges from other members.
- Rollback options are visible when previous applied versions exist.
- Reordered lifts are visible in sync review as order changes.
- Admins can load an existing shared version, make changes, and publish it as an update rather than only creating a new program.

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/SharedProgramPanel.test.tsx src/components/SharedProgramSyncReview.test.tsx`

Expected: FAIL.

**Step 3: Implement UI**

Keep admin controls secondary on program setup pages. Use compact panels; do not make setup visually dominate workout execution.

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/components/SharedProgramPanel.test.tsx src/components/SharedProgramSyncReview.test.tsx`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/app/programs/[id]/page.tsx src/app/shared-programs src/components/SharedProgramPanel.tsx src/components/SharedProgramSyncReview.tsx src/components/SharedProgramPanel.test.tsx src/components/SharedProgramSyncReview.test.tsx
git commit -m "feat: add shared program sync ui"
```

---

### Task 9: Make Workout Execution First-Class On Today

**Files:**
- Modify: `src/app/today/page.tsx`
- Modify: `src/components/WorkoutCard.tsx`
- Test: `src/components/WorkoutCard.test.tsx`

**Step 1: Write failing tests**

Cover:

- Today card shows week/day and current workout focus.
- Primary action says `Start workout` or `Continue workout`.
- Sync available state appears when a linked shared program has a newer version.
- Setup/edit links are secondary.
- Completing a workout still advances the program.
- Workout card has a `Skip` action for days the user cannot complete.
- Skipping logs a skipped workout and leaves training max progression unchanged.
- Session/set saves record enough data for working-weight and implied-max history.
- Workout display includes the shared version context when available.

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/WorkoutCard.test.tsx`

Expected: FAIL for the new text/states.

**Step 3: Implement UI polish**

Update card hierarchy:

- Stronger heading: current day first, program second.
- Prominent load prescription once session starts.
- Larger primary action.
- Secondary `Skip` action with optional reason.
- Sync prompt as a small warning/notice above start.
- Keep all controls within mobile-safe widths.

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/components/WorkoutCard.test.tsx`

Expected: PASS.

**Step 5: Browser visual check**

Run dev server and capture `/today` at desktop and mobile widths. Verify no horizontal overflow, no text overlap, no console errors.

**Step 6: Commit**

```bash
git add src/app/today/page.tsx src/components/WorkoutCard.tsx src/components/WorkoutCard.test.tsx
git commit -m "feat: prioritize workout execution"
```

---

### Task 10: Documentation And Contributor Notes

**Files:**
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Create: `docs/shared-programs.md`

**Step 1: Write docs**

Document:

- Shared definition vs personal state.
- Admin/member roles.
- Publishing versions.
- Sync review and rollback.
- Expected max gauges.
- Adding open-source default programs.
- Lift history, implied maxes, working-weight tracking, and workout-version history.
- Reordering lifts.
- Skipped workout behavior.

**Step 2: Verify docs links**

Run: `rg -n "shared program|default program|training template" README.md CONTRIBUTING.md docs/shared-programs.md`

Expected: links and section names are present.

**Step 3: Commit**

```bash
git add README.md CONTRIBUTING.md docs/shared-programs.md
git commit -m "docs: document shared program workflows"
```

---

### Task 11: Full Verification

**Files:**
- No planned edits.

**Step 1: Run all checks**

```bash
npm run test
npm run test:coverage
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev
```

Expected:

- All tests pass.
- Coverage thresholds pass.
- Typecheck passes.
- Lint passes.
- Build passes.
- Audit reports 0 vulnerabilities.

**Step 2: Browser smoke**

Verify:

- Register/login.
- Create from default.
- Create shared program.
- Add member/admin if local test users exist.
- Publish v1.
- Apply sync for a member with expected max.
- Publish v2 with a renamed exercise.
- Publish v3 with reordered lifts.
- Member review preserves expected max by stable key.
- Workout history records shared version.
- Skip workout is logged and visible in history.
- Rollback returns structure to prior version.
- `/today` emphasizes workout execution.

**Step 3: Commit fixes if needed**

If verification requires fixes, commit them with focused messages.

**Step 4: Finish branch**

Use `superpowers:requesting-code-review`, then `superpowers:finishing-a-development-branch`.
