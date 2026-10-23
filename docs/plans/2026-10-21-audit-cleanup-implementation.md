# Audit cleanup implementation plan

> Execute the approved audit in bounded tasks with regression tests and independent specification/code-quality review.

**Goal:** Resolve the confirmed recovery and query-efficiency defects, make verification/deployment repeatable, and remove duplicated work without changing workout design.

**Architecture:** Persist immutable pending commands, accept metadata monotonically, and bound SQL work to relevant identities/sessions/dates. Extract small pure state helpers; keep existing UI, identities, snapshots, scheduling and release safeguards. No schema change planned.

**Tech stack:** Next 16.3.8, React 19, TypeScript, SQLite/better-sqlite3, Vitest, Playwright, Node 22, Python deployment utilities.

## Baseline and authorization

- User approved the audit's recommended implementation sequence with “yeah lets do it”. The audit supplies design/acceptance criteria; no additional design approval required.
- Fetched origin/main at 93b61d0bcaf8ba388a4272ac03bf49cda16ce9fb, 0 ahead/behind.
- Reuse clean `.worktrees/unified-exercise-cards`, branch `codex/audit-cleanup`.
- Primary checkout's unrelated personal-product documents remain untouched.
- Runtime: `.playwright/workout-dates-and-notes/bin/node` (Node 22). Disposable databases only. Shared browser/build runtimes owned by coordinator.

## Ownership and dependency graph

1. Frontend owns QuickWorkout, QuickWorkoutEditor, CalendarWorkoutActions, directly related helpers/tests. Fix audit 1/2/6 and extract shared pure logging rules where justified. No editor-document or backend edits.
2. Backend owns occurrences, calendar-service, Progress queries/identity, history-service, execution helpers and associated tests. Fix audit 3/4/5 and bounded collision/preview work. No client files.
3. Tooling engineer owns scripts/release-check*, tests/e2e/helpers.ts, auth readiness if necessary, release-policy tests, tracked deployment utilities and documentation. Fix audit 7/8/9, scoped local browser preparation and observable fixture transport diagnostics. Preserve full release checks.
4. Coordinator owns ProgramWorkspace/ProgramBuilder validation optimization, plan/evidence, runtime sequencing, independent review, Git/release. Review each specialist's implementation before integration; another agent independently reviews coordinator work.

Workers are not alone; preserve concurrent edits. No worker commits, pushes or deploys. Pure/unit tests may run independently with isolated DB fixtures; browser servers and builds require coordinator allocation. Repository team rules override the generic skill's single-implementer recommendation because these domains have explicit disjoint ownership.

## Task 1 — Reliable client commands

Files: `src/components/{QuickWorkout,QuickWorkoutEditor,CalendarWorkoutActions}.tsx`, associated `.test.tsx`, small state helpers and tests if needed.

1. Add failing regressions: lost committed append then source edits/remount; reversed set responses then structural edit; lost Duplicate response then remount/input changes.
2. Run affected Vitest files using Node 22 and capture meaningful failures.
3. Persist complete append/calendar command payloads, owner-scoped; acknowledge row writes independently and merge revision plus metadata only when current/newer. Retain explicit conflict resolution and storage failure reporting; do not freeze legitimate retries or lose old pending data silently.
4. Extract only pure duplicated draft/acknowledgement transitions supported by characterization coverage. Keep planned and Quick presentation separate.
5. Run affected tests, inspect diff, obtain independent review; repair and rerun affected checks.

## Task 2 — Bounded data reads

Files: `src/features/programs/occurrences.ts`, `src/features/calendar/calendar-service.ts`, `src/features/progress/{queries,identity}.ts`, `src/features/workouts/history-service.ts`, appropriate tests; editor execution helper only if needed.

1. Add failing tests for already-materialized calendar reads under a separate writer, missing-slot repair, fixed query budgets for picker summaries/pins, and equivalent history pagination/filter results.
2. Observe failures against current implementations.
3. Make complete schedules readable without writer acquisition; use bulk completeness checks and transactional rechecks for repair. Preserve existing IDs/snapshots, legacy links, holds and schedule mutations.
4. Batch Progress summaries/pins and permit indexed identity lookup only in queries already requiring resolved identity. Preserve all redirects/aliases, ambiguity, filters and units.
5. Page eligible session IDs before set aggregates; keep search/filter semantics and stable ordering. Filter calendar collisions in SQL and reuse per-lift preview state within a request where straightforward.
6. Run domain suites and repeat disposable before/after query measurements. Review independent correctness before considering performance accepted.

## Task 3 — Verification and release tooling

Files: `scripts/release-check*.mjs`, corresponding Node tests, `.github/tests/release-policy.test.cjs`, `tests/e2e/helpers.ts`, auth readiness files if required, new `scripts/deployment/` and `docs/deployment.md`.

1. Add a failing policy assertion for inclusion of `scripts/program-template.test.mjs`; wire it into the gate and run Node tests.
2. Replace concealed authentication re-clicks with explicit readiness and one observable request/response. Add sanitized diagnostics for fixture transport failure, without automatic retries.
3. Add a separate local focused preparation option; do not let it produce full-release evidence or change default route discovery/strict gates. Test argument/evidence boundaries.
4. Consolidate the previously used ignored staging/promotion helpers into sanitized parameterized tracked tools. No import-time I/O, private output directories, explicit host/deploy/container/image/schema inputs, immutable image/commit and receipt checks, owned cleanup, updater restoration and stopped-writer restore rules. Add negative tests for guards and safe dry-run/config validation. Keep old private receipts/backups out of Git.
5. Independently review guard equivalence before using new orchestration. Measure scoped local startup; run auth/browser workflows once coordinator provides runtime ownership.

## Task 4 — Editor repeated work

Files: `src/components/ProgramWorkspace.tsx`, `src/components/ProgramBuilder.tsx` and relevant component tests.

1. Characterize validation and review rendering behavior.
2. Calculate validation once for each changed document; pass it to simple builder. Defer schedule expansion to its visible review step. Do not change undo representation or add patch libraries in this pass.
3. Run focused editor tests; obtain independent review and desktop screenshot. Only make further changes if profiling demonstrates value.

## Integration and release

- Run focused browser regressions for recovery, Calendar, Progress/history, auth and editor; inspect iPhone-sized screenshots for any new recovery UI and desktop editor. Use one owned server and disposable DB.
- Run required typecheck, lint, unit coverage and production build after all edits. Run exact full browser release suite/CI once integrated; never disguise retries or skip gates.
- Fetch/compare before integrating. Commit only scoped source/tests/docs. Prior authorization permits push/CI publication and existing guarded rollout; verify actual state and preserve updater recovery. If no deploy is completed, report that limitation explicitly rather than claim live changes.
- Record changed files, red/green results, query counts, review findings, exact revisions and remaining gates here.

## Progress

- Implemented immutable append/Calendar commands, monotonic row acknowledgement metadata, owner-scoped Calendar recovery, and shared draft-storage plumbing. Final client cohort: 141 passing tests. Independent review reproduced and then verified all three additional response races/dead ends: original probes3/3 and targeted tests60/60 passed. The parent logger now prevents writes during the editor's canonical read; no snapshot merge framework was introduced. Calendar uses Web Locks where supported and exact-body guards everywhere; older browsers without Web Locks do not receive an atomic cross-tab guarantee.
- Backend: 264 tests across 19 suites and scoped ESLint passed. Independent coordinator review found no identity, filtering, snapshot or ordering regressions; separate frontend review accepted history pagination. No schema changes.
- Synthetic 1,000-workout/30,000-set comparison: 15 service outputs match (creation/update timestamps normalized). Picker with pins: 261→13 queries, ~107→49 ms; Progress home: 196→20, ~42→33 ms; history100: ~11.6→1.8 ms; Progress history20: ~9→0.38 ms; complete calendar: 161→5 queries; pending preview: 30 max lookups→1. These are synthetic timings, not production latency promises. Reproduction/results: `.playwright/audit-cleanup/backend/`.
- Editor: validation-once/lazy-review regressions first failed against baseline; all 45 editor tests passed after change. Independent reviewer accepted behavior, warnings, Undo freshness and memo dependencies.
- Browser regressions: 4/4 Chromium/WebKit lost-response cases passed; 12/12 auth and manual-builder/polish cases passed. No browser retries. Local focused warmup took4.4s for7 selected routes and5.2s for6; these runs are explicitly ineligible as release evidence.
- Visual inspection: recovery screenshots at375×812 and393×852 have no horizontal overflow; desktop builder screenshot retains clear fields/disclosure. Browser viewport simulation only, no physical iPhone claim. Captures under `.playwright/local-focused-15e002f9-2435-4104-b064-afe248313d4b/` and `.playwright/local-focused-65123c4f-8efb-4772-a2ab-b3bb35e35cf6/`.
- Tooling: fixed gate discovers/includes every Node script test, including template CLI; auth single-click readiness checked in both engines. New deployment utilities use explicit private configuration, exact same-schema preservation, immutable image/source/run receipts and owned cleanup. Wrapper review caught/closed missing production-evidence marker. Promotion rejects partial local browser evidence. CI run ID is the sole late-bound config value: null only before publication; exact run+attempt required afterward. Private host state and backups remain ignored.
- Full script gate33/33, route generation, typecheck, strict lint and production dependency audit (0 vulnerabilities) passed. Broader browser run exposed an existing retry test still clicking the old date button; updated it to assert the date button is disabled and use the explicit retry action, retaining request identity and saved-date assertions.
- Full unit coverage: 136 files / 1,267 tests passed, with statements87.66%, branches81.5%, functions94.36% and lines90.84%. Production build passed against a disposable DB. The first coverage run exposed a pre-existing test synchronization race in the planned logger: the old draft implementation reproduced it; awaiting the Discard control fixed the test without production changes or weaker assertions. Evidence: `.playwright/audit-cleanup/draft-probe/` and `unit-coverage-final.log`.
- Broader browser cohort: 30/32 initially passed; the two failures were the old Calendar retry interaction described above. The corrected retry case then passed2/2 across Chromium/WebKit. This cohort includes exact-body lost-response recovery and cross-tab Calendar locking. No retry setting or release threshold changed.
- Independent deployment-wrapper review caught and closed a null-run-ID preflight gap; both wrapper tests pass. No unresolved review blockers. Final fetch still matches origin/main93b61d0 before integration.
- Clean commit, full same-commit CI, populated staging, production-image browser checks and guarded promotion remain pending at this pre-release checkpoint. Their private receipts will be stored under `.playwright/audit-cleanup/release/`; public CI and the final task response identify the released revision.
- Release execution caught one tooling integration issue before staging: ordinary Python commands generated bytecode that failed the clean-checkout guard. Added a narrow ignore rule for only `scripts/deployment/__pycache__/`, independently reviewed, with a red/green policy test that still exposes source and misplaced JSON files. No application change. The superseded first CI run was cancelled before publication; final receipts use a fresh configuration/output directory.
- CI run39627418431 exposed another first-render draft race: storage contained the edited value while Save used an older rendered value. Independent review and deterministic baseline probes confirmed a pre-existing command hazard, correcting the earlier assessment that this was solely test timing. Planned and Quick Save/Finish now read current storage; planned edits/conflict resolution do likewise. Original conflict baselines, volatile storage, retained inputs and pending Undo are preserved. Fifteen regressions were observed failing before the fix, with an additional fresh-conflict assertion. Ordinary resumed fixtures now flush their initial async render, while explicit timing regressions preserve the vulnerable ordering.
- Independent final review found no blockers. Logging cohort199/199, final full unit coverage1,283/1,283 across136files, script gate34/34, typecheck and strict lint passed. Both-engine save/superset/recovery browser cohort20/20 passed with zero retries. Evidence: `.playwright/audit-cleanup/commands-*.log` and `.playwright/local-focused-ab325f1b-c1c6-4902-bcde-daf472f43f4c/`. Failed CI was cancelled before publication; baseline registry/live identity rechecked and its owned updater restored while preparing the corrected candidate. A new same-commit CI and staging cycle is required.
- Resumed October22 after the approval-review service's credit interruption. Remote still matches f122c61; unrelated primary-checkout documents are preserved. Live93b61d0 and its running updater were reverified. Final production build passed from a fresh cache after the sandbox-denied port error persisted in the previous Turbopack cache. No source changes were needed for that build failure. Evidence: `commands-build-clean.log`. The reviewed save-race fix is ready for commit and the full CI/staging cycle; final receipts will use `.playwright/audit-cleanup/release-commands/`.
