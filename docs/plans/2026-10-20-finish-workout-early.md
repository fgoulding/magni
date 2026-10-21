# Finish workouts early

**Goal:** Let a lifter finish when time runs out without logging unperformed work
or losing acknowledged results.

**Architecture:** Keep the existing completion endpoints and progression engine.
Separate ordinary pending set inputs from recovery states. Finish stays available
for ordinary unsaved set inputs and asks for explicit confirmation before using
only server-saved results. Preserve drafts until completion and its authoritative
result are acknowledged. Legacy incomplete lifts finish with no progression change.

**Tech stack:** React client components, native dialog, Next.js route handlers,
SQLite, Vitest and Playwright. No schema migration.

## Baseline and diagnosis

Fetched `origin/main`; existing worktree `codex/quiet-superset-logging` matches
`7ebc4d9314669f03da251ff3e32fabad62ef61aa` (0/0), with a clean worktree. Preserve the
primary checkout's four unrelated personal-product plan files.

Untouched unlogged sets already support partial completion. Editing later weights
or reps creates pending drafts which disable Finish in both WorkoutCard and
QuickWorkout. Quick has no ordinary per-row discard action. Separately, legacy
completion rejects wholly unlogged automatic-progression lifts and may substitute
an earlier recorded working set for a missing final AMRAP.

The requested bug fix and standing authorization cover implementation and release;
no further design approval is needed. The chosen confirmation keeps intentional
abandonment explicit while avoiding automatic saving of displayed prescriptions.

## Behavior

- Ordinary unfinished sets remain unperformed, with null actuals and no invented
  reps/weight/volume. Saved sets remain unchanged.
- Ordinary pending inputs no longer disable Finish. They open a compact native
  dialog: **Finish with saved sets?**, **Keep training**, **Finish with saved sets**.
  Explain that saved sets are kept and unsaved edits are discarded; no extra
  routine UI clutter. Cancel/Escape preserve inputs and return focus to Finish.
- Active requests, unresolved Undo/conflicts/failed saves and Quick structural
  changes keep their existing safety guards. Pending Undo remains persisted.
- Persisted ordinary drafts cannot prove whether a prior save reached the server.
  Completion uses authoritative server actuals. Quick's completion recap already
  supplies them; the planned early-finish path must reload canonical session actuals
  after completion acknowledgement before showing its recap/clearing drafts.
  If completion/result retrieval fails, retain drafts and support an idempotent
  finish retry. Never send set PUTs merely to finish early.
- Preserve normal untouched partial finish and fully logged finish behavior.
- Legacy completion holds automatic progression for incomplete exercises; only
  fully recorded legacy exercises progress. Remove the missing-AMRAP completion
  rejection, preserve null actuals and transaction/idempotency/ownership guards.
  Editor-authored partial policies remain unchanged. Missing-template handling
  continues for fully logged lifts requiring that rule, not unfinished held lifts.

## Ownership and sequence

1. Frontend owns WorkoutCard.tsx, QuickWorkout.tsx, a shared finish confirmation
   component if appropriate, and related component tests. First demonstrate the
   pending-input block with failing tests, then implement. Cover cancel, success,
   failure/retry, saved-row edits, recovered uncertain save, guards and focus.
2. Backend owns complete-and-advance/route.ts and session-routes.test.ts (plus a
   narrowly necessary completion test file only). Demonstrate legacy rejection
   and partial AMRAP substitution, then preserve saved data and hold partial lifts.
3. Coordinator owns browser tests, design-system guidance, this plan, test runtime,
   Git and release. Add planned superset and Quick early-finish regressions with
   actual saved-count/volume assertions; review 375/393px and enlarged text.
4. Independent verifier reviews contracts/source/evidence after implementation.
   Resolve findings before integration; no shared test server ownership.

## Gates and evidence

Focused red/green checks, affected browser workflows in Chrome/WebKit, full unit
coverage, lint, typecheck and production build. Preserve evidence in ignored
`.playwright/finish-workout-early/`. Publish only after exact-commit CI passes;
verify immutable-image staging and populated preservation/rollback before guarded
promotion. Restore the updater and check public readiness. Browser emulation is
separate from physical-iPhone evidence.

## Implementation and verification

- Frontend RED reproduced the disabled Finish action in planned and Quick flows;
  final focused checks passed 129 cases including 22 new finish regressions.
  Failed-save state now survives subsequent typing until explicit recovery.
- Backend RED reproduced the unlogged rejection, progression from incomplete
  lifts and unnecessary missing-rule rejection. The route now holds unfinished
  legacy lifts; 117 focused checks passed. Existing progression fixtures now log
  all their sets before expecting progression. No schema/API change.
- Initial full coverage found three stale assertions expecting Finish disabled
  after an acknowledged Undo. Tests now distinguish in-flight Undo (blocked)
  from its subsequent ordinary edit (confirmation allowed), preserving null
  optimistic-write baselines. Full rerun: 1,227 tests / 131 files passed;
  coverage gates passed. Typecheck passed after a fixture-only category lookup fix.
- Initial new browser checks passed Quick in both engines. Planned checks also
  completed successfully but exposed a test selector expecting the inline recap
  instead of Today's refreshed `Workout complete today`; corrected the selector
  and strengthened exact saved-volume and draft-clear assertions. Retain both
  attempts in `.playwright/finish-workout-early/`.
- Coordinator and independent verifier inspected 375px light and 393px dark
  WebKit screenshots with 20px text; confirmation fits without clipping. Source,
  contracts and prepared release helpers independently reviewed with no blockers.
- A disposable browser server timed out before running cases; the unchanged
  suite started normally with diagnostics. Its 36 passing cases included both new
  workflows in Chrome/WebKit. Two Quick recovery cases still asserted the old
  disabled state before any save failure; updated them to exercise confirmation
  cancel plus the actual failed-save guard. Both reruns passed: 38 unique affected
  cases, zero retries. Preserve failed-attempt evidence; no timeout increases.
- Final lint/typecheck and the fixture lookup's seven backend cases passed.
  Re-fetched `origin/main`: still 0/0 against baseline before integration.
- Production build passed. Exact-commit CI/staging/live receipts will be retained
  in `.playwright/finish-workout-early/release-evidence.json`; release only after
  those remaining gates and updater restoration.
