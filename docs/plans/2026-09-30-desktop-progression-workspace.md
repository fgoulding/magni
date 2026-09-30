# Desktop progression workspace implementation plan

> Execute in this session with the saved Magni coordinator, frontend, backend, designer and verification roles, using subagent-driven development and independent review.

**Goal:** Make progression setup more capable and program building faster through a readable desktop rule workspace, realistic hypothetical sequences and safe rule reuse.

**Architecture:** Preserve document/rule v1, immutable activation/session snapshots and the existing evaluator. Add pure authoring operations and a sequential preview that uses that evaluator; keep all simulation state local to the editor. Reuse the existing revision-aware save and single-action Undo path. No database migration or new progression engine is planned.

**Tech stack:** Next.js 16.3, React, semantic Tailwind tokens, SQLite, Vitest and Playwright Chromium/iPhone WebKit. Node 22 in the isolated worktree.

## Scope and decisions

The user asked to develop the desktop editor further, prioritizing more powerful progression setup and also faster program building. Existing session instructions authorize routine technical/layout decisions and commit/staging/release work. A new questionnaire or approval loop is unnecessary for this bounded extension.

The designer compared a field-only cleanup, a combined rule/preview/reuse workspace, and a general branching engine. The combined workspace is selected: it addresses both priorities while retaining stable saved semantics. Tiered AMRAP, compound actions and a general rule graph remain a separate engine-version milestone.

- Group configuration into When, Change, Frequency and Missed workouts. Optional per-lift starting rules replace only that rule; they never replace the program or prescriptions.
- At wide desktop widths, show configuration and hypothetical outcome side by side. Stack at smaller widths and enlarged text. Keep readable numeric inputs and 44px targets.
- Show effective weekly timing, deload precedence and the difference between unlogged and zero-rep sets. Concise outcome, before/after values and failure count accompany the existing full explanation.
- Add a short hypothetical workout sequence with explicit logical week, status, deload and per-set reps. Carry resulting state into the next workout. Future rep targets must follow actual execution semantics. Simulation never saves real training results.
- Copy a rule to chosen progression groups with every affected appearance listed. Preserve target starting loads/maxes, set prescriptions and independent keys. Remap designated top/AMRAP sets by role and ordinal. Reject the complete operation before mutation if any target is incompatible.
- Show the current shared scope separately from rule-only copy. Existing sharing remains intentional; copying does not silently join groups.
- Preserve the progression section when selecting another day. Offer exercise reuse within the program with a clear independent copy, so authoring avoids repeated setup.

## Research basis

The designer inspected the current rendered progression page and found a long vertical form with its preview below the fold. Group related native form controls following [W3C forms grouping](https://www.w3.org/WAI/tutorials/forms/grouping/); keep common controls visible and disclose advanced configuration following [Apple disclosure guidance](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls); identify actionable errors and announce concise changes following [W3C form notifications](https://www.w3.org/WAI/tutorials/forms/notifications/). The proposed layout is a product decision informed by these sources.

## Baseline and ownership

- Original workspace and origin/main match `be9824decd320e3937248cf5cba53df869b23f11`; zero divergence, no tracked edits. Four preexisting private September 5 plans remain untouched.
- Isolated worktree: `/private/tmp/magni-desktop-editor-20260930`, branch `codex/desktop-progression-workspace`. A temporary location avoids prior cloud-offload/conflict-copy failures.
- Backend owns new `src/features/program-editor/progression-authoring.ts` and its unit tests, with any minimal shared prescription resolver extraction coordinated explicitly.
- Frontend owns `src/components/ProgressionRuleEditor.tsx`, new preview component(s) and focused component tests.
- Coordinator owns `ProgramWorkspace.tsx`, rule-copy/reuse interface components, workspace tests, browser tests, documentation, runtime and release.
- Designer performs actual desktop/phone screenshot review. Verification reviews specification first, code quality second, then release evidence.

## Task 1: Authoring operations and accurate sequence simulation

1. Define exported client-safe types/functions for per-rule presets, complete progression-group listing, atomic rule copy and simulation.
2. Add failing unit tests for preserved target data/identity, complete shared groups, manual rules, units, designated role/ordinal remapping and atomic incompatibility rejection.
3. Implement minimal pure operations; route every sequence step through `evaluateProgression`.
4. Verify success/miss/within-range/partial/skip/reset/weekly/deload sequences and changing rep targets agree with actual execution. Extract shared resolution only if necessary; no altered v1 behavior.
5. Run focused Vitest tests and provide result/contract handoff.

## Task 2: Rule configuration and simulation interface

1. Add meaningful component regressions for hypothetical-only interaction, weekly timing, null versus zero, reset state and conditional controls.
2. Refactor the long form into labelled sections and a responsive adjacent result panel. Preserve existing field labels required by workflows.
3. Add per-lift rule starting points and a bounded editable sequence using Task 1 helpers. Invalid inputs show actionable errors without discarding authored rules.
4. Verify visible numeric content at 1440/1024/393px, light/dark and enlarged text.

## Task 3: Safe reuse and faster navigation

1. Add failing workspace tests for rule-only copy, scope preview, atomic errors, one Undo and switching days without leaving progression.
2. Integrate group listing/copy with the existing `change`/autosave path. Show scope before Apply; reset stale selections by source identity.
3. Add program exercise reuse as an independent clone, preserving complete prescriptions/rules and remapping set IDs. Keep existing copy-day/week/block and bulk prescription tools.
4. Verify copied configuration and independent loads survive save/reload; simulate actual completion where relevant.

## Task 4: Independent verification and release

1. Review specification compliance, then code/data/accessibility quality; fix findings and rerun affected checks.
2. Run focused browser scenarios, existing editor/planned progression suites, full unit coverage, typecheck, lint and production build with coordinated ownership of generated output.
3. Inspect actual desktop and iPhone viewport screenshots; this is WebKit emulation, not physical-device evidence.
4. Fetch remote before integration; commit/push within existing authorization. Require successful full CI publication and immutable image evidence.
5. Rehearse populated upgrade/recovery and production-image browser flows against the new current baseline (`be9824d`), then guarded promotion/readback and restored automatic updates. Keep private data/evidence out of Git.

## Checklist

- [x] Context, remote baseline, user priorities, designer/backend audits.
- [x] Concrete design and ownership recorded.
- [x] Isolated Node 22 setup and baseline checks.
- [x] Pure authoring operations and accurate sequence tests.
- [x] Rule workspace and hypothetical sequence interface.
- [x] Rule reuse, exercise reuse and navigation improvements.
- [x] Independent review, browser checks and screenshots.
- [x] All required local release checks.
- [ ] CI publication, exact-image staging and verified rollout (receipts below).

## Implementation and review evidence

- Node 22 baseline: 132 focused tests passed. Backend helpers and prescription resolver: 127 tests across five suites passed; authoring and malformed-input regressions were observed failing before implementation.
- Workspace reuse regressions first failed for missing rule-copy/reuse controls and progression-tab navigation. The completed workspace plus rule editor suites pass 31 tests.
- Independent verification identified a shared-rep baseline discrepancy. Simulation now starts from the first shared appearance's non-warmup baseline, exactly as activation does, while preserving selected appearance offsets. The regression proves shared reps 8 → 10 results in the later appearance's target 14, with a leading warmup excluded. Re-review and backend integration review found no remaining blocker.
- Eight new browser cases passed across Chromium and iPhone WebKit: complete-group rule copying, one Undo, durable save/reload, independent exercise reuse, incompatible-set rejection, hypothetical-only failure/reset/skip/deload sequences, and readable numeric controls at 1440/1024/393px, including enlarged dark mode.
- Designer inspected all 14 actual screenshots and accepted the layouts. Evidence is private under `.playwright/desktop-progression/first-browser-results/`. This is browser emulation, not physical iPhone testing.
- The first mandatory release pass stopped at the dependency audit: [GHSA-vcvr-r3jv-pc5j](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j) now reports installed Next 16.3.4. Update Next and its matching lint configuration to 16.3.8, then repeat every gate without exemptions.
- Next and matching lint configuration are pinned at 16.3.8. The subsequent complete local gate passed all eight checks: production audit zero vulnerabilities; typecheck; zero-warning lint; 766 tests in 77 files with coverage thresholds intact; production build; and 148 browser cases, zero failures/skips, no retries. Coverage: statements 86.59%, branches 79.42%, functions 94.66%, lines 88.97%.
- Local gate evidence is `.playwright/release-checks/result.json` and per-check logs. It correctly records uncommitted source; clean exact-commit publication remains a separate CI gate.
- CI run `36751680245` for `95b0236` passed the first seven gates, including all 766 tests and production build, then reached 106 passing browser cases before the 30-minute job budget cancelled it. Browser dependency setup consumed 13m45s downloading Ubuntu packages from the Azure mirror. Allow 45 minutes for the entire verification job so setup latency does not truncate the complete suite. Per-test limits, both projects, coverage, retry diagnostics and fail-on-flaky enforcement remain unchanged. The user already authorized repairing release blockers and completing rollout; no additional approval is needed for this infrastructure budget correction.

## Release receipts

The coordinator records post-commit outcomes privately under
`.playwright/desktop-progression/release/`: `publication-result.json`, populated
and browser rehearsal subdirectories, `visual-review.json`, durable backup and
promotion receipts, automatic-update restoration and `final-result.json`.
The final receipt is authoritative for the pending release checklist; it cannot
be embedded in its own immutable candidate commit. Rehearsal uses current live
baseline `be9824d`, schema 4, and preserved table fingerprints. Production data,
backups and authentication artifacts are excluded from Git.
