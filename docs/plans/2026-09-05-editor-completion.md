# Editor completion and retained-path correctness

> **For Claude:** Use superpowers:executing-plans to implement each task with a failing regression, focused verification and review before release.

**Goal:** Finish the required block/selection/active-edit workflows and repair correctness gaps found in the deployed-path audit.

**Architecture:** Retain the separate program workspace and immutable occurrence/session prescriptions. Add compact expandable authoring tools; apply active changes only through a reviewed, versioned transaction. Keep calendar dates independent of prescription revisions.

**Tech Stack:** Next.js 16.3, React 19, SQLite, Vitest and Playwright Chromium/iPhone WebKit.

## Design decisions

- A block is the consecutive group of weeks with the same nonempty block name around the selected week. Blank block names identify individual weeks. Copy the group immediately after itself with fresh structure IDs, a distinct block name, and intentional shared progression. A full block data-model replacement would add migration work without improving this operation; copying all identically named noncontiguous weeks would be surprising.
- Extend the collapsed bulk panel with selected-week checkboxes. Bulk rep/rest changes affect the selected weeks' work sets. A separate fill action copies the current lift's complete set prescriptions to appearances sharing its progression in selected weeks. Show the affected appearances first, preserve other lifts and progression configuration, and undo the whole operation together. Compared with an always-visible grid, this keeps phone editing compact while supporting desktop selection.
- Show whether the selected appearance's set prescriptions match the first appearance of the same lift or differ as a local override. Copied prescriptions are explicit snapshots; changing a source does not silently overwrite other weeks.
- Active edits require preview and an explicit scope: one unstarted occurrence, the remaining logical block, or the reusable definition. Keep existing started/completed prescriptions and occurrence identity/date intact. Check source revisions and affected snapshots at apply time; persist an operation ID so lost replies can be retried safely. Explain progression consequences in the preview.
- Retained legacy custom templates must freeze their progression semantics before edits/deletion can alter active sessions. Calendar repeats must use supported snapshot repetition, and occupied dates must acknowledge all visible workouts.

## Tasks

1. `src/features/program-editor/operations.ts` and `.test.ts`: add regressions for contiguous block copy, distinct identities, selected fill, preserved progression/designated sets and untouched unselected weeks. Run `npx vitest run src/features/program-editor/operations.test.ts`, observe failures, implement and rerun.
2. `src/components/ProgramWorkspace.tsx`, `.test.tsx`, `tests/e2e/program-editor.spec.ts`: add selected-week/fill/block-copy controls and override descriptions, unit interaction regressions and UI save/reload/undo proof. Inspect iPhone and desktop screenshots.
3. Editor repository/execution plus new scoped-edit service/API/component: add preview/apply revision guards, ownership, immutable versions, safe retries and frozen active/history tests. Integrate a separate panel into Review. Verify one occurrence, remaining block and reusable definition through browser workflows.
4. Legacy template resolution and Calendar paths: reproduce each audit defect with disposable data, repair narrowly, retain built-in compatibility and add relevant browser regressions. Independent agents own non-overlapping files.
5. Run the unchanged release gates, independently review changes, commit and publish within existing authorization. Rehearse the exact image against populated server staging before promotion. Preserve a fresh backup and rollback image, then verify live revision and original records. Physical iPhone checks remain pending while the user has disconnected it.

## Acceptance evidence

Record red/green logs, review findings, screenshots and release results in the private operational checklist. Earlier successful deployment evidence remains valid for that revision; it does not prove these new capabilities.
