# Today workout refinement implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Today easier to scan before starting and clearer while logging, including iPhone 13 mini and iPhone 16.

**Architecture:** Preserve Today selection and all workout persistence contracts. Refine server-page hierarchy and share a small active-workout status presentation between planned and quick logging; keep existing mounted exercise controls and manual disclosure state.

**Tech Stack:** Next.js 16 App Router, React, semantic Tailwind tokens, Vitest, Playwright WebKit/Chromium, SQLite.

## Baseline and decision

- Fetched remote before editing: `a2b0196cef6b37213a6c5f34b3e01166c5b482e1`, zero divergence from origin/main. Reuse clean `.worktrees/unified-exercise-cards`, branch `codex/today-workout-refinement`. Preserve four unrelated primary-checkout plan files and ignored evidence/backups.
- User asked to improve Today and previously authorized routine design choices, commit/push and guarded release. Optional scope question pending; proceeding with stated assumption of both overview and active workout.
- Chosen: compact identity/actions, truthful saved-set progress, secondary volume, quieter alternatives. Visual-only polish leaves misleading resolved-lift progress; a single-exercise wizard adds navigation and hides comparisons. Broad recap extraction is deferred.
- Designer reviewed current CI renders and primary Apple layout/design/loading and WCAG reflow/focus/status/target-size guidance. Sources: https://developer.apple.com/design/human-interface-guidelines/layout ; https://developer.apple.com/design/human-interface-guidelines/loading ; https://www.w3.org/WAI/WCAG22/Understanding/reflow.html ; https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html ; https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html ; https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html .

## Ownership and dependencies

1. Coordinator/root: this plan, `src/app/today/page.tsx`, its tests as needed, browser fixtures/screenshots and release. No query/selection behavior change.
2. Frontend: `src/components/WorkoutCard.tsx`, its CSS, `QuickWorkout.tsx`, `QuickWorkoutEditor.tsx`, new shared status component if useful, related unit tests. Root and frontend work in disjoint files; neither reverts other work.
3. Designer: read-only screenshot review. Verification: independent requirements review followed by code-quality and realistic-workflow checks. Root owns the only server/build/database runtime.
4. No API, migration or backend change is expected. Preserve set IDs, authored prescriptions, actuals, revisions, retry keys, dates and history.

## Task 1: Active workout clarity

Files: frontend-owned components and corresponding tests.

1. Add meaningful failing regression cases for saved-set progress after save, pending edits, Undo and skipped lifts; retain legacy batch count semantics.
2. Run focused Vitest and confirm failures reflect missing behavior.
3. Replace resolved-lift progress with `N of M sets saved`, using existing saved-state calculations rather than counting dirty persisted rows as current saves. Preserve original-unit volume as secondary information. Do not count skipped lifts as performed training.
4. Remove redundant Quick identity/date when embedded in Today; compact Edit trigger and move destructive Discard under secondary actions while retaining hydration safety and discoverable Add exercise.
5. Preserve Save/Undo slots, input identity/focus, mounted collapsed content, all warnings and partial completion safety. Run affected unit suites.

## Task 2: Today hierarchy

Files: `src/app/today/page.tsx`, `src/app/today/page.test.tsx` only if behavior assertions need extension.

1. Keep compact Today/date and History/Calendar access; reduce competing labels and empty-state actions.
2. Keep a clear workout name/context/Start hierarchy; give rest and completed states one readable outcome with quiet alternatives. Keep any other workouts in normal flow.
3. Preserve selection semantics and old-session exclusion. Existing page unit tests verify these invariants; no tests that merely mirror styling.

## Task 3: Render and verify

1. Use disposable planned/quick fixtures and production-equivalent browser behavior. Capture idle, partial saved/pending, collapsed, completed and rest states.
2. Inspect WebKit at 375×629 and 393×659 browser sizes, 375×812 and 393×852 PWA-sized, plus enlarged 20/32px and narrow 320px. Check desktop 1440×1000.
3. Normal 16px: first complete set controls should be visible promptly with install banner dismissed. Long content scrolls naturally; no sticky workout panel or nested scroll. Enlarged text wraps, no horizontal overflow; controls ≥44px, numeric inputs ≥16px. Focus/Undo/Finish can scroll above bottom nav.
4. Independent requirements review first, then code-quality review. Resolve findings and rerun affected tests.
5. Required checks: lint, typecheck, full unit/build and CI browser/release gates without weakening assertions, timeouts or retry policy.

## Task 4: Release

Coordinator only. Commit reviewed changes, fetch/compare before integration and push under existing authorization. Preserve production data, rehearse staged immutable image and rollback, promote only exact CI-verified revision and verify public readiness. Baseline is a2b0196, not the older release script constants. Restore Watchtower if temporarily paused. Physical-device results remain separate from viewport emulation.

## Evidence

- Initial screenshots reviewed: current a2b0196 CI planned Today dark and quick light exercise-card captures under `.playwright/progress-insights/release/ci-38074776478-1/`.
- Implemented shared native saved-set progress, original-unit acknowledged volume, compact Quick title/Edit, secondary Discard, accessible Start contrast, quiet Today header/alternatives and clearer completed identity. No API/schema/persistence changes.
- Independent review caught date suppression after moving a Quick workout away from today. Fixed by passing the server/account `todayKey` and hiding only matching dates; unknown/changed dates remain visible. Unit and browser checks cover Edit → previous date → visible date → reload removes it from Today.
- New browser regressions first failed for absent progress and duplicate Quick identity; frontend regressions also verified red/green for saved counts and changed-date behavior.
- Local validation: 1,001 unit tests across 107 suites and configured coverage passed (87.27% statements / 80.74% branches / 94.17% functions / 90.03% lines); typecheck and zero-warning lint passed; 11 release-policy/maintenance checks passed. Existing missing-load tests now explicitly verify missing load instead of the old misleading zero-volume label, retaining row/input/finish assertions.
- 36 targeted Chromium/WebKit journeys passed with zero retries (exercise logging, hydration, mobile layout, Today, execution); final Today date-fix rerun passed 4/4. Designer inspected 12 renders at mini/16 browser and PWA sizes, desktop and enlarged text with no blocking issue. First complete set controls fit short phone viewports; overflow, document scrolling and collapsed pending feedback checked.
- Independent verifier passed 124 focused tests and reviewed selection/persistence invariants. Final review and production build/release receipts recorded in `.playwright/today-workout-refinement/`.
- Local typecheck initially encountered stale duplicate generated `.next/types/* 2.ts` files. Coordinator inspected and preserved them under ignored evidence, regenerated route types, and reran typecheck successfully. No application or configuration workaround.
- Physical iPhone keyboard, safe-area hardware and VoiceOver behavior are not established by viewport captures. Existing verbose completion progression explanations remain deferred.
- Release receipts: `.playwright/today-workout-refinement/release/` (CI publication, staged populated-data backup/restore/rollback, production browser rehearsal and public readiness). Promotion requires all receipts to pass for one exact revision; no release claim is made by this plan alone.
