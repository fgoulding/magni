# Magni design refinement implementation plan

> Execute with the Magni coordinator and specialist team defined in `docs/engineering/team.md`.

**Goal:** Implement the five approved interface refinements and save reusable project-scoped engineering roles.

**Architecture:** Preserve existing workout identities, API contracts, progression and autosave. Refine component hierarchy and responsive layouts using existing semantic tokens. Keep agent definitions and handoff records in the repository; agents run on demand.

**Tech stack:** Next.js 16.3, React 19, Tailwind 4, SQLite, Vitest and Playwright Chromium/iPhone WebKit.

## Work graph and ownership

1. Coordinator: fetch remote, record baseline, save role definitions and plan.
2. Designer: research authoritative usability/accessibility guidance; record decisions in `docs/design/2026-09-30-refinement-research.md`.
3. Backend engineer: audit data contracts and risks; no schema change expected.
4. Frontend engineer: refine desktop prescription editing in `src/components/ProgramWorkspace.tsx` and its targeted tests. Keep mobile fallback and all load types.
5. Coordinator: refine `src/components/CalendarAgenda.tsx`, `src/components/WorkoutCard.tsx`, `src/app/today/page.tsx`, related styles/tests. No concurrent ownership of frontend engineer files.
6. Verification engineer: first check specification compliance, then correctness/accessibility review. Run coordinated browser checks and inspect screenshots. Findings return to the responsible implementer.
7. Coordinator: integrate, validate and release within existing authorization, recording exact evidence and any unmet release gates.

## Approved interface outcomes

- Calendar: one workout surface; borderless drag, More and Add controls with 44px targets; quieter rest rows; check mark for completion; neutral scheduled status. Preserve drag, Move, collision handling and navigation.
- Today: workout name first, program/week below; remove redundant labels/dates; Pause and Skip behind More; Start/Resume remains prominent. Preserve exact session and occurrence identity and document scrolling.
- Desktop editor: aligned Set / Reps / Load / Rest rows; advanced fields expand per row; sidebar is the desktop week/day navigator. Keep small-screen selectors and accessible labels.
- Shared visual rhythm: consistent spacing and controls, fewer uppercase labels, brand emphasis for primary actions and current selections.

## Validation

- Add meaningful regression coverage for newly hidden actions, editing every prescription type, responsive navigation and persistence.
- Run `npm run typecheck`, `npm run lint`, `npm run test:coverage` and `npm run build`.
- Run relevant Playwright suites with retries disabled against disposable data; capture actual iPhone viewport and desktop screenshots in `.playwright/design-refinement/` and inspect them.
- Run existing release gates before publication. Do not claim local screenshots validate a physical iPhone or live deployment.

## Status / evidence

- [x] Fetched origin on 2026-09-30: HEAD and origin/main both `ed9051f01703a28d5a0616e937786585625928d1` (0 ahead / 0 behind).
- [x] Persistent team definitions saved and validated (five TOML files; inherited model/permissions).
- [x] Research and backend contract audit complete; no API/schema changes needed.
- [x] Approved interface changes implemented, including shared status symbols in both calendar modes and their legend.
- [x] Independent specification and code review complete. Corrected an active planned workout being labelled scheduled in Month; added a regression. Release rehearsal tools also independently reviewed.
- [x] Local checks and independent screenshot review complete.
- [ ] Publication / deployment evidence recorded, or exact external blocker identified.

The four existing untracked September 5 private planning documents are excluded from commits.

Local checks on 2026-09-30: the initial 720-test suite passed with coverage 86.29% statements / 79.06% branches / 94.56% functions / 88.78% lines. Typecheck, lint and clean production build passed. Final unit coverage after the calendar status regression is recorded below. Initial parallel validation hit transient Node module-loading errors; the isolated full unit rerun passed. Removed stale generated `.next` duplicates and rebuilt with the network/process permissions Next needs.

Browser investigation: an interrupted full run is not acceptance evidence. Two calendar assertions timed out after their mutations persisted; fresh traced runs passed without changing navigation logic or increasing timeouts. The Repeat trace includes a 2.2-second development compilation, but the original failures lack traces, so their exact cause remains unproven. The desktop editor helper now waits for hydration before choosing responsive navigation. New advanced-select assertions use accessible combobox names instead of exact wrapping-label text.

Focused browser evidence: eight calendar/Today/prescription-execution cases passed across Chromium and iPhone WebKit, followed by four corrected editor cases with zero retries. These exercise all five load bases, advanced fields, copy/reorder/delete/reload, bulk editing/Undo, desktop/sidebar and phone/select navigation, 44px controls, long names, light/dark themes and enlarged text at 1440/1024/393px. Screenshots are in `focused/` and `prescription-row-recheck/` under the private evidence directory. Full CI release gates remain required before publication; focused checks do not replace them.

Private evidence directory: `.playwright/design-refinement/`. Live baseline was read back as `ed9051f` with image ID `sha256:dc5d3acb3004eec3c3f027427916167c70e9b5ca30cd5037c14c7f8fb28488e1`; no live deployment changes have been made yet.

Final unit suite: 721 tests across 73 files passed with the same coverage percentages above. Designer review caught rep digits clipped at 1024px with enlarged text despite adequate outer target size. Prescription rows now stack below `xl` while desktop navigation remains at `lg`; an additional usable numeric-content-width assertion guards against that failure. Both browser cases passed without retries in `readable-rows/`. The designer inspected the corrected 1024px, wide desktop and phone screenshots and closed the finding; no remaining visual blockers.

Final pre-commit typecheck, lint with zero warnings and production build passed (`build-final.log`). Fetched origin again immediately before integration: the baseline still matches `origin/main`, with zero divergence. Required full CI verification and exact-image staging/promotion are the remaining release gates.

Initial UI/team commit `51ae87e` was pushed to main. CI run `36727485462` correctly stopped publication at the production dependency audit: `baseline-browser-mapping` 2.10.32 is affected by GHSA-w5vr-8v7q-w6rv. Updated only that lockfile entry to 2.11.26 within the existing dependency ranges; the production audit now reports zero vulnerabilities. The live app remains on `ed9051f`, with Watchtower paused for controlled staging. No candidate image was published by the failed run.
The production build also passes with the patched dependency (`dependency-build.log`).

CI run `36728135541` at `8ccac35` passed the production audit, typecheck, lint, all 721 unit tests with coverage and the production build, but timed out during browser checks; publication was skipped. Its traces exposed a Calendar regression: preserving the truthful `in_progress` status sent planned occurrences to the quick-workout resume branch. Planned occurrences now mount the occurrence-specific logger again, while quick sessions retain their separate resume path. Active planned details retain the original scheduled date. Unit and browser regressions check exact session, occurrence and set identities, saved actuals and reloads.

Two iPhone WebKit progression cases also attempted Close before completion's route refresh replaced the modal. Trace evidence showed no pointer or click reaching Close. Their helper now waits for the rendered completion result before choosing whether a modal needs closing; assertions, retries and timeouts were not relaxed. The production browser rehearsal now includes History resumption, occurrence consistency and all planned progression cases alongside the design workflows.

Correction validation: all 722 tests across 73 files pass with unchanged coverage, production build, typecheck and zero-warning lint pass, and all 16 affected browser cases pass with zero retries. These checks ran from a clean temporary checkout of `8ccac35` with byte-identical reviewed edits after cloud-offloaded local files interrupted Git/Node reads. Private evidence has been copied into `resume-*` under the evidence directory. The iPhone WebKit resume screenshot shows the exact workout and honest original scheduled date. Independent review found no remaining code blockers.
