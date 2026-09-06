# Desktop program workspace and draft deletion

**Goal:** Make drafts removable, distinguish Undo from navigation, and give program creation a dedicated desktop layout.

**Design:** Keep `/programs/editor` in the existing authenticated application. Use a wide desktop canvas, persistent week/day outline, and existing prescription/progression panels. Put Back to programs at the upper left and visibly label Undo in the editing toolbar. Keep the phone fallback usable without adding more phone-specific authoring controls. Programs links to this workspace and presents draft deletion directly.

**Data:** Delete only unpublished drafts. Use an additive deletion marker to prevent delayed autosaves or old links from recreating a removed draft. Check ownership and expected revision; retries are safe. Activated source drafts and historical snapshots remain intact. Separate these from unfinished drafts in the library.

**Implementation and verification:**

1. Reproduce missing deletion and icon-only Undo on disposable data; capture desktop/iPhone screenshots.
2. Add failing draft deletion route tests for ownership, stale revisions, retries, resurrection, activation protection and malformed requests. Implement marker migration and guarded API.
3. Add a reusable draft-delete confirmation control to the library and editor. Wait for editor saves before deletion; clear pending local storage only after success. Label Undo and verify Back preserves edits.
4. Widen only the editor shell on desktop, add its landing page and week/day outline, and retain the existing phone training layout. Document design-system rules.
5. Verify deletion/cancel/reload/navigation through browsers and inspect desktop/iPhone screenshots. Run appropriate unit, lint, type and build checks and the release pipeline before publishing. Use existing deployment authorization and disposable staging; no manual iPhone test required.

Unrelated proposed features (timers, loading helpers, substitutions) are outside this change.

## Implementation evidence

Implemented draft deletion in Programs and the editor, visible Undo beside Save, guarded Back with an explicit exit on save failure, and a dedicated desktop workspace with a week/day outline. Deleted identities reject stale saves and reopened URLs; activated source drafts remain separate.

Local verification: 716 tests across 72 files, required coverage, lint/types/build, 24 editor/workspace browser cases, then 8 final workspace cases after review fixes, all with zero retries. Desktop and iPhone viewport screenshots inspected in light/dark and enlarged text. Populated migration preserves all original rows/columns and deletion markers on replay. Private evidence: `.playwright/editor-desktop/`. Release CI and exact-image staging are tracked separately in `.playwright/production-goal/desktop-workspace-release/`.

Startup migration regression: a populated revision-three database bypassed the new deletion marker because initialization skips current revisions. Increment the schema revision to four and test the real module initialization against an existing revision-three database, checking every original row and column. Server upgrade checks must assert the deletion column exists, not only health and data preservation. A rollback to the previous release requires restoring its matching revision-three backup; that release must refuse the newer schema without modifying it.


## Calendar header follow-up

The user requested replacing the Week title with the displayed date range, keeping the Week/Month switch beside it, putting Today on the same row as the week arrows, and removing the persistent Undo last change and Select workouts controls. Use a short month/day range so the top row stays compact on an iPhone. Remove the now-unreachable bulk-selection interface and misleading undo copy; retain the calendar action API and its service coverage. Update browser tests to reflect the requested removal, preserve individual move/swap/duplicate/skip checks, and verify header alignment, Today navigation, month boundaries, touch targets, and enlarged-text overflow through screenshots.

Verified 717 tests/72 files and configured coverage, lint, types and production build. All 14 calendar browser journeys are covered by the initial run and focused reruns after test-helper corrections, with zero retries. Screenshots inspected on desktop and iPhone in light/dark and enlarged text. The standalone production build upgrades a populated revision-three copy to four, adds the deletion field, and preserves all original rows/columns in 35 tables. CI and exact Linux-image staging remain separate release gates.
