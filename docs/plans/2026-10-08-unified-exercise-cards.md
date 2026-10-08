# Unified exercise cards implementation plan

> Execute in this session with the Magni team; the coordinator owns integration and release.

**Goal:** Use the familiar Quick Workout set rows across active planned and unplanned workouts, with manually collapsible lifts, editable saved sets and explicit Undo.

**Architecture:** Share presentation components across QuickWorkout and WorkoutCard (Today, Calendar and history resume). Retain their data adapters and established draft/retry/conflict behavior. Use the existing conditional set PUT to clear actuals; no schema change. Preserve authored targets and historical identity.

**Tech stack:** Next 16.3.8, React 19, semantic Tailwind tokens, SQLite, Vitest and Playwright WebKit.

## Context and design decision

- User approved the earlier compact/control design direction and Undo proposal, then requested Quick Workout-style rows with collapsible lifts across formats. This is the implementation authorization; further design confirmation is unnecessary.
- Fetched remote before changes: HEAD and origin/main both `1bace30c247ab738dd779983b3de56d7ac528c44`, divergence 0/0. Isolated branch `codex/unified-exercise-cards` in `.worktrees/unified-exercise-cards`. Preserve unrelated untracked September plans in the primary checkout.
- Alternatives considered: keep the single-set focus interface; auto-collapse after the last save; use consistent rows and manual collapse. Choose consistent rows/manual collapse so saved values and Undo stay visible and keyboard focus is not moved automatically.
- Header: exercise name, saved/total summary, disclosure indicator. Full header target at least 44px with expanded state. Closed summaries expose pending, saving, error and conflict status. Closing does not discard input.
- Set rows: Set identifier, visible Reps/Weight (unit) labels, inputs, clear save state, separate Undo when logged. Standard rows are per-set; legacy aggregated rows retain an honest N-sets label and are not split into invented identities.
- Preserve prescribed roles/targets, bodyweight/added load, AMRAP, rest/effort/tempo/notes, supersets, last-performance links, training-max tools, skip and finish behavior.
- Saved edits become visibly unsaved; Undo clears only actuals and retains entered values locally without blocking partial completion merely because an unlogged row has prefilled values. Zero reps is a saved performed attempt. Never treat an uncertain/failed Undo as successful.
- Compact Today and larger workout detail use the same exercise surface. Desktop program authoring remains a prescription editor, not a logging screen.

## Ownership and dependency graph

1. Coordinator (root): remote, plan, runtime, E2E/browser server, screenshots, integration and release evidence.
2. Designer `exercise_card_design`: design note `2026-10-08-unified-exercise-cards-design.md`; primary-source research and visual acceptance; no app edits.
3. Backend `exercise_undo_backend`: `src/app/api/sessions/set-unlog-contract.test.ts` and contract note only; prove existing null-actual API, retries, conflicts, ownership and partial completion. No schema/API mutation planned.
4. Frontend implementer: shared exercise/set UI, both logger adapters and associated component/draft tests. No API files or browser runtime. Implementation follows confirmed UI/data contract.
5. Independent verifier after implementation: requirements first, then data/UI code quality. Resolve findings before integration.

## Implementation steps and gates

### 1. Baseline and contracts
- Run existing logger tests in the isolated worktree.
- Backend contract tests cover conditional unlog, duplicate retry, 409 stale baseline, ownership, completed-session refusal and accurate partial counts.

### 2. Shared accessible presentation
- Add meaningful failing component tests for collapse preserving edits, status while closed, save/undo, and zero-rep correctness.
- Implement reusable disclosure and set rows using semantic tokens and visible input labels; ensure numeric content has space beyond the 44px outer target.
- Manual collapse; stable persisted IDs; preserve DOM/input state across toggling and acknowledge statuses honestly.

### 3. Integrate all active workout formats
- Replace divergent Quick/planned focus/detail rendering with the shared surface.
- Keep requests conditional, null acknowledgements strict, and drafts durable. Retained values after Undo are not falsely saved or silently resubmitted.
- Test edit-during-save, failed/uncertain Undo, retry and conflict flows, reload, partial finish, legacy aggregate labels, supersets and bodyweight.
- Update existing UI assertions for the intended per-row interaction without removing business outcome coverage.

### 4. Independent verification and responsive rendering
- Typecheck, lint, full unit/coverage, production build and relevant E2E workflows. Run required release checks before publication.
- Real app screenshots with disposable accounts: iPhone 13 mini 375px, iPhone 13 390px, iPhone 16-sized WebKit 393px; light/dark, 16px/20px root text, decimal weights, long names, expanded/collapsed, unsaved/failed/saved states.
- Verify latest and older saved-set Undo, reload retention, Today/Calendar/detail parity and accurate completion/history after undo.
- Record physical iPhone keyboard, installed PWA and safe-area checks separately; emulation does not establish those.

### 5. Integrate and release
- Resolve independent review findings, update design-system behavior and task evidence.
- Commit only task-owned changes. Existing commit/push/staging authorization persists; follow documented publication/staging gates, with traceable version and no production-data test mutations.

## Evidence and status

- Implemented shared cards/rows and durable conditional Undo. No deployment yet.
- Baseline 50 component tests passed; new browser regression failed on missing disclosure before implementation.
- Backend contract suite: 7 real API tests passed, no API/schema changes.
- Independent review found and resolved stale retained inputs after another device re-logs, distinct authored same-name exercise grouping, accessible closed status, and legacy batch Undo labeling. Missing recorded weight now remains blank and explicitly unrecorded, with no fabricated volume.
- First browser runs exposed test synchronization issues (Undo label changes before acknowledgement, plus Next development full reload interrupting direct navigation); corrected explicit acknowledgement waits and normal Calendar link navigation. Failed receipts retained.
- Final phone matrix: 9/9 passed, no retries (41.9s), Quick + planned Today/Calendar + lost Undo response on Mini 375, iPhone 13 390 and 16-sized 393 WebKit. Screenshots cover light16/dark16/dark20/light32 root text and 225.25 decimal input; numeric font size and footer text bounds are asserted. Evidence: `.playwright/exercise-cards/phone-results.json` and `phone-results/`.
- Independent focused component/API suite: 98/98 passed, plus 10/10 adversarial checks. Full local release gates through production build passed: 913 tests in 99 files, coverage 87.03% statements/80.41% branches/93.98% functions/89.88% lines. The final complete browser gate passed 164/164 cases with no retries (6.7m). Runtime publication/staging/promotion receipts will be recorded under `.playwright/exercise-cards/release/` before rollout.
- Prior baseline visual audit: 3 phone WebKit save/reload checks passed; Mini 20px root text clipped decimal weight behind native spinner. This implementation must resolve that observed issue.

- Full browser verification exposed a canonical-heading regression (Collapse/Expand became the heading name), now fixed with three-format heading tests. Two old whole-wizard height assertions were updated for the approved all-set-rows layout: expanded content uses document scroll, collapsed overview stays compact, and final actions remain reachable above navigation. Independent review required and approved expanded-state scroll/no-nested-scroll coverage before collapse. Desktop Quick/planned captures were visually inspected.
- Intermediate release receipts preserve the heading failure, a temporary test typecheck error, and an owned leftover-server port collision. Those causes were corrected; the full final suite and exact-commit CI remain release gates.

- Chromium offline-save regression reproduced independently: existing children of the mutable size-container row returned zero layout bounds after a failed save, while a newly inserted Discard button remained visible. Computed display/visibility were normal. Removing containment after the failure did not restore them; disabling it before the save made the same check pass. The responsive container now wraps only the stable numeric entries; existing failure-visibility/recovery E2E assertions remain unchanged. Private diagnostic logs and DOM/trace evidence are under `.playwright/exercise-cards/diagnostics/`.

- Containment fix verified against the unchanged offline-save/reload/progression recovery case and updated editor activation/compact-overview case: 4/4 Chromium and mobile Safari checks passed (33.4s). Implementer reran 59 focused component tests, TypeScript and ESLint successfully. Final phone matrix after containment fix passed 9/9 (39.4s), without retries; refreshed Mini normal and 16-sized enlarged screenshots were inspected. All eight local release gates subsequently passed, including 913 unit/API/component tests and 164 Chromium/mobile Safari cases; exact-commit CI, immutable-image staging and guarded promotion receipts are authoritative for release status.

Release status in this committed plan is the implementation handoff. The final exact-commit receipt is `.playwright/exercise-cards/release/final-result.json`; it is generated only after CI, staging, promotion, live readiness and updater restoration pass.

- Final local release runner: **all eight gates passed**, `.playwright/release-checks/result.json`; browser result **164 passed (6.7m)**, zero failed/skipped/flaky cases. Remote fetched again before integration and remained at the original baseline (0/0). Source and independent review are ready for commit; publication and deployment remain gated by exact-commit CI and staging.
