# History accuracy and bounded Progress

Approved direction: implement the audit accuracy fixes and connected Progress/History. User specifically rejects an ever-growing exercise list, including at 200 exercises.

## Baseline and workspace

Fetched origin/main: bb89149d29bf88509d011c76424c7ea63f512ea8; original branch matched 0/0. Preserve unrelated untracked plans in the original Documents checkout. Isolated source archive adopted as codex/history-progress at /private/tmp/magni-audit-20261006-ifiyj9wj, fetched and verified against origin/main. Node 22.23.3 with fresh npm ci. Managed worktree creation operation 222fc3d2-fb33-49fd-a66f-7f9078e8d6a2 remains pending; do not create a duplicate.

## Product contract

Progress home shows one selected exercise chart, a searchable chooser, three favorite shortcuts, metric/date controls and two recent workout records. The existing fourth pin remains accessible in the chooser. Selected exercise, chart metric and period survive navigation and reload. Activity totals are a secondary disclosure. Chooser initially shows at most seven favorites/recent exercises; search replaces at most 20 results per page. Full finder starts with search/browse choices, with deliberate A–Z browsing at most 20 rows and program browse at most 10 groups. No infinite append. Preserve query/navigation context, original dates and recorded labels. Archived history stays available.

Exercise identity uses an additive owned catalog and source/set associations (schema 4→5), preserving existing session rows and frozen snapshots. New editor copies and quick repeat/routine flows preserve explicit lineage. Backfill connects only proven source identities. Same recorded names can share a finder discovery row but never an inferred comparison graph. Users can explicitly preview, connect and undo historical associations. Neither names nor progression keys alone establish physical identity.

## Assignments and dependency order

1. Designer owns docs/design/2026-10-06-progress-discovery.md: researched options, bounded design and historical linking interaction.
2. Coordinator owns this plan, audit note, export route and tests, runtime, integration and release.
3. Backend owns new features/progress data/types/query/migration modules and API routes, db migration revision, editor document/copy/snapshot history metadata, quick history-service lineage and their tests. Four additive identity tables; user-scoped bounded queries and pins. Publishes PROGRESS_SET_JOINS and resolveSetExerciseIdentities for integration.
4. Frontend owns app/history/**, app/workouts/page.tsx, BottomNav and tests, old LiftDetailContent retirement, components/progress/** and new progress-discovery browser tests. Coordinator owns workout detail page/component and safe return navigation, existing browser assertions. Stats worker owns training-stats/helpers/tests, shared Monday date helper, minimal Calendar helper adoption, WorkoutCard Last link/type and relevant direct SQL PR fixtures.
5. Independent verification checks requirements, data safety, code and realistic workflows. Coordinator resolves findings and publishes only after required gates.

## Accuracy acceptance

- CSV keeps missing actuals blank, zero actuals as zero, original units and stable session/set IDs. Prescriptions are separate; legacy set multiplicity explicit. Frozen historical names, ownership and deterministic order preserved.
- Distinct sessions on one date remain distinct observations; date/id ordering for historical comparisons.
- User-local Monday weeks agree with Calendar.
- Historical records compare only earlier comparable performances, never future workouts. First observation establishes baseline.
- Bodyweight, missing load and failed attempts remain visible without invented load/e1RM values.
- Corrections recompute derived history without changing progression decisions or frozen prescriptions.

## Verification / release checklist

- [x] Reproduce accuracy defects with disposable data, then focused regressions pass.
- [x] Identity/linking preserves variants, historical payloads, ownership, repeat lineage and correction behavior in focused regressions and independent review.
- [x] Fixtures with 200 and 1,000 exercises prove one home chart, three shortcuts, two recent records, bounded chooser/finder, direct search to last exercise and query cost observations.
- [x] Phone WebKit and desktop screenshots inspected, including dark/enlarged text and chooser; component tests cover empty/error states. Both browsers preserve focus and navigation context.
- [x] Independent review findings resolved.
- [x] Typecheck, lint, tests/coverage, production build and full release E2E checks pass without weakening checks (see separate local run receipts below).
- [ ] Populated staging preservation, backup/restore, compatible rollback and traceable release verified before rollout.

## Deferred

Progression/correction decision timelines, program block reviews, richer band/effort logging and offline app reopen remain separate subsequent milestones. No claim that browser emulation verifies physical installed-PWA behavior.

## Evidence

Audit source probes reproduced CSV prescription fallback, same-day session collapse, excluded zero-load detail and inconsistent historical PRs at baseline. Full UI and release gates are pending for this implementation.

### Development evidence

- Export regressions observed failing for invented actuals/missing units/frozen labels; 3 focused tests now pass.
- History detail missing-load/navigation regressions observed failing, then 36 focused component/navigation/recovery tests passed.
- Required dependency audit found sharp GHSA-wq5f-xc86-pv6w and source-map-js GHSA-68fv-2mgg-jv7q. Updated transitive locked packages within existing constraints to sharp 0.35.5 / source-map-js 1.2.2; npm audit --omit=dev now reports zero vulnerabilities. Full release gates still pending.
- Schema 5 requires a rehearsed migration recovery path; prior same-schema4 image-only promotion scripts are unsuitable unchanged. Do not publish latest/promote without updated staging and recovery evidence.

### Identity and navigation refinements

- Explicit links move selected historical observations only; proven future source lineage remains separate. Catalog matching includes exact saved label and measurement family. Copy→rename or external/added/bodyweight change conservatively splits history; aliases can be connected explicitly.
- Choosing a recent quick exercise forwards its owned catalog identity and preserves it in exact retry payloads. Root owns QuickExercisePicker.tsx and regression test; 23 focused quick-workout/draft tests pass after observed failing identity assertion.
- Workout detail now distinguishes missing load from zero and provides one progress link per exercise, using stable set mapping. Safe return context preserves Calendar, finder, Progress date filters and History pagination.
- Read-only SSH server check succeeds; current app and automatic updater are healthy. Neither was changed.

- Stats accuracy handoff: 80 focused pure/DB/API tests pass; 36 existing logger/component tests pass; owned ESLint passes. Independent reviewer now reviewing completed accuracy slice while new Progress data/UI work continues.
- Verified live baseline remains bb89149d29bf88509d011c76424c7ea63f512ea8 / image sha256:605e17f5e84507784c6c39f48caf2ba73fa1edc8584d2d4e7ec914287453561d. Updater remains running; no deployment mutation.

### Graph-first preview requested

- User asked to see a quick mock of one graph with a choosable exercise. Created interactive conversation preview at `/Users/tylergoulding/.codex/visualizations/2026/09/05/01a07295-2fc0-78a1-b6e1-3f30163623cb/magni-progress-graph.html`: single chart, searchable200-example selector, three favorite shortcuts, metric/date controls, two recent workouts. Mock uses clearly marked sample data. User approved this graph-first refinement; underlying identity/history work is retained.
-200/1000-exercise WebKit fixture passes:7home rows,20finder rows, last-name search, workout↔Progress return, enlarged dark no overflow. Fresh screenshots `.playwright/progress/iphone-*`; designer independently accepted density and readable wrapping.
- Backend final focused gate133tests/12files and scoped ESLint pass; independent review found and backend fixed undo target-origin restoration and conservative legacy namespace/orphan identity scopes. Final reviewer confirmation of legacy fix pending.
- Focused mobile suite6/9 passed. Remaining failures to resolve: new linking lost-response interception races with unroute (`Route already handled`); one Next dev manifest JSON read failed during concurrent HMR (500 registration; rerun stable server); kg theme test cannot locate Period after Progress navigation (inspect trace). Do not claim full browser/release gate passed. Screenshot helpers should use caret:'initial' to avoid Playwright screenshot caret styles causing hydration warnings.
- At this checkpoint nothing had been deployed. Later graph verification and adapted release rehearsal supersede this development checkpoint.

### Approved graph-first home (latest decision)

User approved the interactive mock. Replace the overview list as the default `/history` view with one selected exercise chart, a bounded searchable chooser, three favorite shortcuts (existing fourth pin remains accessible in chooser), metric/date controls and two recent recorded workouts. Keep all-record detail/History/identity controls available on demand. Activity totals become secondary disclosure. No growth of the home page with library size. Existing verified identity and history work remains authoritative; do not combine unlinked names into a graph.

Execution: frontend owns history pages, progress components and new progress E2E; backend owns minimal query/type/API support if required; coordinator owns integration, prior E2E assertions, screenshot server, release safety and gates. Write focused regressions for selector results/error/race/navigation and one-chart/two-record caps. Run scoped tests, then stable-server E2E without concurrent edits, followed by all release gates. Remote fetched again before edits; HEAD/origin/main still0/0 atbb89149.

### Resume integration and review

- The exact-ID planned resume API omitted previous performance, although the ordinary current-session route included it. A route regression failed on missing `lastPerformance`, then passed after attaching identity-safe previous performance for owned active planned sessions only. Completed history payloads remain unchanged.48 route/component checks and the iPhone WebKit filtered History → resume → previous workout → Progress → return roundtrip pass.
- Independent graph review found that the metric reset when returning from a workout and that mixed zero/missing-load sets could receive an inaccurate “Most reps” label. Frontend is resolving both with focused regressions, plus unambiguous chooser/favorite styles.
- Private schema4→5 release scripts now protect ingress throughout migration and backup validation. After any ingress reopening attempt, automatic restore is prohibited to preserve possible new writes. Direct candidate restart compares the complete schema5 fingerprint.13 local policy tests and independent script review pass; actual CI, populated rehearsal and rollout receipts remain required.

### Final local review and release gate

- Designer accepted final graph screenshots in light/dark, desktop, and enlarged phone text.200/1,000 fixtures pass one-chart/three-shortcut/two-record bounds, seven initial chooser rows,20 finder rows, direct last-exercise search, roundtrip navigation, and no horizontal overflow. No browser/hydration errors were observed.
- Independent graph review closed metric return, representative set and focus findings. Root verified native WebKit and Chromium metric/period focus, chooser autofocus, selected-exercise focus return, and Escape return. Independent final focused review31tests/7files passes.
- Full local gate: policy, zero production dependency vulnerabilities, route types, TypeScript, strict lint,860tests across97files and production build pass. Coverage:86.91% statements,80.20% branches,93.97% functions,89.87% lines. Complete Chromium/WebKit suite is currently running. Initial typecheck caught a Testing Library option and TypeScript narrowing through an arrow never-helper; corrected without behavior changes.
- Private updater restoration now verifies the exact captured container ID as well as its image. A two-case mocked regression failed on the replacement-container scenario before the fix, then both cases passed. Together with13 recovery-policy tests,15 local deployment-control tests pass; these are not populated-data staging evidence.

- First complete browser pass found two test-fixture/selector errors: the live run crossed UTC midnight while the user's local day remained October6, so a UTC-today fixture was correctly excluded from recent history; recent fixtures now use relative past days, also removing fixed September dates. The empty-state heading made a partial Progress-heading selector ambiguous; it now matches exactly. No app logic was changed for either. Full gate will be rerun after the remaining cases finish.

### Local candidate ready for publication

The corrected fresh browser run passes **154/154 cases** (Chromium77, mobile Safari77), with no retries or skipped cases, in8.4minutes. The first seven release stages passed on the same application implementation; after test-only date/selector corrections, the complete browser stage and scoped test-file lint were rerun. The original failed receipt is retained rather than rewritten. The exact committed image must still pass all eight CI stages together before staging/promotion. Final remote fetch remains0/0 againstbb89149.

Deployment receipts are kept privately under `.playwright/progress/release/`: publication, populated upgrade/restore, production browser workflows, fresh/frozen/postrelease backups, guarded promotion, public readiness, restored updater and final result. These receipts record the exact commit and immutable image; physical installed-iPhone validation remains separate. This source plan records prepublication acceptance; the final receipt is authoritative for rollout completion.
