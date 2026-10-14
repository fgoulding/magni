# Quiet workout summaries

## Scope and decision

Remove the visible Progression section from both the immediate planned-workout
completion card and Today's persisted recap. Keep performed-work summaries and
personal records. Completion still evaluates and saves progression; configuration,
history corrections, API responses and future prescriptions are unchanged.

Fetched baseline: `27140e1ae4ba993492228ac45d48ed6ba5a7a65f`, matching
`origin/main`. Reuse the clean `unified-exercise-cards` worktree on
`codex/quiet-workout-summary`; preserve unrelated files in the primary checkout.

## Ownership and checks

- Coordinator: source cleanup, existing test updates, runtime, Git and release.
- Independent verification agent: audit both render paths and review the patch;
  no shared-file edits or runtime operations.
- Remove UI-only progression state, response typing and Today database query.
- Adapt the existing completion assertions; retain the progression workflow's
  hold, increment, retry and next-prescription checks.
- Inspect completed iPhone 13 mini and iPhone 16 viewport screenshots, including
  the persisted recap after reload.
- Run focused tests, typecheck and lint; require all configured CI release gates,
  immutable-image staging, populated backup/restore and guarded promotion.

## Evidence

- Read-only audit found exactly two summary panels. No backend changes needed.
- Removed both panels and display-only dependencies; no API/schema changes.
- Existing unit assertion failed against the old panel, then all 39 focused
  WorkoutCard/editor/superset/Today tests passed. Typecheck and lint passed.
- All six targeted Chromium/WebKit cases passed without retries: progression
  hold/increment/recovery and Today/Quick workout layouts. Inspected completed
  WebKit captures at 393px and 375px after reload: clear performed-work recap,
  no Progression section, no overflow or nested scrolling.
- Independent read-only review found no actionable issues.
- CI, staging and promotion receipts are recorded privately under
  `.playwright/quiet-workout-summary/release/`; release remains pending until
  those receipts pass. Physical-device testing is separate from WebKit emulation.
