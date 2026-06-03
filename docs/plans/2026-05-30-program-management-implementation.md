# Program Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split program management into a clearer Active Runs + Program Library experience, starting with a schedule bridge that preserves custom programs.

**Architecture:** Implement this incrementally. First add schedule support to the current `programs` table so Today can become schedule-aware. Then redesign the Programs screen around Active Runs and Library. After that, introduce true `program_definitions` and `program_runs` tables and migrate existing programs without breaking current workout execution.

**Tech Stack:** Next.js App Router, React client components, TypeScript, better-sqlite3, Vitest, Testing Library, Tailwind CSS.

---

### Task 1: Add Weekday Schedule Bridge To Current Programs

**Files:**
- Modify: `src/lib/db/schema.sql`
- Modify: `src/lib/db/migrations.ts`
- Test: `src/lib/db/__tests__/db.test.ts`

**Step 1: Write the failing test**

Add a database schema test that verifies `programs` has:

- `schedule_weekdays TEXT NOT NULL DEFAULT '[]'`
- `schedule_mode TEXT NOT NULL DEFAULT 'unscheduled'`

The test should also create a legacy in-memory schema without these columns, run `runMigrations`, and assert the columns exist with defaults.

**Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/lib/db/__tests__/db.test.ts
```

Expected: FAIL because columns do not exist.

**Step 3: Write minimal implementation**

In `schema.sql`, add:

```sql
schedule_weekdays TEXT NOT NULL DEFAULT '[]',
schedule_mode TEXT NOT NULL DEFAULT 'unscheduled' CHECK(schedule_mode IN ('unscheduled','scheduled'))
```

In `migrations.ts`, add idempotent columns:

```ts
addColumn(db, "programs", "schedule_weekdays TEXT NOT NULL DEFAULT '[]'");
addColumn(
  db,
  "programs",
  "schedule_mode TEXT NOT NULL DEFAULT 'unscheduled' CHECK(schedule_mode IN ('unscheduled','scheduled'))",
);
```

**Step 4: Run test to verify it passes**

Run:

```bash
npm run test -- src/lib/db/__tests__/db.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/db/schema.sql src/lib/db/migrations.ts src/lib/db/__tests__/db.test.ts
git commit -m "feat: add program schedule bridge"
```

### Task 2: Add Schedule API Support

**Files:**
- Modify: `src/app/api/programs/[id]/route.ts`
- Test: `src/app/api/programs/program-routes.test.ts`

**Step 1: Write the failing tests**

Add tests for program update:

- PUT with `{ scheduleWeekdays: [0, 2, 4] }` stores `schedule_weekdays` as JSON and `schedule_mode` as `scheduled`.
- PUT with `{ scheduleWeekdays: [] }` stores `[]` and `unscheduled`.
- Invalid weekdays like `[-1]`, `[7]`, duplicate values, or non-integers return 400.

**Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/app/api/programs/program-routes.test.ts
```

Expected: FAIL because route ignores schedule fields.

**Step 3: Write minimal implementation**

In `src/app/api/programs/[id]/route.ts`, parse optional `scheduleWeekdays`.

Validation:

```ts
function parseScheduleWeekdays(value: unknown): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("scheduleWeekdays must be an array");
  const weekdays = value.map(Number);
  if (
    weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
    new Set(weekdays).size !== weekdays.length
  ) {
    throw new Error("scheduleWeekdays must contain unique weekdays from 0 to 6");
  }
  return weekdays.sort((a, b) => a - b);
}
```

When supplied, update:

```sql
schedule_weekdays = ?,
schedule_mode = ?
```

Mode is `scheduled` when length > 0, otherwise `unscheduled`.

**Step 4: Run test to verify it passes**

Run:

```bash
npm run test -- src/app/api/programs/program-routes.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/app/api/programs/[id]/route.ts src/app/api/programs/program-routes.test.ts
git commit -m "feat: update program schedules"
```

### Task 3: Make Today Schedule-Aware

**Files:**
- Modify: `src/app/today/page.tsx`
- Test: `src/app/api/programs/program-routes.test.ts` or create `src/app/today/today-page.test.tsx` if project pattern allows direct page tests.

**Step 1: Write the failing test**

Seed three active programs:

- One scheduled for today.
- One scheduled for another weekday.
- One unscheduled.

Assert the Today page text includes scheduled-today first, excludes other scheduled program from the primary list, and includes unscheduled only in an "Other active runs" section if implemented in this task.

**Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/app/api/programs/program-routes.test.ts
```

Expected: FAIL because Today currently lists all active programs.

**Step 3: Write minimal implementation**

In `today/page.tsx`:

- Compute current local weekday using `new Date().getDay()`.
- Select active, non-archived programs and parse `schedule_weekdays`.
- Split rows:
  - scheduledToday
  - overdueOrUnscheduled
  - otherScheduled
- Render scheduledToday first.
- Render unscheduled active runs under "Other active runs".
- Do not render other scheduled runs as primary cards.

Keep query simple and parse in TypeScript first. No calendar engine yet.

**Step 4: Run test to verify it passes**

Run:

```bash
npm run test -- src/app/api/programs/program-routes.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/app/today/page.tsx src/app/api/programs/program-routes.test.ts
git commit -m "feat: show scheduled workouts on today"
```

### Task 4: Redesign Programs Screen Into Active Runs And Library

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/BottomNav.tsx`
- Test: add direct page coverage in existing route/page test file if available.

**Step 1: Write the failing test**

Seed:

- Active scheduled program.
- Active unscheduled program.
- Inactive custom program.

Render the Programs page and assert:

- Text contains `Active Runs`.
- Text contains `Library`.
- Active programs appear under Active Runs with weekday labels.
- Inactive custom program appears under Library.

**Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/app/api/programs/program-routes.test.ts
```

Expected: FAIL because current page is one flat list.

**Step 3: Write minimal implementation**

In `page.tsx`:

- Rename main heading to `Programs`.
- Split programs into:
  - `activePrograms`: `is_active = 1`
  - `libraryPrograms`: everything non-archived
- Active cards show:
  - program name
  - Week/Day
  - weekday chips derived from `schedule_weekdays`
  - next action link to `/today` or edit link.
- Library cards show:
  - program name
  - source badge placeholder: `Custom`
  - actions: Edit, Start/Pause via existing active toggle.

In `BottomNav.tsx`, order tabs:

```ts
[
  { href: "/today", label: "Today" },
  { href: "/", label: "Programs" },
  { href: "/history", label: "History" },
  { href: "/settings", label: "Settings" },
]
```

**Step 4: Run test to verify it passes**

Run:

```bash
npm run test -- src/app/api/programs/program-routes.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/app/page.tsx src/components/BottomNav.tsx src/app/api/programs/program-routes.test.ts
git commit -m "feat: split programs into active runs and library"
```

### Task 5: Add Schedule Editing UI

**Files:**
- Create: `src/components/ProgramScheduleForm.tsx`
- Test: `src/components/ProgramScheduleForm.test.tsx`
- Modify: `src/app/programs/[id]/page.tsx`

**Step 1: Write the failing component tests**

Test:

- Form renders seven weekday toggle buttons.
- Clicking Sunday/Tuesday/Thursday and saving sends `{ scheduleWeekdays: [0, 2, 4] }`.
- Clearing all days sends `{ scheduleWeekdays: [] }`.
- API errors show `ErrorBanner`.

**Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/components/ProgramScheduleForm.test.tsx
```

Expected: FAIL because component does not exist.

**Step 3: Write minimal implementation**

Create client component:

```tsx
"use client";

const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];
```

Use button toggles with `aria-pressed`. Save via existing PUT endpoint.

Add it to program detail near Program tracking.

**Step 4: Run test to verify it passes**

Run:

```bash
npm run test -- src/components/ProgramScheduleForm.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/ProgramScheduleForm.tsx src/components/ProgramScheduleForm.test.tsx src/app/programs/[id]/page.tsx
git commit -m "feat: edit program schedule weekdays"
```

### Task 6: Improve New Program Creation UX Without New Tables

**Files:**
- Modify: `src/components/CreateProgramForm.tsx`
- Test: `src/components/CreateProgramForm.test.tsx`
- Modify: `src/app/programs/new/page.tsx`

**Step 1: Write the failing tests**

Test:

- Source choice is rendered as segmented buttons or cards, not a plain select.
- Blank custom program path remains available.
- Default template preview shows days/exercise count before creation.
- Expected max fields still appear for selected templates.

**Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/components/CreateProgramForm.test.tsx
```

Expected: FAIL against current select-based UI.

**Step 3: Write minimal implementation**

Replace `select` with a compact card/segmented source picker:

- Blank Custom
- Loaded Definition if present
- Default Templates list

Show a preview block:

- `N weeks`
- `N days`
- `N lifts`

Keep submit payload unchanged.

**Step 4: Run test to verify it passes**

Run:

```bash
npm run test -- src/components/CreateProgramForm.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/CreateProgramForm.tsx src/components/CreateProgramForm.test.tsx src/app/programs/new/page.tsx
git commit -m "feat: improve custom program creation flow"
```

### Task 7: Introduce Program Definitions And Runs Tables

**Files:**
- Modify: `src/lib/db/schema.sql`
- Modify: `src/lib/db/migrations.ts`
- Test: `src/lib/db/__tests__/db.test.ts`

**Step 1: Write failing migration tests**

Test:

- New tables exist.
- Existing program rows are migrated into one definition plus one run.
- Custom programs become `source_type = 'custom'`.
- Current `programs.id` remains usable during bridge phase.

**Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/lib/db/__tests__/db.test.ts
```

Expected: FAIL because tables do not exist.

**Step 3: Write minimal implementation**

Create tables:

- `program_definitions`
- `program_definition_days`
- `program_definition_exercises`
- `program_definition_week_settings`
- `program_runs`
- `program_run_schedule_days`
- `program_run_expected_maxes`

Also add bridge columns to `programs`:

- `definition_id`
- `run_id`

Migration should copy current data into definition/run tables and backfill bridge ids.

**Step 4: Run test to verify it passes**

Run:

```bash
npm run test -- src/lib/db/__tests__/db.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/db/schema.sql src/lib/db/migrations.ts src/lib/db/__tests__/db.test.ts
git commit -m "feat: add program definitions and runs"
```

### Task 8: Full Verification

**Files:**
- All touched files.

**Step 1: Run full tests**

```bash
npm run test
```

Expected: all tests pass.

**Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

**Step 3: Run lint**

```bash
npm run lint
```

Expected: exit 0.

**Step 4: Run build**

```bash
npm run build
```

Expected: exit 0.

**Step 5: Visual check**

Use Browser plugin against local app:

- `/`
- `/today`
- `/programs/new`
- `/programs/:id`

Check mobile viewport first. Verify no text overlap, schedule chips fit, and workout execution remains more prominent than setup.

**Step 6: Commit any verification-only fixes**

```bash
git status --short
git add <files>
git commit -m "fix: polish program management flow"
```
