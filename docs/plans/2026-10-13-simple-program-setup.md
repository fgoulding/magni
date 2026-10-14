# Simple program setup and faster releases implementation plan

**Goal:** Let the user start Full Body Supersets through the familiar simple program form, publish future supported workout templates as data, and reduce release latency without reducing application coverage.

**Architecture:** Keep rich program documents and existing owned draft/save/activation contracts. Add a small validated runtime template catalog with immutable revisions, owner-only filesystem publication and rollback. Make `/programs/new` the normal creation entry and the full workspace an optional editing tool. Run the full browser suite on four isolated CI runners and aggregate exact test identities before publication; separate small release receipts from bulky diagnostic artifacts.

**Tech stack:** Next.js 16.3.8, React, TypeScript, SQLite, Node 22, Vitest, Playwright, GitHub Actions and existing Docker deployment.

## Authorization and baseline

User approved all four proposed improvements (template content as data, narrower content verification, isolated parallel browser jobs, small release receipts) and specified the existing Original training systems flow as the model for simpler creation. The accepted presentation contract is [the design note](./2026-10-13-simple-program-setup-design.md). Routine implementation choices are authorized; no extra approval gate is needed.

Fetched `origin/main` at `72c30f5981d44e6650d4c8f603b514e3452ad7b4`, no divergence. Reuse the clean task checkout `.worktrees/unified-exercise-cards` on `codex/simple-program-setup`. Preserve the four unrelated untracked plans in the primary checkout. Baseline evidence is the just-completed release: 1,063 unit tests, 208 CI browser cases, 32 production-image staging cases, all gates passed. Do not repeat unchanged baseline tests solely to establish the same result.

## Decisions and scope

- Primary Create opens `/programs/new`. Ready templates appear alongside the existing built-ins. Full Body Supersets uses one form: name, start date, duration, weekdays, optional weights, Create program. No mandatory workspace tabs or separate activation step.
- The full-body document retains the approved 5/5/3 pairs, 26 sets/day, rep ranges, effort, rest, tempo, notes and bodyweight. Loads remain independent by exercise appearance. Blank weights do not inherit the legacy 100 training max; use clear choose-when-logging wording and no invented working loads.
- Simple setup is backed by the rich editor model. Do not downgrade to SharedProgramSnapshot. Existing built-ins, duplication and advanced editing remain available.
- Source templates are plain versioned data, bounded to the supported declarative vocabulary. Runtime publication is an operator CLI with validation, preview, content rehearsal, expected-current revision, immutable revision storage and atomic pointer replacement. Normal web users cannot publish global templates. Current user programs and frozen workouts never change when a template changes.
- Catalog files persist beside the database and require their own backup/restore documentation and rehearsal; there is no database schema migration. Future content-only publication uses the focused content verification path without rebuilding the app. App/mixed changes retain the complete release gates. No path-only CI bypass.
- Full CI: seven core checks run alongside Chromium/WebKit × two shards each. Every runner retains one browser worker and has its own app/database. Required aggregation matches the complete discovered test IDs to exactly one first-attempt passing result per case, checks clean commit/run/attempt, rejects missing/duplicate/skipped/flaky/retried cases, and emits the same eight final gate identities.
- A tiny `release-checks-<sha>-<attempt>` artifact holds required machine-readable receipts; full logs/screenshots/traces remain separate diagnostics. Record useful timings. Preserve exact-image staging and guarded promotion.

## Ownership and dependency graph

1. Researching designer owns `docs/plans/2026-10-13-simple-program-setup-design.md` and final screenshot review; no application changes.
2. Backend owns new `src/features/program-templates/`, `program-templates/`, `scripts/program-template*`, compatible full-body factory/refactor tests, `Dockerfile` runtime packaging and `deploy/PROGRAM_TEMPLATES.md`.
3. Frontend owns simple setup components/component tests, `CreateProgramForm` integration, `/programs/new`, `/programs`, and workspace starter routing. Depends on the backend's typed template/compiler/catalog contract and designer contract.
4. Release engineer owns `.github/workflows/docker-publish.yml`, release policy tests, `scripts/release-check*` and new shard/aggregation scripts/tests, `playwright.config.ts`, and `deploy/RELEASE.md`. Independent of application modules.
5. Coordinator owns this living plan, browser workflow tests, runtime/browser/build orchestration, integration, Git and staging/live release. Independent verifier receives completed changes; it does not silently fix implementation.

Respect four active slots. Workers do not start shared servers/builds or mutate Git. Preserve concurrent work.

## Implementation and acceptance tasks

### 1. Data catalog and compiler

Write failing contract tests for invalid/oversized/executable or unknown data, unsafe identifiers, duplicate slots, independent loads, renewed identities, same-lift history and exact full-body equivalence. Implement the bounded shared validator, typed compiler and bundled JSON template. Confirm compilation passes existing rich-document validation. Keep existing full-body preset entry compatible.

Add runtime catalog tests for missing storage, valid publish, expected-current conflicts, immutable revisions, atomic reads, invalid updates, rollback and read-only application behavior. Add CLI tests using temporary directories and focused program-content rehearsal against disposable SQLite. Demonstrate publishing a new content revision without rebuilding/restarting the application and prove already-created documents remain unchanged. Package required JS/data for production and document backup coverage.

### 2. Simple setup interface and recovery

Render the approved single form using semantic tokens and native labelled controls. Load validated runtime templates on the server; pass serializable data to the client. Respect account date/units. Full Body defaults to four weeks and three weekdays; preview the actual first occurrence and workout count. Optional weights live in accessible day disclosures, with exact A/B/C prescriptions visible.

Use a stable per-attempt draft UUID/document and retain it across lost save/activation responses. Reconcile through the owned existing draft API before retry; never regenerate IDs or create a second run on retry. Keep inputs on validation/network failure, prevent duplicate clicks, and preserve setup values when entering advanced editing. Unit-test meaningful user actions and failures, including a lost response and independent repeated-lift weights.

### 3. Browser and visual verification

Add browser coverage for primary Create → choose template → adjust schedule/weights → Create → schedule/start/log; assert exact 26-set content, rep ranges and Spoto cues. Exercise a lost response/retry and verify one program. Preserve direct advanced preset/edit/reload coverage and legacy built-in creation. Check 375×812, 393×852, 320px reflow and desktop, normal/enlarged text, light/dark, decimal input and last-action reachability. Independently review actual screenshots. Physical-device testing is distinct and only claimed if performed.

### 4. Faster required release verification

Write failing aggregation/policy tests for missing shards/cases, duplicate results, incorrect identities, dirty sources, skipped/flaky/retried failures and core failures. Implement fixed shard commands and tiny receipts, manifest comparison and required successful aggregation before image publication. Confirm real discovery partitions both browser projects exactly; run focused orchestration tests, then prove the new complete workflow in CI. Keep diagnostic artifacts on failure without making their download part of deployment.

### 5. Integration and release

Run focused checks during implementation. After independent review, run full unit coverage, typecheck, lint, production build and changed browser workflows locally once. Commit and push under existing release authorization; pause automatic updater and take baseline backup before publication. Verify new CI receipts, image identity and all browser results, then stage the exact published image on disposable accounts and populated data. Rehearse both database and template catalog backup/restore/rollback. Promote with a fresh backup, preserve data volume, verify public health/revision and restore updater. Store exact receipts privately and summarize delivered behavior and remaining limits.

## Evidence and unresolved work

- Designer contract completed with Apple HIG/WAI/WCAG sources. Baseline remote matches; branch clean before implementation.
- Release engineer implemented the core job plus four isolated browser jobs and strict aggregation; 19 focused pipeline/maintenance tests passed, including the installed Playwright reporter/sharding protocol. Independent verifier repeated 17 policy/evidence cases successfully. Real full CI remains pending.
- Backend compiler/activation contracts passed during development. Review identified and assigned corrections for template weekday bounds and interrupted immutable-file publication retries. Frontend component work includes unknown-response reconciliation and account-scoped reload recovery.
- Coordinator added browser acceptance for simple creation, independent repeated-lift weights, real start/log/reload, lost save and activation responses, interrupted creation across reload, and 320/375/393/1280 layouts. Existing advanced preset coverage remains explicit.
- Read-only host check confirms live/updater are running at the unchanged baseline. No current-task commit, publication or live mutation has occurred. Integration, screenshots, full checks and release remain pending.

### Completed implementation and local verification

- Simple Create now uses a compact native program selector, with Full Body Supersets first, original training systems and Blank Custom preserved. One action saves the rich document then atomically activates/schedules it. Optional independent weights, first-date preview, advanced transfer and account-scoped interrupted-attempt recovery are implemented.
- Backend validation/publication and frontend recovery findings are resolved, including an authoritative deleted-draft tombstone before identity reset. No database migration or new web publication endpoint. The plain JavaScript template contract is included in coverage.
- Independent verification passed 36 component/template/compatibility/CLI checks and 17 release-protocol tests, and confirmed all 218 discovered browser cases partition exactly once.
- Local full checks: 1,087 tests in 118 suites, statements87.07%, branches80.82%, functions93.88%, lines90.40%; existing coverage thresholds unchanged. Gate policy, production dependency audit, route generation, typecheck, lint and production build all passed. Private receipt: `.playwright/simple-program-setup/release/local-checks/result.json`.
- 32 Chromium/WebKit browser cases passed without retries: simple creation/start/log/reload, lost save/activation responses, interruption across reload, legacy custom programs, advanced preset authoring and draft workspace management. Two earlier failures were test locator ambiguity (Next's extra alert and native select label text); narrowed accessible locators, then the complete changed workflow run passed.
- Final screenshots inspected by coordinator, frontend and designer at320/375/393px, including20px text, light/dark, expanded decimal weight entry, plus desktop Chromium1280px. No horizontal overflow or covered final action. Private screenshots: `.playwright/simple-program-setup/final-visuals/`. Physical hardware was not used.
- Fresh remote comparison before integration still has zero divergence from baseline. Full GitHub matrix, exact-image browser/populated-data/catalog recovery staging and live promotion are pending. Private release scripts are prepared; updater has not yet been paused.

### CI protocol correction

Initial run38498774967 stopped publication because Linux Playwright grouped both projects under one spec while the evidence reader assumed one project per spec. Reproduced locally with canonical temporary paths (the Mac alias had prevented reporter merging). The corrected reader expands every project result and hashes project, file, full title path and source location, independent of the reporter's retained first-project ID. Canonical-path real protocol plus grouped negative cases now pass:21 pipeline/maintenance tests, independently reviewed19 policy/protocol cases and all218 repository discovery identities. No application behavior changed. Supersede the failed run with a fresh full CI run; no image from it is eligible for promotion.

The next full run38499619382 passed core checks and found a legacy browser test still expecting the removed Programs-page “Custom program” shortcut. Update that test to follow the visible “Open workspace” → “New program” route, preserving its full author/preview/reload/activate/start assertions. Verify that workflow in both browser engines before another full run. The baseline app remains live; automatic updater is paused and the online baseline backup is recorded in the private release evidence.

The corrected complete custom-authoring workflow passed locally in Chromium and WebKit without retries (2cases,1minute including disposable server preparation); private log `.playwright/simple-program-setup/release/editor-entry-verification.log`. Fresh remote comparison still has zero divergence. No application code changed in this correction.
