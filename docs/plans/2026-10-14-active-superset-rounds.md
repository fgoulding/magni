# Active superset rounds

## Goal and accepted direction

The user explicitly requested active workouts to retain supersets and display alternating sets vertically as 1a, 1b, 2a, 2b, with one action completing the paired round. Implement this in the shared planned logger used by Today, Calendar and planned resume. Retain individual controls, manually collapsible cards and the existing green-check Undo interaction. The previous release is cfb3db497d4310eacd2f664daeb77b2636bb26fc; fetched remote matches (0 ahead/behind). Reuse the clean checkout on codex/active-superset-rounds and preserve primary checkout's four unrelated untracked plans.

## Design and contracts

- One superset card, ordered into rounds. Each round presents its existing member rows top-down with a visible identifier and name (1a Squat, 1b Row). Keep editable reps/load and authored role/range/effort/rest/tempo/notes per row.
- Round header: Round N, saved count and one clearly named completion control. Save only unsaved/edited rows; when all are acknowledged, the green control can Undo the round. Individual checks remain available for partial rounds and corrections. Stable controls and row IDs preserve focus and entered values.
- Disable round actions while saving or while any member has unresolved Undo/conflict. Existing individual recovery remains available. Sequential writes may partially succeed: retain each acknowledgement, leave failed/unattempted members pending, retry only remaining members, never present an incomplete round as fully saved.
- Pure view projection partitions by authored appearance, preserving original row identity/order. Identity precedence: editor exerciseId, program_definition_exercise_id, exercise_key; legacy fallback uses consecutive name runs split on name or set_number reset. Never use progression identity to collapse separate appearances. Round k contains the kth existing set from each appearance; shorter later rounds never invent partners. Support three or more lifts. Do not rewrite frozen prescriptions or persisted set order.
- Existing aggregate rows (sets > 1) remain explicitly labelled batches; they cannot be split into independently recorded physical rounds without data changes. A superset label with fewer than two appearances retains its ordinary list.
- Existing WorkoutCard.saveSets already validates all submitted values, persists drafts, conditionally saves and acknowledges each row. Reuse it; no API/schema changes. Quick Workout currently cannot acquire superset metadata through creation, repeat or routines, so keep its existing grouping/save behavior while retaining shared-row compatibility.

Alternatives considered: an atomic multi-set API or restructuring stored rows. Neither is necessary for one-tap round completion; existing per-row acknowledgements provide recoverable partial progress without migrations. Saving every round of a superset at once would not match the user's training sequence.

## Ownership and workflow

- Coordinator: this plan, design-system guidance, new tests/e2e/active-superset-rounds.spec.ts, runtime/screenshots, integration/release.
- Explorer/backend audit: read-only contract/identity review, complete; no backend change required.
- Designer: read-only accessibility/layout recommendations and actual render review.
- Frontend: WorkoutCard.tsx, ExerciseLogCard.tsx, workout-card-utils.ts identity types, new superset-rounds.ts/test and WorkoutCard.supersets.test.tsx. No runtime or Git ownership. Do not revert concurrent work.
- Independent verification: read-only requirements and code review after implementation; root owns all browser/build/database operations.

## Implementation and verification

1. Write and observe failing unit tests for exact interleave/identity, unequal counts, duplicate names, three-member groups, batch fallback and original-source preservation.
2. Add round controls and shared string row labels; test exact requests, validation-before-write, existing saved member exclusion, partial failure/retry, pending Undo/conflict protection, round/individual Undo and edits during a save. Preserve ordinary/Quick behavior.
3. Add real browser workflows covering Today -> Calendar/resume, exact saved IDs/actuals, individual and round Undo, dirty collapse/reopen/reload, conditional conflict, a lost response and partial failure. Capture 375px and 393px, light/dark, enlarged text and desktop. No horizontal overflow or squeezed numeric fields; 44px controls.
4. Resolve independent findings, run affected units, typecheck, lint and targeted Chromium/WebKit checks. Then run complete required CI once for the final candidate.
5. With existing deployment authorization, pause updater and verify backup before push/publication. Rehearse same-schema populated startup/restart/backup/restore/rollback, relevant production-image browser workflows, promote only verified immutable image, check live revision/PWA health and restore updater. Retain receipts privately; physical-phone checks are separate from emulation.

## Evidence

- Remote baseline clean and current. Read project team/design guidance and installed Next server/client boundary docs.
- Explorer confirmed existing saveSets and conditional per-set replay contract; no API/schema changes needed. Quick repeat/routines deliberately lack superset metadata today.
- Implemented view-only round projection and stable group controls using existing saveSets. Expected failing unit tests observed before implementation; focused projection/component and affected logger tests pass.
- Independent source/contract review found no blockers, including captured submissions, newer edits, partial Undo, identity and legacy fallback.
- The initial four new end-to-end cases passed on Chromium and iPhone WebKit with no retries: interleave, exact writes, individual/round Undo, Today-to-Calendar resume, saved reload, lost-response replay and concurrent conflict resolution. Final screenshots will align the round at viewport top to inspect both member rows.
- Designer guidance follows [WAI buttons](https://www.w3.org/WAI/ARIA/apg/patterns/button/) and [WCAG status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html); contextual atomic round announcements added without changing visible layout.
- Same-schema guarded release scripts prepared under ignored `.playwright/active-superset-rounds/release/`; independently reviewed baseline/constants/scope against the previous release. No deployment operations performed yet.

- Screenshot review exposed a stale conflict message after accepting saved values. Track whether errors originate from a set or a workout action; resolved set recovery now clears its message only when no other failed/conflicted row remains. Independent review also caught fail -> edit -> discard; matching the stored error origin handles that case after editing clears the failed marker. Both regressions failed before the fixes; 21 focused component/projection tests pass. Final independent source review passes.
- One intermediate browser run had a Chromium Start Workout response timeout while app source was being edited; WebKit and the other Chromium case passed. No request was observed and the page remained at Start Workout. Freeze source and rerun with failure traces; this run is not release evidence.
- Frozen-source rerun passed all four new browser cases with no retries (1.1 minutes), including the recovered-state error assertion; final screenshots include both round members. Final typecheck, zero-warning lint and 131 affected unit tests across 12 files pass. Full publication CI and production-image rehearsal remain release gates.
- First publication attempt 38585141121 passed all core gates but browser CI exposed three existing superset workflows with numeric-only selectors: planned-presets, program-builder and simple-program-setup. Update those selectors to the intentional lettered labels while retaining save/reload/progression assertions. No product behavior change or gate weakening; include all three workflows in final production-image staging. No candidate was published or deployed.
- Independent review confirmed the three selector adaptations preserve every prior assertion and found no other affected numeric-only superset selectors. All 22 cases across those three specs now pass locally in Chromium and iPhone WebKit with no retries (2.3 minutes); targeted lint and diff checks pass.
