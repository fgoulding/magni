# Workout dates, movement and quieter defaults

User request: restore scheduled-workout movement, show early/late starts on the
day actually trained, and remove coaching notes from Full Body Supersets 3-Day.

Baseline: `c0154225c4015f7ef87adb33849d72e4c1e6b71e`, freshly fetched and equal
to origin/main. Reuse the clean unified-exercise-cards checkout on
`codex/workout-dates-and-notes`. Preserve four unrelated primary-checkout plans.

## Findings and decisions

- New planned sessions already store the account-local current date. Active
  calendar/Today projections incorrectly prefer the scheduled date; completed
  sessions use the performed date. Correct active projections without rewriting
  original scheduling or historical prescriptions.
- Active workouts lose all calendar Move/drag controls, and the service rejects
  them. Allow deliberate movement of unfinished workouts with revision checks,
  preserved identity/sets and safe undo; keep completed/skipped records protected.
- The selected-workout dialog has no Move action, making Month view a dead end
  for rescheduling. Add the same date picker there.
- Remove default coaching prose at its source. Keep exercise choices, superset
  pairs, sets, rep ranges, effort/rest/tempo and optional note support intact.
  Versioned active programs and recorded session prescriptions remain frozen.

## Ownership

- Coordinator: default template content, matching content assertions, browser
  workflow regressions, runtime, screenshots, integration and guarded release.
- Frontend: CalendarAgenda, CalendarPage/modal, relevant client components and
  component tests; no backend/template edits.
- Backend: occurrence/session dates, calendar mutation contracts and backend
  regression tests; no CalendarPage/client/template edits.
- Independent verification: review final code and acceptance evidence read-only.

## Acceptance and evidence

- [x] Scheduled and active workouts offer Move in week and selected Month dialog.
- [x] Starting tomorrow's or an overdue workout displays once on account-local
  today, including cross-month boundaries; Today, Calendar and History agree.
- [x] Refresh, retry and resume preserve the same session/occurrence and date.
- [x] Move preserves prescriptions, actual sets and original scheduled date;
  ownership, stale revisions, occupied dates and undo remain safe.
- [x] Default template has no coaching notes; custom notes still compile.
- [x] Focused regressions, typecheck, lint and independent review pass.
- [x] Actual iPhone-size WebKit screenshots inspected (375px and 393px).
- [ ] Full release gates, immutable-image staging and populated backup/restore
  checks pass before promotion; verify public live revision after rollout.

Physical iPhone checks are separate from WebKit emulation. Private runtime and
release receipts belong under `.playwright/workout-dates-and-notes/`.

## Implementation evidence

- Backend reproduced three date-projection failures and three active-move
  failures before fixing them. Fifty focused tests pass, covering timezone/date
  boundaries, retry, ownership, occupied dates, saved sets and undo after edits.
- Seventeen template/default tests pass. The content rehearsal also passes
  save/activate/start/complete retries and integrity checks. Its precommit receipt
  is diagnostic only and cannot publish content.
- Default catalog is bundled revision 1 on live with no overriding current
  pointer; the new bundled revision 2 will therefore be visible after release.
  Existing user copies remain frozen, including any previously copied notes.
- Active Move captures the current session revision when the picker opens,
  then retains it for submission/retry. This allows moving directly after a
  local set save while rejecting edits made after the picker was opened.
- Typecheck and lint passed during integration; final checks follow the stable
  source handoff.
- Full local suite: 130 files / 1,180 tests pass with configured coverage.
  Initial WebKit run: 13 existing workflows pass; two new early-start flows
  exposed stale Calendar navigation. Month links omit `date`, which the saved
  return-link sanitizer requires; its external-store snapshot also listens only
  to popstate. The start handler must use the current Calendar location rather
  than the cached history-return link. Regression covers direct Month start and
  start after a prior Move.
- The navigation fix has two additional failing-then-passing component cases;
  65 focused tests pass afterward. The final WebKit rerun passes both complete
  375px/393px workflows through saved-set movement, reload and completion.
  An intervening test-only failure was an immediate `goto` racing the Close
  navigation; the test now waits for Close and uses the visible Week selector.
- Independent source and visual reviews pass. Inspected screenshots cover
  the full date picker and active workouts at both phone widths, with light/dark
  themes. This is WebKit emulation, not a physical-device claim.
- First CI run `39370304516` passed the new date workflows but blocked release
  on an interrupted-activation Safari retry. Its trace exposed a separate real
  race: a pending autosave ran after manual save and erased the activation
  failure without writing anything. Cancel that timer when save begins.
  A fake-timer regression fails before the correction and passes after it,
  verifying the error persists and retry uses the same draft revision.
  Independent review confirms save serialization is preserved. The original
  browser assertion and all release gates remain unchanged.
- The correction passes 43 workspace/builder component tests, typecheck and
  focused lint; the original Safari activation workflow passes three consecutive
  runs with zero retries.
