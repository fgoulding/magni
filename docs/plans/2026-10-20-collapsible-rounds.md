# Collapsible superset rounds

**Goal:** Reduce round-level visual noise while letting a lifter inspect or hide
completed work without changing what is logged.

**Design:** Remove the round save/undo check. Make the full Round N heading a
44px disclosure button with a quiet saved fraction and chevron. All rounds start
open. Collapse is manual and independent of saving; reopening never unlogs sets.
Keep individual set checks, interleaved labels, targets and numeric controls.
Keep hidden inputs mounted, and show exercise names plus pending/error/conflict
feedback in the closed summary. No automatic collapse or scrolling.

This follows the user's preference for a quieter round header and resolves their
concern that reopening should not require unchecking completed work. Keeping the
bulk check would retain the noise they identified; tying disclosure to completion
would combine two different actions.

Designer review agrees with the [WAI disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/):
a native button with expanded state controls visibility, while a checkbox denotes
checked state. Follow [Apple disclosure guidance](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls)
for a descriptive label beside its content. Hidden round contents leave keyboard
navigation while their DOM nodes and drafts remain mounted.

Baseline `9c856cd` matches fetched `origin/main`. Reuse the active worktree and
preserve unrelated plans in the primary checkout. No API, data or schema changes.

## Ownership and sequence

1. Designer: primary-source disclosure guidance and read-only visual review.
2. Frontend: WorkoutCard, lightweight SupersetRoundCard and related unit tests.
   Demonstrate missing disclosure behavior before implementation; adapt old bulk
   interaction tests to individual saves while retaining recovery coverage.
3. Coordinator: browser workflows, design-system update, runtime and release.
   Verify collapse/reopen makes no writes, preserves edited values and saved sets,
   and retains recovery behavior across reload and Calendar resume.
4. Independent verifier: source and actual phone renders at 375px, 393px and
   enlarged text. Coordinator resolves findings and runs required release gates.

## Acceptance

- Round headers toggle visibility only; bulk round checks are absent.
- Individual saves/undo still preserve actuals, identity and retry semantics.
- Completed and incomplete rounds can be inspected without altering records.
- Hidden drafts, failures and conflicts remain discoverable from the header.
- Inputs remain mounted, and saving never collapses or scrolls the round.
- Phone targets, names, labels and enlarged text remain readable without overflow.
- CI, immutable-image staging, backup/rollback and public readiness pass before
  claiming the change is live.

## Review and evidence

- Disclosure regressions failed before implementation, then passed: all rounds
  initially open; manual visibility changes preserve mounted inputs and drafts;
  reopening saved work does not write or undo; saving never closes a round.
- Independent review found fully saved rounds could inherit a whole-lift skipped
  marker. Reproduced with a partially completed superset, then fixed so only
  rounds with unlogged members say "Remaining sets skipped." Recovery feedback
  keeps precedence. The focused component suite passed 68 tests after this fix.
- Designer inspected eight actual WebKit renders: open/closed at 375px, 393px,
  enlarged 20px text and 1280px desktop. No visual blockers. Headers, inline
  targets and individual controls remain readable; enlarged controls wrap safely.
- Browser coverage checks Today and Calendar resume, individual saves/undo,
  decimal loads, unequal rounds, three-member groups, no-write collapse/reopen,
  retained drafts, response-loss retries and conflicts exposed in closed headers.
- The first full coverage run exposed an existing history-review focus race:
  rendered review text can precede its focus effect. The test now waits for the
  exact focused review panel in both equivalent branches, without weakening the
  assertion, adding sleeps, or changing production history behavior.
- Final local checks passed: 1,193 tests across 130 files, required coverage
  thresholds (87.48% statements, 81.34% branches, 94.23% functions, 90.73% lines),
  typecheck, full lint, production build and diff checks. Eight targeted WebKit
  workflows passed; the three changed superset/guidance cases were rerun after
  updating the now-ambiguous outer collapse locator. Fresh enlarged collapsed
  renders include the complete header and retain readable layout.
- Private evidence and immutable-image release receipts are stored under
  `.playwright/collapsible-rounds/`. Final CI and staging/promotion results belong
  to the exact commit and digest recorded there. No physical iPhone check is
  claimed for this change.
