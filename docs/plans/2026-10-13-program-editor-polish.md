# Program editor polish

## Objective and scope

The user asked to make the editor even better after approving the unified human-first builder. This pass refines that existing direction: shorter visual scanning, less re-entry, clearer prescription fields. Keep Import JSON wording, desktop-first layout and a usable phone fallback. No schema, API or progression-engine changes.

Freshly fetched baseline: `192f38ed63015cfd1ec351fb89c84f0c8985f560`, 0 ahead/0 behind remote main. Reuse the clean isolated checkout on `codex/program-editor-polish`; preserve unrelated primary-checkout plans. Baseline release passed 8 CI gates and 230 browser cases.

## Design

1. Each exercise/superset group has a manual disclosure header. Its closed summary retains exercise names and set/repetition/load targets; mixed prescriptions remain accurately represented. Initial cards stay open. Collapse is UI state, never a draft edit or completion marker. Keep it by stable day/group identity through reorder and day navigation; new/reused exercises open and receive focus. Reorder controls remain sibling buttons, never nested in the disclosure button.
2. Reuse the existing current-program exercise picker in the simple builder. Copy the full prescription with `cloneExercise(source, false)`, clear its superset label, preserve history lineage, remap designated-set references, use fresh IDs and independent progression. Append in one undoable document change; enforce 40 exercises. Do not merge or overwrite an existing lift.
3. Group Minimum/Maximum reps into one logical Reps fieldset. Desktop: Sets / Reps / Working weight. Phones: Sets and Weight first, then the paired Min/Max controls across the row. Keep explicit accessible names, 44px controls, roomy decimal inputs, meaningful metadata and full details.
4. Put the existing review validation summary before the workout listing. Keep its messages and activation guard; do not introduce a new validation framework.

Alternatives considered: copying whole supersets, new autocomplete and bulk-collapse toolbar. Deferred to keep the pass focused and avoid new semantics or growing global controls. Existing program exercise reuse supplies useful speed without network or identity changes.

## Ownership and dependency graph

- Coordinator: plan, `tests/e2e/program-builder-polish.spec.ts`, shared runtime/screenshots, integration/release.
- Frontend: `src/components/ProgramBuilder.tsx` and `src/components/ProgramBuilder.test.tsx`, plus the browser-discovered autosave correction in `ProgramWorkspace.tsx` and its tests; copy-only clarification in `ReuseProgramExercise.tsx` that progression is independent while history stays linked. Test behaviour first, then implement selected design. Reuse existing operations without modifying their shared contract.
- Designer: read-only review and rendered desktop/phone acceptance; authoritative accessibility references.
- Explorer: completed read-only audit of reusable picker/clone operations/autosave boundaries.
- Independent verification: requirements then code review, without editing or sharing runtime.

## Implementation and checks

1. Add focused failing tests for disclosure state without document mutations, stable collapse after reorder/day navigation, summaries for mixed sets, full independent reuse including designated targets and preserved source, reused focus, and review warning order. Run targeted Vitest under Node 22.
2. Implement disclosures, reuse and grouped rep fields with semantic tokens/native controls. Preserve existing details, autosave, undo and review/start behavior. Run affected builder/workspace/prescription tests, typecheck and lint.
3. Add a realistic Chromium/WebKit workflow covering collapse/reopen, exact source-preserving reuse, undo, autosave/reload, and review warnings. Capture 375px, 393px and 1280px, plus enlarged text; inspect images for clipping, overflow and crowded fields.
4. Resolve independent review findings. Run required release checks once for the final candidate, commit/push using existing authorization, and verify published/live revision. This is a schema-7-compatible editor release; the existing CI and backup/deployment policy apply, including same-schema populated-data preservation and recovery checks.

## Evidence

- Design and code audit complete; no backend/schema change needed.
- Designer references: [WAI disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/) and [form notifications](https://www.w3.org/WAI/tutorials/forms/notifications/). Use wrapping disclosure titles, explicit expanded state and sibling controls; keep correction messages available before activation.
- Implementation complete: 42 affected builder/workspace/progression unit tests and targeted lint passed after the final autosave fix. New browser tests cover the same operations, save/reload/undo, membership focus, layout and corrections.
- Independent review caught and fixed destination-group focus loss and missing collapsed cues. Membership changes reveal only the destination group and restore its native Details field; closed summaries retain per-set metadata.
- Browser testing found an existing Undo/autosave status bug: returning to the last acknowledged draft before autosave left it marked unsaved. The fix also retains uncertain save requests and retries the exact document/revision before saving newer edits or Undo. Four focused regressions cover no-write Undo, in-flight Undo, lost response and incomplete acknowledgement. Independent source review passed; server same-document idempotency and conflict guards are unchanged.
- The affected browser run passed 34 cases; the two new reuse workflows stopped on an ambiguous Details selector, now scoped to its native summary. All four new browser cases now pass in Chromium and iPhone WebKit, without retries. Together with the 32 unchanged affected cases, this verifies all 36 targeted cases after the save fix. Final screenshots inspected at 375px enlarged text, 393px light mode and 1280px desktop; no clipping or horizontal overflow in the edited controls.
- Designer reviewed rendered desktop, 375px enlarged-text dark mode, 393px light mode, decimal input, mixed prescriptions and leading review corrections with no material visual blockers. Physical iPhones were not tested.
- Same-schema release tooling prepared under ignored `.playwright/editor-polish/release/`, based on the proven phone UI coordinator. Baseline schema7, strict 44-table preservation, five staging backup/restore/compatibility checks. Static independent review found no guard defects; no deployment operations performed yet.

- Final local typecheck, zero-warning full lint and diff checks passed. Removed four unsupported Testing Library options and reran all 13 builder tests. Independent autosave review passed with no remaining blockers.
- Release publication, populated staging, production-image browser rehearsal and live verification remain required after commit; traceable receipts are retained privately under `.playwright/editor-polish/release/`.
