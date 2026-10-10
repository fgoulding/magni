# Exercise identity and Progress defaults implementation plan

**Goal:** Connect compatible repeated exercises across old and new workouts without requiring pinning, and make Squat, Bench and Deadlift the first choices in Progress.

**Architecture:** Durable per-account canonical exercise identity and explicit alias resolution, separate from workout occurrence and progression identity. A versioned additive migration repairs historical mappings without changing prescriptions, actuals, dates, units, progression or ownership. Progress uses a bounded chooser and explicit all-history default; pins are navigation preferences only.

**Tech stack:** Next.js16.3.8, SQLite/better-sqlite3, React, Vitest and Playwright Chromium/mobile WebKit.

## Authorization and baseline

- User requests both a proper database fix and Squat/Bench/Deadlift first in the chooser. Existing implementation, commit/push/staging and rollout authorization persists; routine design decisions are delegated by the original objective.
- Fetched origin: primary main and reused clean isolated checkout match fabac81ab0bca4d49e781efa74aaae16b3aa9144, no divergence. Working branch codex/progress-exercise-identity at .worktrees/unified-exercise-cards. Four unrelated untracked September plans in primary checkout remain untouched.
- Read AGENTS, team/design system, relevant installed Next data-fetching guide, debugging/design/planning/TDD skills. Use existing semantic tokens and native-dialog patterns.
- Primary coordinates and owns route/UI integration, E2E/runtime, docs and release. Backend investigator owns proposed data contracts; designer is read-only. Explicit implementation ownership will be recorded before handoff. Independent verifier reviews requirements then quality.
- Only coordinator controls Git, browser/build runtime and deployment. No production writes until verified staging and guarded backups.

## Root cause and reproduction

- Fresh typed Quick exercises get a new catalog identity scoped to session and random exercise key. Existing recent/repeat/routine reuse can preserve identity, but same-name manual entry does not.
- Manual historical linking does not change future source resolution. Pin exclusion changes finder classification without joining history.
- Home defaults to first pin or recent identity, and date range defaults to12weeks. Ambiguity checks all-history while candidate lists can omit older workouts.
- Read-only live inspection confirms three separate Deadlift identities across one old planned workout and two Quick Workouts; all actual sets remain saved. Private data/identifiers are not committed. Reproduce using synthetic fixtures.

## Design decisions

1. A stable per-account exercise mapping resolves normalized exact names and narrowly defined equivalent aliases. Named variants (e.g. Romanian/sumo deadlift), incompatible measurement families, and explicit user separations stay distinct.
2. Historical compatible mappings are repaired in a versioned migration; future writes use the same resolver. Preserve manual grouping and detach intent, stable historical URLs, pin references and undo/conflict safety.
3. Pins never affect graph membership or ambiguity classification.
4. Chooser begins Squat, Bench, Deadlift in that fixed order, then a search affordance for any exercise. Keep a bounded result page. No requirement to pin.
5. Home defaults to All time, respecting explicit URL exercise/range and Back. Select the first primary lift with history in fixed order instead of last workout. Empty primary choices remain available; separate histories use a variation choice, not an empty state.
6. Ordinary exercise names appear without database vocabulary. Only genuine incompatible/explicitly separated variants use a clear choice flow. Search sees old names across all history.

## Tasks and acceptance

1. Backend: write failing SQLite tests for repeated typed same-name exercises, planned/quick equivalence, old history, normalization/aliases, pin independence, explicit detach/link preservation, variants, ownership, retries/restart and migration idempotency. Run red, implement minimal persistent resolver/backfill, run focused green.
2. Frontend: test then implement ordered primary chooser, all-time and stable default selection, search/empty states and plain-language exceptional choices. Preserve URL metric/range/back and keyboard focus.
3. Coordinator: browser regressions using synthetic June/September/October Deadlift history without pinning; new same-name session automatically extends graph. Check bounded200-exercise search, old URLs, variants and all-time/date filters. Inspect light/dark Mini375px, iPhone16 393px and enlarged text screenshots.
4. Independent review: verify requirements, then data/code quality. Resolve material findings and run affected checks.
5. Full eight-gate local runner and clean-commit CI. Verify exact immutable image browser workflows and populated schema migration, backup/restore, supported rollback. Guarded live backup and rollout, then restore updater and verify public revision.

## Implementation and evidence

- Backend owns progress services/types/migration and Quick identity reuse; frontend owns Progress components/routes/tests; coordinator owns browser regressions, docs and runtime; independent verifier reviews requirements then quality. Release worker owns private preservation/backup/promotion policy only.
- Schema6 adds per-user name/family aliases and catalog redirects. Normalization uses NFKC, trimmed/collapsed spaces and lowercase. Approved whole-name equivalents cover barbell/back squat, bench press and conventional/barbell deadlift; qualifiers such as Romanian, sumo, incline and dumbbell are preserved. Unknown load mode bridges to external only for the three primary lifts.
- Existing catalog rows/IDs remain unchanged. Migration changes only exercise_id in exercise_sources and exercise_set_sources; all other preexisting table contents must stay byte-identical. Audited/revised mappings, confirmed identities and catalogs spanning groups are protected. Existing URLs, pins and routine references resolve through owned redirects.
- Baseline fabac81 exported to a disposable checkout: both new primary/default and repeated-name history browser tests failed as expected. First implementation regressions also failed before fixes.
- Backend focused checks:85 tests/11files, TypeScript and scoped lint passed. On-disk schema5 startup test verified three Deadlift identities become one, saved training rows remain exact, schema5 backup is valid and second startup makes zero writes.
- Frontend focused checks:57 tests/10files passed. Focused Chromium/mobile WebKit workflows:10/10 passed with zero retries. Screenshots cover375/393px and20/32px text. A clustered-date visual defect exposed by All time was fixed; two red chart regressions now pass with all7 chart/evidence tests.
- Independent review resolved three findings: ambiguous primary choices now use hasHistory and variation browsing; Deadlift variation browsing includes the preserved 'Dead lift' spelling; Undo audits/restores alias state and rejects intervening same-name identity changes while allowing unrelated workouts, pins and actual corrections. Older audit JSON remains compatible. Existing unambiguous aliases survive later migration repair.
- Final backend92 tests/11files and frontend63 Progress tests pass. Independent verifier7 adversarial +84 focused tests pass. Final focused browser suite12/12 passes with zero retries, including separated primary selection, all-history browse/Back, Undo and another typed session joining the restored graph. Screenshot review confirms visible Close control at32px text and no clustered date-label overlap; very large text deliberately scrolls within the dialog.
- Independent private release-policy review passed15 recovery-control tests and16 real SQLite preservation tests. No material review findings remain. Remote fetched again before integration:0/0 divergence.
- Full local runner passed policy, audit, route types, typecheck, lint,960 tests/coverage and production build. One obsolete training-stats fixture was corrected to assert automatic comparison before real explicit detach and then the original no-comparison expectations; independent review approved and targeted4/4 passed.
- Full browser run:172/178 passed. Four timeout traces have2–16minute process gaps coinciding with macOS Clamshell Sleep/Dark Wake Thermal Emergency/Maintenance Sleep events; original logs/traces preserved privately. Two failures were a broad Progress heading selector also matching the intentional empty-state heading; selector now names the exact heading. No timeout/assertion limits weakened. Clean-commit GitHub CI must pass every configured check before publication, and both target-image staging rehearsals must pass before promotion. Local sleep does not authorize bypassing these gates.
- Private release guards now distinguish strict schema5 baseline from schema6 candidate: only intended identity index changes allowed. Rehearse old-image refusal without writes, offline schema5 restore, reupgrade, schema6 backup/restore and restart. Never automatically restore a database after ingress reopening begins.

## Remaining gates

- Candidate e92d4bf passed all eight clean-commit CI gates, including960 tests and178 browser cases without failures/skips. On October10 the awake Mac completed production-image staging:103/104 passed. The one WebKit failure occurred when the test forced `page.goto`26ms after Undo started a background refresh; aborting the refresh triggered Next's document-navigation fallback to the current page. The original trace and failed receipt remain in private release evidence. Independent code/trace review confirmed native Link navigation discards pending refresh results through Next's action queue; no application redirect was responsible.
- Corrected the test to use immediate Back to records, then Progress's chooser and period control. Hold Undo's refresh through the Back click, then release it and verify the correct destination and no later return. Native Back sends its detail request during the held refresh, but shared route rendering can wait for that response, so the assertion checks the completed navigation after release. All saved-actuals, graph, period, metric, focus and Back assertions remain. Independent review approved; focused Chromium and mobile WebKit both passed without retries. This is a test-only correction; no application/database behavior changes. A new clean-commit CI/image is required before repeating full staging.
- Candidate7283d11 passed all eight clean-commit CI gates (960 tests,178 browser cases, zero failures/skips). Its production-image run exposed a test synchronization difference: successful200 RSC responses can remain open after the destination is rendered. Waiting for `Response.finished()` timed out although the grouping action had succeeded. Independent trace review approved checking response headers and the existing destination/data assertions instead. Both stream-closure waits were removed; the held Undo refresh and native navigation race coverage remain. A disposable production-image diagnostic passed both browser projects without retries and removed its owned resources. Its receipt is explicitly diagnostic-only and cannot satisfy release guards. No application code changed; full committed-source release gates still apply.
- The same focused workflow also passed both local development browser projects without retries after the stream synchronization correction; scoped lint and TypeScript passed. Independent review confirmed no user-visible, navigation or saved-data assertions were removed.
- Fresh guarded live backup, promotion, public readiness, updater restoration and final evidence. No live changes made yet. Physical iPhone is not verified by emulation.
