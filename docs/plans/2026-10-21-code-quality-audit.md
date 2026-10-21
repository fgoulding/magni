# Code quality and efficiency audit

## Scope and baseline

Audit the current Magni codebase after recent feature and interface changes.
Prioritize avoidable runtime work, duplicated state/domain logic, maintainability,
and verification cost. This is an audit; no application changes or deployment.

Fetched `origin/main`: main at `93b61d0bcaf8ba388a4272ac03bf49cda16ce9fb`,
0 ahead / 0 behind. Preserve four unrelated untracked personal-product plans.
The latest exact-commit release passed 1,227 unit tests, all eight CI gates,
250 browser cases, and 38 production-image staging cases. Those are historical
baseline evidence, not a new audit test run.

## Review ownership

- Coordinator: architecture, route/data boundaries, source and build metrics,
  evidence triage, final findings and recommended sequence.
- Frontend: client components/hooks, draft state, rendering and duplication.
- Backend: services, queries, database work, transactions and indexing.
- Independent verification: tests, release scripts, brittle fixtures and feedback
  time; review consolidated recommendations.

All specialists are read-only. Only the coordinator writes this audit record.
Use disposable data for any measurements. Never infer a performance bottleneck
from file size alone; separate measured costs, reproducible bugs and cleanup
opportunities. Preserve logging, recovery, identity and progression contracts.

## Work and evidence

1. Inventory the current source and recent churn; identify expensive paths.
2. Review independent areas and reproduce high-value findings where practical.
3. Rank findings by impact, confidence, implementation risk and verification cost.
4. Recommend small cleanup batches with explicit invariants and deferred work.

## Results

The highest-value work is consistent recovery of pending commands, bounded
database reads, and reproducible verification/release tooling. Make these small
changes independently; preserve the existing workout and identity contracts.

The review inventoried 248 production TypeScript/TSX/MJS files (25,385 lines),
then concentrated on workout logging/recovery, program editing, Progress,
Calendar, history, and test/release tooling. This is not an exhaustive proof of
correctness for every path. P2 below means an actionable normal-priority defect
or scaling risk; P3 means a lower-priority optimization/maintenance opportunity.

### 1. P2 — Add-set retries can get stuck after an uncertain response

- Source: `src/components/QuickWorkoutEditor.tsx:28,86–93`;
  `src/components/QuickWorkout.tsx:115–116,322`.
- The pending append stores only its source set ID and request key. Each attempt
  reconstructs the submitted name/reps/weight from current session state.
- Scenario: the append commits but its response is lost; the user logs changed
  source-set values, then retries. The same key now carries a different payload,
  so the server correctly rejects the fingerprint mismatch. The pending append
  remains and prevents finishing.
- Fix: persist the complete submitted command before sending; replay it unchanged
  until acknowledged, then refresh canonical state. Preserve recovery across
  reload and storage failures.
- Regression: commit → lost response → edit source → retry/reload. Assert the
  same payload/key, exactly one appended set, and successful recovery.
- Evidence: independently confirmed by frontend and verification from source
  and backend mutation contracts. Not reproduced against a live account.

### 2. P2 — Reordered set responses can move the client revision backwards

- Source: `src/components/QuickWorkout.tsx:115–158`;
  `src/components/QuickWorkoutEditor.tsx:14,61`.
- Distinct sets may save concurrently. Each acknowledgement unconditionally
  replaces session revision/metadata. If revision 2 arrives after revision 3,
  the next rename/reorder uses a stale baseline and receives an avoidable 409.
- Fix: acknowledge each set independently; accept session metadata and revision
  together only if at least as new as the current version. Taking the maximum
  revision while still applying stale metadata is insufficient.
- Regression: resolve two distinct-row responses in reverse order, then perform
  a structural edit against the latest revision.
- Evidence: independent source/transaction-contract confirmation; not a claim
  of an observed production incident.

### 3. P2 — Calendar reads acquire an unnecessary writer lock

- Source: `src/features/programs/occurrences.ts:85,114`.
- Every `getOccurrences()` calls `ensureScheduledOccurrences.immediate()` and
  checks every legacy program slot, including a fully materialized program.
- Measured: a 52-week, three-day program required 161 prepared-statement
  executions, including 156 slot existence checks, to read one month.
- A separate WAL writer allowed an ordinary SELECT but caused this calendar
  read to return `SQLITE_BUSY`. The disposable probe deliberately used a 50ms
  timeout; the application timeout is 5,000ms. This demonstrates contention,
  not a measured production delay. This path does not update slot positions.
- Fix: materialize during scheduling mutations, with a read-only completeness
  check and transactionally rechecked repair fallback; bulk-read existing slots.
- Verification: concurrent first materialization, already-materialized reads
  during another writer, missing-slot repair, hold/schedule changes, preserved
  occurrence IDs and history snapshots.

### 4. P2 — Progress repeats full-history work for each exercise

- Source: `src/features/progress/queries.ts:56,61–67,103–107`;
  `src/features/progress/identity.ts:153`.
- The 20-row finder calls `summary()` per exercise, repeatedly reading pins and
  resolving their IDs. Its joins also make SQLite traverse completed sessions
  and sets for each summary rather than start with the existing exercise index.
- Measured: 101 statements with no pins, 261 with four pins; approximately
  103–105ms of synchronous service work for 1,000 sessions/30,000 sets.
- A scoped inner-join experiment for one exercise summary used
  `idx_exercise_set_sources_catalog`, returned identical output, and reduced
  that query from about 2.9ms to 0.08ms. This is one synthetic query, not a claim
  of an equivalent speedup for the whole page or every identity path.
- Fix: batch summaries/latest results and load pins once. Use inner joins only
  in paths already requiring a resolved catalog identity; preserve missing
  identities in consumers that intentionally support them.
- Verification: aliases, redirects, linked/unlinked histories, pin replacement,
  units, filters and statement-count budgets at multiple history sizes.

### 5. P2 — History limits rows after aggregating the entire history

- Source: `src/features/workouts/history-service.ts:69`;
  `src/features/progress/queries.ts:226`.
- Joining and grouping all matching sets precedes the session limit. A first
  page of 100 sessions measured about 11.3ms at 30,000 sets; selecting the session
  page first then aggregating its sets measured about 1.7ms, with identical rows.
- Fix: filter and order eligible session IDs first, then aggregate their sets.
  Exercise-name search and all other eligibility filters must remain before
  pagination. Preserve tie ordering, empty/skipped sessions, archived programs,
  nullable weights and legacy multiplicity.
- The Progress 20-row history endpoint has the same work pattern; the proposed
  rewrite was directly compared only for `listWorkouts()` without filters.

### 6. P2 — Calendar duplicate recovery loses command identity on remount

- Source: `src/components/CalendarWorkoutActions.tsx:38–44`.
- Pending commands exist only in a ref and are replaced when the body changes.
  After a committed Duplicate loses its response, remount/retry can generate a
  fresh key. Duplicating does not change the source revision, so this can create
  an additional occurrence instead of acknowledging the first command.
- Fix: persist an owner-scoped pending command and reconcile that exact command
  before replacing it. Keep deliberately creating another copy possible after
  the prior outcome is acknowledged.
- Regression: lost Duplicate response → remount → retry; one new occurrence,
  same key/body, including destination changes during recovery.
- Evidence: frontend source/contract review; no live mutation performed.

### 7. P2 — Template operator tests are absent from the release gate

- Source: `scripts/release-check.mjs:10`;
  `scripts/program-template.test.mjs:9`; `vitest.config.ts:12`.
- The fixed Node test list omits the existing template CLI test. Vitest only
  discovers tests under `src`. Publish receipt validation, idempotent publish,
  content-change rejection and rollback CLI regressions therefore cannot fail CI.
- Fix: include the existing test in the gate and assert its inclusion in the
  release-policy tests. Retain the other gates.
- Evidence: script/workflow discovery inspection, not a newly executed test run.

### 8. P2 — Authentication helpers hide an interaction retry

- Source: `tests/e2e/helpers.ts:10–26`.
- The shared login/register helper clicks again following a ten-second response
  timeout. Playwright can report a first-attempt pass despite an earlier failed
  interaction inside the test. No evidence establishes that this happened in
  the latest passing release.
- Fix: establish explicit UI readiness and issue one click; record request and
  response failure. Keep deliberate recovery tests separate and observable.

### 9. P2 — Staging/promotion code is not reproducible from a fresh checkout

- Evidence: 18 copies of `*/release/release.py` in the worktree's ignored
  `.playwright` artifacts. The latest `finish-workout-early/release/release.py:6`
  imports helpers from the ignored historical `progress-identity` task folder.
- The committed CI gates remain reproducible; this finding concerns the guarded
  staging/promotion orchestration used after CI.
- Fix: extract sanitized, parameterized deployment tools into tracked `scripts/`.
  Keep credentials, database copies, backups and receipts private. Preserve
  exact-image checks, writer shutdown, restoration checks, cleanup ownership,
  and updater recovery. Verify in disposable staging before replacing the
  existing procedure.

## Lower-priority cleanup and feedback opportunities

1. **P3 — Query collision candidates by target date.**
   `src/features/calendar/calendar-service.ts:54,67` reads all occurrences and
   unlinked workouts before JavaScript date filtering. A one-workout preview
   fetched 1,156 candidates; about 1.5ms locally, but inside an immediate
   transaction. Push target dates and exclusions into SQL, preserving scheduled
   versus performed dates, active/completed/skipped rows and swap eligibility.

2. **P3 — Resolve preview state per lift rather than per set.**
   `src/features/programs/occurrences.ts:138` and
   `src/features/program-editor/execution.ts:63` repeat maximum/progression
   lookups. Six lifts of five sets produced 31 queries, 30 for maxima. Time was
   only about 0.15ms locally. Batch/cache within the request; preserve frozen
   started-session values. This is lower value than the Progress/calendar fixes.

3. **P3 — Reduce repeated whole-document editor work.**
   `ProgramWorkspace.tsx:95,159` and `ProgramBuilder.tsx:88` duplicate validation;
   edits clone twice and serialize; undo retains up to 40 full snapshots.
   For a valid 24-week × 3-day × 10-exercise × 6-set document (4,320 sets,
   987,881 JSON bytes), two validations took median 5.33ms and the two clones plus
   serialization 8.34ms. A normal 90-set document took 0.22/0.17ms. These exclude
   rendering and storage and are not iPhone measurements. Validate once per
   changed document and defer schedule preview work; evaluate patch-based undo
   separately after profiling and preserving restore/conflict semantics.

4. **P3 — Consolidate pure logging transitions, not all workout UI.**
   `planned-workout-drafts.ts:17`, `QuickWorkout.tsx:388`, and
   `WorkoutCard.tsx:362` duplicate draft parsing, persistence, acknowledgement,
   Undo retention, conflict and finish rules. Extract tested pure transitions
   and persistence primitives while retaining distinct presentation components.
   First characterize current behavior, then move one contract at a time.
   Format and split the touched handlers/JSX as part of those bounded changes;
   avoid a separate repository-wide formatting diff or a single oversized hook.

5. **P3 — Give focused local browser checks a scoped preparation mode.**
   `scripts/release-check.e2e-warmup.mjs:74–80` prepares all routes regardless
   of selected tests. A retained focused recovery run spent 48.8s warming 81
   routes; its two browser cases took 4.8s and 4.9s, around 66s overall. A local
   focused profile or reused owned server should reduce feedback overhead.
   Keep complete preparation/discovery for release evidence. Measure any new
   profile before promising a saving.

6. **Investigate fixture transport failures without masking them.**
   `tests/e2e/helpers.ts:50` encountered `ECONNRESET` during registration before
   editor navigation in two retained CI attempts; diagnostic retries passed
   and the strict gate rejected each original run. Shared keep-alive connection
   reuse is plausible but unproven. Add sanitized transport/timing diagnostics
   and retain preceding workflow context for a bounded reproduction. Do not
   add automatic registration retries or loosen flaky-test policy.

## Architecture checks that do not justify immediate work

- Large files alone do not demonstrate poor runtime behavior. The largest
  service has 1,618 lines and WorkoutCard 798; extract cohesive responsibilities
  when fixing the specific contracts above, without introducing new models.
- The retained production build eagerly includes advanced editor code: its
  additional page entry chunks total about 153.9KiB raw/41.3KiB gzip, excluding
  framework and shared layout. This is not measured transfer time. Client-boundary
  lazy loading is an option later, not a leading bottleneck established here.
  The installed Next 16.3.8 guide was consulted; server-side dynamic imports do
  not automatically provide the same client splitting.
- No evidence here supports replacing SQLite, adding broad caches, redesigning
  exercise identity, relaxing release gates, or deleting browser workflows.

## Recommended implementation batches

1. **Reliable client command recovery.** Fix immutable append payloads, monotonic
   session metadata and persistent calendar retry identity with focused delayed/
   lost-response regressions. Keep existing sets, drafts and finish rules intact.
2. **Bounded database reads.** Fix materialized calendar reads and Progress
   batching/index access first, then history pagination. Compare result equality,
   statement counts and lock behavior using disposable data. Keep collision and
   preview batching separate if the first patch grows.
3. **Verification and operational cleanup.** Wire the missing CLI test into CI,
   remove concealed auth retries with readiness evidence, track reusable release
   orchestration, then create a local focused-check profile. These are separate
   changes with separate verification; do not weaken publication gates.
4. **Maintainability after characterization.** Extract shared pure workout-state
   transitions and reduce repeated editor validation. Only pursue undo storage
   redesign or bundle splitting if subsequent profiling demonstrates the need.

## Evidence and limits

- Backend probe: `/private/tmp/magni-audit-probe.cjs`; captured results/query plans:
  `/private/tmp/magni-audit-probe-results.jsonl`. Both contain synthetic fixtures.
  Uses actual current services/schema, Node 22.23.3 / SQLite 3.53.1, one warm-up
  then four samples, at 100 and 1,000 sessions, 30 sets/session, 200 identities.
  Run from the repository with the existing compatible runtime:
  `.worktrees/unified-exercise-cards/.playwright/workout-dates-and-notes/bin/node /private/tmp/magni-audit-probe.cjs`.
  The probe creates its own temporary database and never opens the live DB.
  Temporary files may be removed by the OS; essential results are recorded above.
- Editor measurements used current validation functions plus the existing
  clone/serialization operations, five warm-ups and 20 samples. They do not
  include browser rendering, storage costs or phone performance.
- Historical release evidence:
  `.worktrees/unified-exercise-cards/.playwright/finish-workout-early/release-evidence.json`;
  focused startup evidence: `finish-workout-early/recovery-browser.log:81`;
  transport failures: `auto-collapse-rounds/release/ci-chromium-failure.log:472`
  and `auto-collapse-supersets/release/chromium-2-ci.log:459` under `.playwright`.
- No application changes, screenshots, full-suite rerun, commit, push or deployment
  were needed for this audit. The last release's passing tests are baseline
  context, not fresh verification of proposed fixes.
- Independent verification confirmed both Quick client defects. Calendar and
  Progress findings also have actual-service synthetic measurements and query
  plans; implementation still requires the regression checks listed above.
