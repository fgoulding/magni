# Auto-collapse completed supersets

**Goal:** Close an entire superset after its final actual set is successfully
saved, while retaining independent header reopening without changing any logs.

**Design:** Extend the round acknowledgement mechanism to the parent superset
disclosure. Close only on a newly acknowledged local save when all members are
saved and no pending, failed or conflict state remains. Reopening stays open
through unrelated renders, Undo, discard and accepting server values. Loaded
saved groups start open. Preserve child round state and mounted inputs. If both
round and superset close together, keyboard focus must end on the visible
superset header without forced scrolling; external focus must not be stolen.
Ordinary exercise cards keep their existing manual disclosure behavior. Count
all actual members, including unequal and three-member rounds. No API/schema
change is needed.

The user's request explicitly authorizes this extension of the approved round
behavior. Baseline `621526b` was fetched and matched remote with zero divergence.
Reuse the existing worktree and preserve unrelated primary-workspace plans.

## Ownership and sequence

1. Frontend: ExerciseLogCard.tsx, WorkoutCard.tsx, SupersetRoundCard.tsx only if
   needed for nested focus, and their relevant component tests. Demonstrate the
   missing behavior first, implement minimally, then verify acknowledgements,
   reopen/no writes, pending/failure/recovery, nested focus and ordinary cards.
2. Coordinator: browser tests, design-system guidance, this plan, runtime and
   release. Verify final completion and nested reopening in Chrome and WebKit;
   inspect 375/393px screenshots with enlarged text. Run required local checks.
3. Independent verifier: review specification, source and evidence without edits.
   Resolve material findings before integration. Only coordinator handles Git.
4. Follow existing exact-commit CI, immutable-image staging and guarded rollout.
   Keep receipts under `.playwright/auto-collapse-supersets/`. Restore the updater
   and verify live readiness before claiming deployment.

## Acceptance

- Partial or pending superset stays open; final confirmed save closes it.
- Header reopening preserves saved sets, round disclosure states and input nodes.
- Reopened superset remains open until another confirmed complete save.
- Failed saves, conflicts, discard, Undo and unrelated updates do not close it.
- Nested round/group auto-collapse leaves focus on a visible header; focus
  elsewhere wins. Both headers remain accessible and at least 44px tall.
- No changes to ordinary exercise completion behavior or persistence contracts.
- Required checks, independent review, staging and live readiness pass.

## Implementation and verification

- Added an optional save-acknowledgement version to the shared exercise disclosure;
  only supersets supply it. All actual sets must be saved with no outstanding
  status before a fresh acknowledgement closes the group. Child components stay
  mounted. Nested focus recovery selects the visible parent header without scrolling.
- Focused component checks: 76 passed across six files, after three demonstrated
  failing cases. Independent review found no implementation or test blockers.
- Browser workflows: 18/18 passed in Chromium and WebKit with zero retries,
  including failed final save/retry, nested reopening, unchanged persisted values
  and input identity, unequal rounds and three-member supersets. Inspected the
  375px, 393px and enlarged-text 375px Safari renders; headers remain readable,
  at least 44px tall and free of horizontal overflow. These are browser emulations,
  not physical-device checks.
- Full coverage: 130 files / 1,201 tests passed (87.48% statements, 81.34% branches,
  94.23% functions, 90.73% lines). The first run, concurrent with browser checks
  and lint, hit the existing ProgramBuilder capacity test's five-second timeout
  (5,191ms). The unchanged suite passed alone in 69.25s; no timeout was increased
  and no assertion weakened. Both logs are retained. Full lint and diff checks pass.
- Browser screenshots and results are preserved under the ignored
  `.playwright/auto-collapse-supersets/local-browser/` directory. Release receipts
  will be retained under `.playwright/auto-collapse-supersets/release/`; CI,
  immutable-image staging and promotion remain required before claiming live.
- Production build and TypeScript check passed. The first sandboxed build stalled
  at compilation with an idle worker and was stopped; the unchanged build completed
  outside the sandbox. Both build logs are retained.
