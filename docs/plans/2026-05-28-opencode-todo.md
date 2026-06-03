# Opencode Handoff TODO

Date: 2026-05-28
Branch merged from: `codex/shared-program-sync`

## Current State

Shared program sync work has been implemented through Task 7 of `docs/plans/2026-05-26-shared-program-sync-implementation.md`.

Completed and reviewed:

- Task 1: shared program storage migrations.
- Task 2: shared program snapshot parsing and diffing.
- Task 3: shared program repository and permission rules.
- Task 4: workout history, version context, reordering storage, and skip storage.
- Task 5: sync, expected maxes, rollback, and live-row hardening.
- Task 6: shared program API routes and skip workout endpoint.

Implemented but not independently reviewed due Codex credit limit:

- Task 7: default program library and start flow.

## Verification Baseline

Most recent known verification from Task 7 implementation:

- `npm run test -- src/features/program-defaults/defaults.test.ts src/components/CreateProgramForm.test.tsx src/app/api/programs/program-routes.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm run test`

Expected full suite after Task 7: 21 test files, 142 tests.

Before continuing, rerun:

```bash
npm run test
npm run typecheck
npm run lint
npm run build
```

## Immediate Review TODO

Review Task 7 before building further UI:

- Confirm default program snapshots are valid and stable-keyed.
- Confirm `CreateProgramForm` can start blank, start from defaults, save a loaded shared definition as a new private program, and post a loaded snapshot as a shared update payload.
- Confirm `/api/programs` snapshot materialization preserves day and exercise order through `sort_order`.
- Confirm default-created exercises using the temporary training max of `100` do not create a confusing workout experience before users set expected maxes.

Potential Task 7 follow-ups:

- Consider adding a small expected-max step before creating a program from a default.
- Consider extracting `/api/programs` snapshot materialization into a reusable feature module if Task 8 needs it.
- Consider stronger user-facing copy around default-created training maxes.

## Remaining Plan

### Task 8: Shared Program UI

Build UI for:

- Creating or viewing shared programs.
- Adding invited admins and members.
- Publishing new shared versions.
- Loading an existing shared version into the editor.
- Reviewing diffs before sync.
- Applying sync with expected max confirmation.
- Rolling back to a previous version.

Key files from the original plan:

- `src/app/programs/[id]/page.tsx`
- `src/app/shared-programs/[id]/sync/page.tsx`
- `src/components/SharedProgramPanel.tsx`
- `src/components/SharedProgramSyncReview.tsx`

Important product constraint: shared definition wins on sync, while personal loading and history remain private.

### Task 9: First-Class Today Workout Execution

Make workout execution feel more important than setup:

- Stronger Today screen hierarchy.
- Clear start or continue workout actions.
- Non-blocking shared update prompt when a newer version exists.
- Skip workout action in the workout surface.
- History should show completed and skipped sessions.
- Session displays should include shared version context when available.

Also make sure logged sets continue to store:

- Working weight.
- Actual reps.
- Implied max where applicable.
- Shared program version used for the workout.

### Task 10: Contributor Docs

Document:

- How to add default programs.
- How to add training/progression templates.
- Shared program versioning model.
- Sync, rollback, and expected max behavior.
- Lift history, implied maxes, working-weight tracking, and workout-version history.
- iOS PWA limitations and current app choices.

### Task 11: Full Verification

Run and fix anything from:

```bash
npm run test
npm run typecheck
npm run lint
npm run build
```

Manual smoke path:

- Create an account.
- Create a program from a default.
- Start and complete a workout.
- Skip a workout.
- Create a shared program.
- Add an admin/member.
- Publish v2 with renamed or reordered lifts.
- Apply sync with expected maxes.
- Roll back to v1.
- Confirm history still shows the version used when the workout was performed.

## Known Residual Risks

- Task 7 still needs independent spec and code-quality review.
- Default-created exercises currently use `100` as a temporary training max.
- `assertSameOrigin` rejects explicit cross-origin browser requests but allows requests with neither `Origin` nor `Referer`; token-based CSRF could be stronger later.
- Rollback accepts any valid target version and records action `rollback`; UI should constrain this to previously applied or earlier versions.
- Existing ghost sessions from older buggy local DB states are not cleaned up by migration; new empty ghost sessions are prevented.
