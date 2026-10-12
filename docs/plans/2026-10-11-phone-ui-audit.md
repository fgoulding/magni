# Phone UI audit and navigation fixes

## Design and scope

User requested an autonomous audit/fix pass, then supplied a Programs PWA screenshot showing excessive bottom-tab spacing. Retain the established design and training flows. Fetch confirmed clean task checkout at `b740e06`, equal to remote main; use `codex/phone-ui-audit`. Preserve four unrelated primary-worktree plan files and private release evidence.

Selected approach: repair concrete spacing, form and navigation issues. A broad visual redesign would increase churn; cosmetic-only changes would leave reproducible navigation failures. Routine choices and release are already authorized by the conversation/objective.

- Bottom tabs: use the actual safe-area inset once, removing the extra 8px and 12px floor. Keep 64px tab targets and a solid background reaching the viewport bottom. Share the navigation height/clearance arithmetic with the content shell; retain a small intentional content gap. Use readable muted text for unselected tabs. Preserve the home-gesture area.
- Add-exercise forms: fit numeric entries at normal phone sizes and reflow at enlarged text. Show weight units persistently. Preserve saved-set controls and all write/retry identities. Quick recent-exercise search must use the existing bounded API query and handle loading/error/retry and restored drafts without losing custom entry.
- Workout navigation: preserve validated return destinations through creation, recap and reload; successful standalone deletion returns to that destination/history, while Today stays on Today. Bottom-tab selection should reflect an explicit validated origin; direct/history visits retain Progress.
- Review follow-up: use the session unit for added exercises, preserve each authored set's explicit unit, and normalize mixed-unit recap totals before displaying them. No stored values, APIs or schema change.
- Defer broader calendar/chart redesign, history empty-state polish and completed progression disclosure to keep this pass bounded.

## Ownership and dependencies

- Root coordinates, owns `globals.css`, `layout.tsx`, design documentation, browser geometry/navigation regression integration, runtime, Git and release. Root captures baseline/final renders and owns all shared servers/builds.
- Frontend owns workout return-context/deletion/navigation changes and their focused tests, including BottomNav (also change unselected text to muted). Do not edit shell CSS/layout.
- Picker worker owns QuickExercisePicker and AddSessionExerciseForm, any shared numeric-field CSS, and focused unit tests. No backend schema/API changes.
- Designer read-only research/audit; independent verification reviews final requirements/code/screenshots. All workers preserve concurrent changes and leave Git/deployment to root.

## Verification and release

1. Capture failing geometry at mini375 and iPhone16 393, normal/enlarged text, browser/34px simulated PWA inset. Record root cause before changes. Add regressions for actual navigation/empty/error/search behaviors, not cosmetic class snapshots.
2. Verify nav flush to viewport bottom with exactly one safe inset, 44px minimum targets, content reachable above tabs, readable colors. Check decimal numeric entries, units and accessible labels in both add-exercise formats.
3. Verify Calendar/Progress return paths across create/reload/complete/delete, including rejected return URLs; preserve standalone/embedded workout behavior and existing save/recovery logic.
4. Focused tests, independent review, full unit coverage/typecheck/lint/build and applicable browser checks. Follow existing full CI, exact-image staging, populated backup/restore/rollback, fresh backup and guarded promotion; restore updater and verify live revision. Keep physical-device checks distinct from viewport/gesture emulation.

## Evidence

- Baseline WebKit reproduced 42px below tab targets with a 34px inset, 20px when the inset is zero, and larger redundant spacing with enlarged root text. Final geometry is exactly the injected inset at widths 375 and 393, root text 16/20/32px and insets 0/34px. The background reaches the viewport bottom; targets remain at least 64px.
- Unselected 11px labels used `text-faint` (~2.52:1 light / 3.44:1 dark); muted meets 4.5:1. [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) applies to operable unselected controls.
- Baseline exercise-entry captures reproduced decimal clipping at enlarged text in both forms and a missing persistent unit in the planned form. Final screenshots show `225.25` at both widths and all three text sizes; real POST/readback confirms the value is preserved.
- Navigation and search tests failed before fixes. Independent review caught the real Today entry link missing its origin; fixed and covered in both route and browser tests. Search fixtures now route GET and POST independently rather than assuming immediate GET ordering; rejection correction and exact uncertain-write retries remain asserted.
- Local browser pass: 48/48 Chromium and WebKit checks passed with no retries, covering changed layouts, Calendar create/reload/completion/return, Today origin, standalone deletion/reload, stable save toggles, hydration and existing workout execution. Root and independent verifier inspected actual captures. Evidence is private under `.playwright/phone-ui-audit/`.
- Typecheck and lint passed after quarantining four byte-identical duplicate generated `.next/types/* 2.ts` files; no source configuration or checks were weakened.
- Final local gates: 1,054 tests across 112 suites passed; coverage 87.32% statements / 80.85% branches / 94.19% functions / 90.07% lines. Typecheck, lint, production build and diff checks passed. Mixed-unit regressions cover both conversion directions and unchanged write payloads.
- Added a real API/browser search integration check: 30 newer lifts hide an older lift initially; entering its name and reloading restores the server search, then reuses its canonical identity and correctly converted load. Both Chromium and WebKit passed (2/2), bringing targeted browser evidence to 50 checks.
- Independent review approved the final changes and inspected 12 WebKit captures. No material findings remain. The paired iPhone 16 was listed as available, but iPhone Mirroring stalled connecting; physical installed-PWA verification is not claimed.
- Fetched remote again before integration: still equal to baseline `b740e06`. CI publication and exact-image staging/promotion are the remaining release gates. Their receipts and final revision belong in the private release evidence directory, avoiding a documentation-only redeployment after promotion.
