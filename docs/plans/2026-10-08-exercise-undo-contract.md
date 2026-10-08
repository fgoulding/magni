# Exercise set undo contract — 2026-10-08

Part of [unified exercise cards](2026-10-08-unified-exercise-cards.md). Baseline: `1bace30c247ab738dd779983b3de56d7ac528c44`.

## Decision

No backend, database schema or migration change is needed. Both Quick Workout and planned WorkoutCard already use `PUT /api/sessions/:sessionId/sets`, which accepts nullable actuals through `saveActualSet` in `src/features/workouts/history-service.ts`.

Mark a saved set unlogged with:

```json
{
  "setId": 123,
  "actualReps": null,
  "actualWeight": null,
  "expectedActual": { "reps": 8, "weight": 42.5 }
}
```

The sample values are illustrative. The UI must send the acknowledged saved values for that specific set as `expectedActual`. Null reps means unperformed; zero reps remains a performed attempt. The response must explicitly acknowledge **both** actual fields as null. Missing fields or an invalid response are not success.

## Preserved boundaries

- The authenticated owner must own the session; the set must belong to that session. Writes also enforce same origin.
- Undo is available only while the workout is in progress. Completed workouts retain their dedicated audited correction workflow.
- Updating actuals preserves the stable session/set/occurrence identities, exercise source links, notes, frozen prescription, progression metadata and other sets.
- Changed actuals increment session revision once. An identical null retry is acknowledged without another increment. A changed saved value produces 409 until the user explicitly resolves the conflict.
- This is the existing value-based compare-and-set contract, not an operation-ID ledger: it cannot distinguish a value changing away and later back to the identical saved pair. Do not silently retry against newly fetched actuals or claim version-level serialization.
- Undo itself does not apply or reverse progression. Planned completion still validates needed progression reps and applies advancement once. Quick completion excludes undone sets from performed totals. Completed sessions cannot be unlogged through this endpoint.
- Some legacy rows represent multiple physical sets (`sets > 1`). Preserve their real IDs and batch semantics; do not invent independently editable physical set IDs or split historical rows. Label the stored batch appropriately in the UI.

## Frontend integration requirements

1. Offer Undo for the latest acknowledged save, and Mark unlogged for older acknowledged sets. Disable competing operations while the relevant request is in flight. Do not clear the saved state optimistically before acknowledgement.
2. Retain weight/reps inputs locally after successful undo. Use a distinct unlogged input state from unsaved changes: the existing generic draft-presence checks block Finish, so retained values must not make an acknowledged undo permanently pending.
3. Keep a recoverable null-write intent on failed, lost or unconfirmed responses. Retry the same set and `expectedActual`, not the normal numeric save. Display conflict resolution without discarding local inputs.
4. Reopen the appropriate exercise/set after undo, remove its acknowledged completion mark and recompute completion summaries. Do not automatically collapse over focused edits, failed saves or conflicts.
5. Apply returned `sessionRevision` and session metadata, particularly in Quick Workout where structure editing relies on the latest revision. Preserve edits made while a request was in flight.
6. Finishing must wait for pending writes. Undo must not issue a request once finish is in progress or confirmed. The server remains the final active-session guard.

## Verification

New API contract suite: `src/app/api/sessions/set-unlog-contract.test.ts`.

Command in the isolated worktree:

```sh
PATH="/private/tmp/magni-runtime-20261006/node_modules/.bin:$PATH" npm test -- src/app/api/sessions/set-unlog-contract.test.ts
```

Result: **7 tests passed**. These verify existing backend behavior before exposing Undo in the UI; they are contract tests, not evidence of a new backend fix.

Also passed: `npx eslint src/app/api/sessions/set-unlog-contract.test.ts` and `npx tsc --noEmit --incremental false` with the same runtime PATH. Typecheck initially caught an unannotated test array; the test-only annotation was corrected and the check passed.

Covered: preserved prescriptions/identities/notes and other sets; null retry with stable revision; stale-device conflict with explicit resolution; zero-rep distinction; ownership/set containment/auth/same-origin rejection; quick finish totals and completed-record protection; planned undo, required progression reps, relog, completion retry and progression applied once.

Every test uses a fresh disposable SQLite database and synthetic users. No production training data was accessed. Frontend draft persistence, interactions and screenshots are separate coordinator/frontend verification work.
