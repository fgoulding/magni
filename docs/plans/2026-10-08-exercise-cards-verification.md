# Unified exercise cards — independent verification

Date: 2026-10-08. Worktree: `.worktrees/unified-exercise-cards`. Verification owns this note and ignored `.playwright/verification/` artifacts only. No product files, Git state, runtime server or production data were changed by this reviewer. Coordinator owns browser/runtime evidence and release.

## Requirements reviewed

Read `AGENTS.md`, `docs/engineering/team.md`, task plan, design/Undo contract notes, `docs/design-system.md`, installed Next `use-client` guide, shared UI, both data adapters, existing history service/route, new API tests and E2E tests. Used verification-before-completion workflow.

- Shared `ExerciseLogCard`/`SetLogRow` are used by Quick Workout and planned Today/focus/detail.
- Manual disclosure retains mounted inputs; no automatic collapse after save. Coordinator accepted all exercises initially open, consistent with user's ability to close completed lifts; design note updated.
- Set identity, authored prescriptions, unit/bodyweight context, supersets, previous-workout links and training-max access remain represented. Authored same-name grouping needed a correction below.
- Undo uses existing conditional actuals endpoint. Both actual fields must explicitly acknowledge null. Failed/unconfirmed Undo persists a distinct retry intent; successful Undo retains inputs without setting pending-save intent.
- Backend API tests use disposable SQLite and synthetic users. No schema or API change is needed.

## Reproduced findings and resolution

1. **P1 — stale retained Undo values falsely shown as Saved after remote relog.** Initial locations: `QuickWorkout.tsx` row value/saved computation and `WorkoutCard.tsx` `inputValues`/row saved computation. Reproduction: retain 0 reps/62.5 after Undo locally; another device logs 10 reps/65; remount with those current server actuals. Both formats showed inputs 0/62.5 with Saved and an enabled Finish. Independent tests failed expected 10/received 0. Frontend now uses retained inputs only while server actual reps remain null; newer acknowledged actuals and baseline take precedence. Independent retest passes for Quick and planned, plus implementer added three-format regression.
2. **P2 — adjacent authored same-name exercises collapsed into one section.** `workout-card-utils.ts:buildGroups` grouped by display name despite differing `editor.exerciseId`. Independent test expected 2 groups/received 1. Frontend now requires matching authored exercise ID outside intentional supersets. Independent retest passes.
3. **P2 — collapsed summary unavailable to button accessibility description.** `ExerciseLogCard.tsx` explicit aria-label overrode saved/pending child text and hidden rows removed their status. Independent `toHaveAccessibleDescription(/Unsaved changes/)` failed. Frontend linked the summary with `aria-describedby`; independent retest passes. Summary also now has a polite live region for closed updates; actual assistive-technology announcement has not been physically tested.
4. **P2 — aggregate Undo implied one set.** A legacy record with `sets:3` displayed batch context but action name `Undo set 1`, despite clearing all 3. Independent expectation for a 3-set action failed. Frontend added `Undo 3-set log`; independent retest passes.

Ignored independent tests: `.playwright/verification/adversarial.test.tsx`; config alongside it. These are reviewer reproductions, not production code. Initial result log records all 5 failing checks; follow-up suite with committed-but-lost Undo reply scenarios passed 7/7. A later legacy-load check adds the separate pre-existing finding below. No test was weakened to make these pass.

5. **P2 — pre-existing planned missing-load fallback, fixed within approved scope.** `WorkoutCard.tsx:inputValues` and `workout-card-utils.ts:buildSummaryRows` substitute calculated load when a logged legacy row has null actual weight. Reproduced actual reps 10, actual weight null, calculated weight 62.5: input displays 62.5 as Saved (and calculated tonnage is implied), whereas Quick uses zero for missing recorded load. Initial independent eighth assertion failed. This was existing planned-adapter behavior, not introduced by the shared card. Both adapters now display a blank input and `Saved · load not recorded`; summary retains null weight and contributes zero tonnage for missing load. Independent checks now require blank input, explicit missing-load status and zero summary volume; separate Quick/planned checks preserve a genuine recorded zero as numeric zero. All pass.

## Executed evidence

Commands use `PATH="/private/tmp/magni-runtime-20261006/node_modules/.bin:$PATH"`.

- `npm test -- src/app/api/sessions/set-unlog-contract.test.ts`: **7 passed** independently. Covers preserved data/identity, strict conditional baseline, same null retry/revision, stale conflict, zero reps, ownership/same-origin, quick partial finish, planned progression and completed protection.
- `npx vitest run -c .playwright/verification/vitest.config.ts`: initial 5 failed; after fixes and two additional lost-response recovery checks, **7 passed**. Later eighth missing-load check initially failed. After the correction and stricter checks, the independent suite is **10/10 passed** (`adversarial-final.log`).
- Intermediate focused `npm test -- src/components/WorkoutLogging.unified.test.tsx src/components/workout-card-utils.test.ts src/app/api/sessions/set-unlog-contract.test.ts`: 27 passed/3 failed, all failures newly added batch-name cases while implementation was still in progress; not a completion result.

## Existing test changes reviewed

Compared test files with the untouched primary checkout using `diff` (no Git operations). No reduced business-outcome coverage found:

- `WorkoutCard.test.tsx` still asserts 20 reps at 225 lb and 4,500 lb after explicitly saving three physical rows; old auto-advance tests now verify disclosure stability and selected-row writes.
- `WorkoutCard.editor.test.tsx` legacy-flat scenario now asserts exactly one PUT for selected row 3 with exact set ID, actual values and baseline. This matches per-row behavior. Actual legacy aggregate records remain one ID, checked separately by new batch Undo tests.
- Resume, history and hydration tests unchanged at review time.

## Pending gates and limits

**98/98 tests passed across 9 files** on the stable semantic implementation (`focused-final.log`): unified recovery, grouping, API contract, Quick/planned/editor logging, hydration, history and exact resume.

Inspected actual local WebKit phone screenshots from `.playwright/exercise-cards/phone-results/` after compact inline-save layout: Quick iPhone 13 mini light 16/dark 20/light 32px, Quick iPhone 16-sized dark 16px, planned Calendar mini light 16/light 32px, planned Today 16-sized dark 20px, and mini collapsed. Decimal 225.25 is clear of native steppers; names and summaries wrap; normal-size action is inline; enlarged action wraps; collapsed state keeps the acknowledged count. The whole-card capture can include fixed bottom navigation or only the visible modal segment: this is not evidence of a new application overlap bug, nor proof of offscreen content visibility.

Designer subsequently found Quick footer action clipping at 32px root. Frontend added wrapping/intrinsic footer sizing, scoped numeric text sizing (`max(16px, 1rem)`) and a one-column fallback below a text-relative container threshold. Independently inspected refreshed mini Quick full page at 32px, mini Calendar card at 32px, and iPhone 16-sized Quick dark 20px. The Quick footer labels now remain inside their buttons; numeric entries scale and stack; 225.25 remains readable.

Read the coordinator's actual `phones-verified.log`: **9/9 local WebKit cases passed in 41.9s**, across iPhone 13 mini/13/16-sized profiles. The checked-in E2E now asserts input font size 16/20/32px and footer text scroll width, alongside bounds, save/Undo/reload and partial completion. The planned Calendar whole-card capture still only captures a visible segment of the fixed dialog; it cannot certify every offscreen control by screenshot alone. Browser interaction and save/reload outcomes provide complementary evidence.

**No open material findings remain from this review.** Desktop capture and complete release gates remain coordinator-owned and pending at handoff; they are not being claimed complete here. Browser screenshots are local WebKit evidence only. No staging/live or physical iPhone keyboard/PWA safe-area evidence has been established by this review.

## Release-suite follow-up review

Read-only review of the latest heading and mobile-layout test edits (no new app, build or browser run during coordinator release tests):

- Approved `<h3 aria-label={name}>`: exercise heading navigation remains canonical; the disclosure button retains its own Collapse/Expand action, expanded state and saved-status description. The added test checks the heading before and after collapse across Quick/planned/focus. Existing history-resume tests still assert exact session/set IDs, actuals, URL/return context and persistence; their identity checks were not weakened.
- Replacing the old entire-wizard-height assertion with four exercise cards, twelve physical rows and manual collapse matches the approved product behavior. The new Finish trial-click, viewport/bottom-navigation bounds, Add exercise, date scope and exact active-session checks remain meaningful.
- The requested coverage adjustment is now present at `tests/e2e/mobile-layout.spec.ts:49`: while all twelve rows are expanded, require actual document movement (`scrollY > 0`), check card position against its document origin minus scroll offset, and reject nested vertical scrollers. The test resets to a verified zero scroll position before collapsing; all collapsed Finish/navigation, Add exercise, date-scope and exact-session checks remain. Read-only final approval: no open test-coverage or application-source finding from this follow-up. The active release-suite result remains coordinator-owned; no runtime/build/browser command was run by this reviewer for this follow-up.

Read-only follow-up for `tests/e2e/program-editor.spec.ts:138`: approved the replacement of the former whole-expanded-wizard height bound. It now verifies three visible physical set rows and no horizontal overflow, collapses the canonical exercise to zero visible rows with the compact card above navigation, then reopens and requires the last set's Save action to pass Playwright actionability and viewport checks. Existing authoring, preview, reload, activation and exact session prescription assertions (three rows, `[40, 40, 40]` loads, double-progression rule on every row) remain unchanged. This is a valid behavioral test update for the approved shared logger, not removal of prescription/progression coverage. No source issue or blocker found; no runtime was executed for this review.

Read-only containment follow-up: approved moving `container-type: inline-size` from the entire `SetLogRow` to an always-mounted wrapper around the two inputs and Save action. The queried grid remains a descendant of its same-width block container, retaining its text-relative responsive thresholds. Status, prescription, conditional Undo and recovery actions now sit outside containment. Input IDs, handlers, state, disabled conditions and disclosure semantics are unchanged. Diagnostic DOM evidence shows the earlier Chromium failure had visible computed styles but zero-size existing children after recovery insertion; disabling whole-row containment before the mutation restored their dimensions. This supports the narrow layout correction rather than a data-state workaround.

Read the actual coordinator logs after that source change: `diagnostics/stable-container.log` records **4/4 passed in 33.4s**, covering offline-save recovery and real UI progression, plus the updated editor activation/reachability case, in Chromium and mobile WebKit. `phones-containment-verified.log` records **9/9 passed in 39.4s**, with no retries, after the containment correction. No new source or accessibility blocker found. This reviewer ran no runtime/build/browser commands during the follow-up. Exact-source complete release gates remain coordinator-owned and pending; these results remain local browser evidence, not physical-device or deployed verification.

## CI timing follow-up (run 37831090804)

Independently read the failed CI log, both downloaded Playwright trace archives and captured page snapshots for commit `708a010`. CI correctly rejected the release with 162 passed and 2 flaky WebKit cases; retry passes are not a clean release gate.

- The new planned-card journey exhausted its cumulative 30-second test budget at the final API verification, after the completed-workout UI appeared. Its 16 screenshot operations consumed approximately 11.78 seconds; the completion visibility expectation began at 29.127 seconds and resolved at 30.051 seconds. Earlier session GET returned 200 in approximately 104 milliseconds. The unchanged retry completed in 26.2 seconds. This supports a scoped budget correction for the multi-theme/text-size Quick/planned visual journeys; it does not establish an application completion failure.
- The existing history recovery test began its five-second Retry-button assertion while `route.fetch()` was still pending. That fetch remained active for approximately 5.35 seconds, then was terminated by test teardown; the programmed post-201 abort had not happened. The captured UI correctly displayed disabled `Adding…` and prevented completion. `QuickExercisePicker` retains the submitted payload/request key and changes from busy to retry in catch/finally. The unchanged retry passed in 17.8 seconds. No application recovery defect is demonstrated by this trace.

Approved proposed test-only changes: scoped 90-second budgets for these long visual/recovery journeys, and registering a matching POST `requestfailed` listener before clicking Add, then awaiting the injected failure before the existing Retry visibility assertion. Preserve the 201 committed-response assertion, reload recovery and exact three-row no-duplicate outcome. Do not mask route errors or raise the Retry UI assertion timeout. Revised-source execution and a clean CI release gate remain coordinator-owned and pending. This follow-up used file/trace inspection only, with no app, build or browser runtime.

Reviewed the applied changes against the original source embedded in the failed CI trace archives using a read-only text diff. The diff contains only scoped 90-second budgets for the two card-render journeys and the history lost-add journey, plus the history `requestfailed` wait (matching POST session-set URL, registered before Add, bounded at 30 seconds). The original five-second Retry visibility assertion, real 201 commit assertion, reload, exact three-row recovery, structural edits and completion-volume assertions are unchanged. Approved with no blocker or weakened outcome coverage. Read actual `ci-timing-regression.log`: **12/12 passed in 59.9s** in Chromium/mobile WebKit, without retries. Also inspected the coordinator's private six-second post-commit delayed-abort diagnostic source; its outcome is pending at this handoff. No runtime or Git commands were executed by this reviewer. A clean complete CI release gate remains pending.
