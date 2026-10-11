# Stable workout save toggle implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep logging stationary, use a green saved check to toggle a set off, and replace Quick workout's More/Discard disclosure with hold-to-delete confirmation.

**Architecture:** Change shared presentation only; retain acknowledged saves, draft/retry/conflict handling and DELETE ownership. A stable primary check keeps its DOM identity and accessible action/state. A separate confirmation component handles the hold gesture and modal semantics.

**Tech Stack:** React, Next.js 16, semantic CSS/Tailwind, Vitest, Playwright WebKit/Chromium.

## Scope and decisions

- User explicitly chose removal of recorded volume, green saved check that can be unselected, and a trash icon requiring a hold followed by confirmation. No further design approval needed.
- Fetched remote before edits: clean `fc8b059e508a1c8eb6de0ab66fb7dad321a115df`, zero divergence from origin/main. Preserve unrelated primary plan files and ignored release evidence.
- Remove conditional volume output from active progress entirely. History/recap calculations stay unchanged. Preserve truthful saved count, missing-load row feedback and physical legacy batch counts.
- Primary action remains an icon of fixed width: saved green check invokes existing Undo; unsaved check invokes existing Save. Keep accessible Undo/Retry undo labels and pressed state. Dirty previously logged rows keep a compact secondary undo icon, preserving their existing recovery option. No visible Undo text.
- Quick workout footer trash replaces its More/Discard controls. Hold opens a modal; only explicit Delete performs deletion. Short tap, released/canceled/moved pointer and disabled state do not delete. Keyboard/assistive activation opens the same modal. Focus Cancel initially; Escape/Cancel restore focus; failed deletion remains recoverable with truthful feedback.
- Planned More contains useful non-delete actions and is outside this footer replacement.

## Ownership

- Root: shared `ExerciseLogCard.tsx`/CSS, `WorkoutSaveStatus.tsx`, their tests/call sites, affected summary assertions, docs, browser regressions, runtime and release.
- Frontend: `QuickWorkout.tsx`, `QuickWorkout.test.tsx`, new hold-to-delete confirmation component/CSS/tests. No Git, server or build. Do not revert concurrent edits.
- Designer: primary-source gesture/dialog guidance and screenshot review, read-only. Verification: independent requirements then code-quality review after integration.

## Steps and evidence

1. Reproduce first-save layout shift with disposable Quick workout and capture row position before/after; add failing browser geometry and toggle tests. Add focused unit regressions for accessible pressed state, stable primary button, and hold/confirmation cancel/error flows.
2. Implement bounded presentation changes, retaining existing persistence handlers and stable inputs. Update outdated tests to match requested UI while preserving safety assertions.
3. Verify save → green check → unlog → reload, edit/saving/failed/Undo retry, gesture cancellation, hydration, keyboard/dialog focus and deletion confirmation. Inspect mini/16 WebKit renders at normal/enlarged text; no added first-save height or overflow.
4. Independent review, typecheck/lint/coverage/build and relevant browser checks; commit only passing code. Release through full CI, exact immutable image, populated-data staging/rollback and production browser checks, fresh backup/promotion/public health/updater restoration under existing authorization.

## Local evidence

- Reproduced in WebKit before changes: first save shifted the row down 24px, expanded the action from 44px to 64px and narrowed both inputs. Four shared-component regression tests failed for the expected missing pressed state/visible volume. Eleven delete-confirmation cases failed before implementation.
- Shared saved check and inputs now keep their DOM identity and geometry through save/unlog; original save, conditional Undo, retry, conflict and draft handlers remain unchanged. No backend/schema changes.
- 1,013 unit tests in 108 suites pass. Coverage passes at 87.27% statements, 80.74% branches, 94.17% functions and 90.03% lines. Typecheck and lint pass. Corrected unsupported test-only RTL `exact` options found by typecheck; no checks relaxed.
- 42 targeted Chromium/WebKit cases pass without retries, including existing planned/Quick/Calendar logging, hydration and recovery. Final six-case rerun adds settled semantic success-color assertions, native touch short taps and dispatched touch-pointer hold/cancel sequences; all pass without retries.
- Inspected actual running-app screenshots at 375×629 and 393×659, normal and enlarged text, light/dark themes. Saved control is visibly green; confirmation fits, focuses Cancel, and supports failure/retry. Gesture dispatch is explicitly separate from physical iOS gesture validation.
- Private disposable browser evidence: `.playwright/workout-save-toggle/local-browser-42/` and final `.playwright/test-results/`. Exact-image release receipts will be recorded under `.playwright/workout-save-toggle/release/`.
- Production build and all 11 release-policy tests pass. Independent verification approved the requirements/code and 13 actual screenshots with no material findings. Full CI and staged promotion remain pending at this pre-release checkpoint; final private receipts record those outcomes without adding a documentation-only deployment.
- Physical-device verification remains separate from viewport checks; physical iOS long-press recognition has not been verified in this pass.
