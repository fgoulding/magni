# Calendar month navigation implementation plan

**Goal:** Browse previous/next months and return to today directly in Month mode, and explain the current matching-record workflow.

**Architecture:** Keep the existing compact Week toolbar. Add a matching Month toolbar below the shared heading, using server-rendered Next links. Adjacent-month links use the first day of the destination month, avoiding date overflow and stale week context. Today uses the account's training timezone. No database/API change or exercise matching behavior change.

**Tech stack:** Next.js 16.3.8, React, semantic Tailwind tokens, Vitest and Playwright Chromium/WebKit.

## Context and ownership

- Fetched remote before editing: `0e5fe966af2eac1847ab3fac6556d0bd7f59534d`; no divergence. Preserve the original workspace's four unrelated untracked plans.
- Reuse the clean prepared checkout `/private/tmp/magni-audit-20261006-ifiyj9wj` on `codex/calendar-month-navigation`; coordinator owns source, tests, browser/build resources and release. The attached managed checkout stays available for synchronization.
- Root cause: navigation is inside `CalendarAgenda`, which is hidden in Month mode. The earlier request to remove month arrows is superseded by the user's explicit request to restore month browsing.
- Read the design system and installed Next Link/page documentation. The existing toolbar design and this correction are authorized; no new design approval is needed.
- Backend agent: read-only trace of matching behavior and its current entry path. Independent verifier: review the final calendar diff and evidence.

## Implementation and validation

1. Add failing route regressions in `src/app/calendar/page.test.tsx`: month/year boundaries, leap February, stale date, account-timezone Today, and unchanged Week mode.
2. Run the route test with Node 22 and capture the expected missing-navigation failure.
3. Update `src/app/calendar/page.tsx` with Month navigation, Today, and labelled 44px arrow links. Preserve Month mode and clear open-workout selection when moving months.
4. Add a browser journey in `tests/e2e/calendar-rearrange.spec.ts` covering repeated month navigation, reload/back, Today, switching to Week, and light/dark enlarged iPhone screenshots.
5. Update `docs/design-system.md` to describe navigation in both modes.
6. Run focused route/calendar/browser checks, typecheck, lint and production build. Review iPhone screenshots and resolve independent review findings. Then run the existing clean-commit CI/release gates and exact-image staging before authorized deployment.

## Matching-record explanation

Progress → choose exercise → All recorded workouts → Included records → Add matching records. Search another recorded name, select workouts, review, then connect. Different spellings can be connected manually; fuzzy matching and remembered aliases are not implemented. A single existing exercise identity opens its graph; multiple separately logged same-name identities can show the explicit matching prompt. Linking only affects selected historical Progress grouping.

## Evidence

- Four route regressions failed on the missing Month navigation before implementation. All 35 focused route/navigation/agenda tests then passed, including the unchanged Week case.
- All 877 unit/integration tests in 97 files pass. Coverage: statements 87.03%, branches 80.38%, functions 93.98%, lines 89.88%.
- All 16 calendar browser journeys pass on Chromium and iPhone WebKit with zero retries, including month/year changes, Today, reload/back, Week switching and existing rearrangement/history workflows.
- Root and independent verification inspected the iPhone light/enlarged-dark and desktop screenshots. Controls remain aligned, at least 44px, with no horizontal overflow. The enlarged month title wraps without colliding with the view switch.
- Independent verification approved the final diff and independently passed all 27 calendar route tests. Strict lint, route type generation, typecheck, production build, dependency audit (zero vulnerabilities) and release-policy checks pass.
- Existing same-schema release tooling is reused with the new baseline and calendar browser coverage; 15 private recovery/updater policy tests pass. No data migration or source changes to matching records.
- Full clean-commit CI, exact-image staging and authorized deployment remain release gates. Final evidence will be archived under `.playwright/calendar-month/release/`; its `final-result.json` determines deployment completion. Physical iPhone checks are not claimed.

### CI test-readiness correction

The first CI run (`37684454203`, commit `47457fa`) passed seven release gates and 156 browser cases but failed the new journey in both engines; no image was published. Trace evidence showed the iPhone install hint mounting between two separate geometry measurements, and Chromium Back occurring before the freshly reloaded Next router had installed its history handler. The test now measures all navigation controls in one layout snapshot, waits for the fresh router announcer, and asserts URLs before reload and after Back. It preserves the same touch-target/alignment limits and all navigation assertions. Independent review approved the test-only correction; six repeated local journeys passed across both engines without retries. Product code is unchanged from the reviewed fix.
