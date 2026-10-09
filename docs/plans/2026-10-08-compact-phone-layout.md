# Compact workout rows and Calendar implementation plan

**Goal:** Keep saved set controls on one line and fit the default Week and Month calendars on an iPhone 16 at normal text size.

**Architecture:** Change presentation in the shared set row and calendar components. Preserve logging, Undo, retry, schedule identities and existing endpoints. Calendar days with multiple workouts disclose a complete list instead of making the overview grow indefinitely.

**Tech stack:** Next.js 16.3.8, React, semantic Tailwind tokens/CSS modules, native dialog, Vitest, Playwright Chromium/WebKit.

## Authorization, baseline and ownership

- User explicitly requested both compact layouts; prior implementation, commit/push and release authorization persists. Routine design choices are within that scope.
- Remote fetched successfully; primary main and isolated checkout match origin/main at `91bd2e341a6cd2bbffb60573fc8a42104d2858fd` (0/0). Reused the clean existing checkout on `codex/compact-workout-calendar`. Four unrelated September plans remain untouched in the primary checkout.
- Root coordinates, owns Calendar implementation, browser runtime, E2E coverage, documentation, integration and deployment.
- `exercise_card_design`: read-only design review, completed. `unified_exercise_frontend`: shared set row/CSS and its component regressions only. `exercise_cards_verification`: independent requirements review followed by quality/behavior review. No agent may start another browser/build server or deploy.
- Read AGENTS, team/design system, installed Next CSS guide and relevant design/debugging/planning skills. Designer consulted Apple touch targets and W3C reflow/dialog guidance.

## Design decisions

1. A clean saved row uses its existing action slot for text **Undo**, replacing the redundant disabled Save check. Status remains visible. An edited saved row keeps both Save and Undo side by side. Preserve explicit Retry undo, errors, batches, prescriptions and 44px targets. Keep numeric text at least16px and allow enlarged text to reflow. Avoid the previously diagnosed Chromium containment bug by keeping contained control structure stable and recovery content outside it.
2. Tighten Calendar page padding/gaps, retain date heading plus Week/Month selector and Today/arrows. Week rows use compact spacing and at most two title lines in the overview; preserve direct drag for a single scheduled workout where it fits and Move under More.
3. A day with several workouts opens a complete day list; every workout and existing actions remain reachable. No clipping, hidden records or smaller touch targets to force fit.
4. Month cells become one whole-cell target, approximately56px high: date plus noninteractive status/count indicators. Single-workout days open the workout directly; multiple-workout days open a day list; empty days still navigate to their week. Six-row months must fit too. Replace redundant instruction/empty panels with compact footer context.
5. Target iPhone16 browser viewport393×659 and standalone-sized393×852 with safe-area simulation. Check Mini375px and iPhone13 390px as well. Normal populated overviews fit without document or inner scrolling. Deliberately opened details, installation help, errors and enlarged text may use ordinary accessible scrolling.

Alternatives rejected: four permanently occupied action columns waste numeric width; shrinking controls or hiding calendar overflow loses usability. Save/Undo replacement and day disclosure preserve clarity and bounded overview height.

## Tasks and checks

### 1. Reproduce before editing
- Add `tests/e2e/compact-phone-layout.spec.ts`: measure Reps/Weight/Undo alignment and target sizes; Week and six-row Month document height, navigation clearance, multiple-workout access and empty state.
- Run focused WebKit cases on current source, save screenshots and expected failures under `.playwright/compact-phone/`.

### 2. Shared compact set actions
- Modify `src/components/ExerciseLogCard.tsx` and its CSS module; add focused component coverage if behavior changes.
- Keep original null-write handlers, acknowledgement, drafts and accessible names unchanged. Test saved, dirty saved, undo pending, saving and disabled states.
- Run focused component coverage and unchanged offline-save/lost-Undo browser workflows. Root owns browser execution.

### 3. Calendar overview
- Modify `src/app/calendar/page.tsx`, `src/components/CalendarAgenda.tsx`; add a focused Month component if client day disclosure is required.
- Compact Week gaps/cards without losing drag/More/Add or full accessible workout names. Add complete multi-workout disclosure and preserve navigation/return context.
- Use one target per Month cell, preserve exact workout links and month prev/next navigation. Keep empty state compact.
- Update existing Calendar behavior assertions only for intended disclosure changes; preserve move/swap/duplicate/skip/retry, modal links and return-scroll coverage using a genuinely scrollable scenario.

### 4. Verify and release
- Independent spec then code-quality review; resolve material findings.
- Screenshot real app in light/dark, normal/enlarged text, Mini/13/16 widths, six-row months, dense days and empty weeks. Assert44px targets, numeric readability, no horizontal overflow and overview bottom above nav.
- Update `docs/design-system.md`. Run focused checks, required eight-gate release runner and exact-source CI. Stage immutable image with disposable and populated-copy data, backup, authorized guarded promotion, restore updater and verify live.

## Evidence

- Baseline reproduction: all four compact-layout cases failed before implementation. Undo was48px below inputs; Week899px, six-row Month1027px and empty Week811px exceeded a659px viewport. Screenshots/log: `.playwright/compact-phone/baseline/` and `baseline.log`.
- Shared row:92 focused component cases passed, including nine new saved/dirty/pending/focus cases. Data adapters and schemas remain unchanged. Existing browser helpers now wait for the acknowledged Undo action rather than the removed saved Save button; progression, payload, recovery and hydration assertions remain intact.
- Calendar component/page checks passed. Browser review caught native-dialog focus loss in More→Move→Close; cleanup now closes before removal and day triggers explicitly focus before opening for Safari. Independent review caught a pending-save dismissal regression; two red/green cases prove Close and Escape preserve the open dialog, visible failure and retry controls. `.playwright/compact-phone/dismiss-green.log`:11 passing Calendar component cases.
- Designer accepted saved decimal inputs/Undo, full seven-day Week, six-row Month and enlarged-text renders. Independent source review approved the final focus/busy guards and test changes; no remaining material findings. Real-device testing is not claimed.
- Final focused browser matrix:8/8 passed with retries disabled in Chromium and mobile WebKit (`.playwright/compact-phone/accepted.log`). Includes saved/edited set alignment at375/390/393px, normal Week/Month at393×659, Mini375×629, iPhone13 390×664 and simulated iPhone16 PWA393×852 with59/34px insets; full day-list Escape/Close/More→Move focus, all workouts, Month Add/back, Undo reload/null actuals and empty calendars. Local release run passed audit, typecheck, lint,928 tests/configured coverage and production build;169/172 browser cases passed. The Mac entered clamshell sleep during second-set setup and later slept for900seconds during WebKit page creation; a third test failed its initial registration with ECONNRESET before reaching the UI. Independent trace review recorded these runtime failures in `.playwright/compact-phone/runtime-diagnosis.json`, retaining the failed gate/traces. No source, timeout or retry policy changed for those failures. All9 unchanged awake reruns passed without retries (`awake-cases.log`); the user confirmed the Mac is awake. The fresh full local gate passed all8checks,928 tests/configured coverage and172 browser cases with zero failures/skips/retries (`release-checks-final/`); exact-commit CI must still pass the complete eight-gate runner with no flaky cases before image publication/promotion. Immutable-image staging, populated-copy preservation, guarded backup/promotion, public readiness and updater restoration receipts will be private under `.playwright/compact-phone/release/`; `final-result.json` is the final release authority.

Design sources: https://developer.apple.com/design/tips/ ; https://www.w3.org/WAI/WCAG22/Understanding/reflow.html ; https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
