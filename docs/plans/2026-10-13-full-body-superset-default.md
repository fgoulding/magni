# Full Body Supersets default implementation plan

**Goal:** Make the user-approved three-day full-body program a reusable Magni default.

**Architecture:** Use the existing rich editor document and preset factory, preserving rep ranges, individual sets, superset groups, bodyweight and technique notes through activation. Expose a workspace starter and the existing preset selector. Legacy shared snapshots cannot express the agreed prescriptions faithfully. No schema changes or modification of existing programs; session start also needs a narrow compatibility fix for editor prescriptions without a training max, described below.

**Tech stack:** Next.js 16.3.8, React, TypeScript, SQLite, Vitest and Playwright.

## Approved design

User iteratively approved the following, then requested creation as a default. A and B have five sets of each exercise; C has three. All days total 26 working sets. No pair has two barbell lifts. Abs are separate. No push-ups, chest-supported rows or overhead triceps extensions.

| Day | A (5 rounds) | B (5 rounds) | C (3 rounds) |
| --- | --- | --- | --- |
| Squat | Barbell back squat 4–6 + one-arm DB row 8–12/side | DB RDL 8–12 + barbell Spoto press 6–8 | Pull-up 5–10 + DB lateral raise 12–20 |
| Bench | Barbell bench press 4–6 + B-stance DB RDL 8–10/side | KB Bulgarian split squat 8–10/leg + standing DB overhead press 8–12 | One-arm DB row 10–12/side + DB lateral raise 12–20 |
| Deadlift | Barbell deadlift 3–5 + incline DB bench press 8–12 | KB goblet squat 10–15 + pull-up 5–10 | One-arm DB row 10–15/side + single-leg DB calf raise 12–20/side |

- Name: Full Body Supersets 3-Day; preset ID: full-body-supersets-3-day.
- Default editable schedule: Monday/Wednesday/Friday; one week repeated four times, matching existing preset conventions.
- Choose working weights before training; no invented maxes or automatic load increments. Manual progression note: raise by the smallest practical increment after all sets reach the upper rep target at intended effort.
- Two reps in reserve, easier A partner at three. Warm-ups additional. Allow 3–4 minutes between main lift sets; brief transition inside pairs, 90–120 seconds after B/C pairs. Extend rest as needed.
- Store actionable cues per set because exercise-level notes are not frozen into workout prescriptions. Spoto one-second hover above chest; unilateral reps are per side; rows use free-hand support, never chest support.
- Fresh document/set/slot identities per creation; repeated identical exercises share tracking within a template, while day-specific loading stays independent.

## Baseline and ownership

Fetched origin/main: d7bfc0e, zero divergence. Reuse clean `.worktrees/unified-exercise-cards` on new branch `codex/full-body-superset-default`; preserve four unrelated untracked plans in primary checkout.

- Root: coordination, plan, workspace starter and validated preset entry routes, browser/activation checks, shared build/server, Git and release.
- Backend specialist: new preset factory, operations registration and focused contract tests only.
- Independent verifier: requirements/code review after implementation, no shared runtime mutation.

## Steps and acceptance gates

1. Add focused tests for approved exercise/sets/ranges, identity isolation, valid documents and notes. Establish expected missing-preset failure before implementation.
2. Implement factory and preset registration using existing document constructors. No legacy format downgrade.
3. Add visible default starter to workspace and allowlisted `preset` entry query. Existing saved drafts and owned duplicate sources take precedence; reload cannot overwrite edits.
4. Exercise starter → edit loads → save/reload → activate → frozen workout in disposable data. Verify 12 scheduled workouts, 26 sets per day, exact ranges/groups, bodyweight and Spoto notes. Capture desktop and iPhone 13 mini/16 browser layouts.
5. Run independent review, focused checks, full coverage/typecheck/lint/build and relevant browser tests. Fix findings without weakening checks.
6. Commit/push under existing release authorization; verify CI image, exact-image staging and populated backup/recovery/rollback, then guarded promotion and live revision. Record receipts privately; distinguish browser from physical iPhone checks.

## Evidence

- Implemented the rich preset, selector registration, visible workspace starter and allowlisted preset entry. Saved drafts and owned duplicate sources take precedence on reload. Working weights are user-selected, with manual progression and no guessed max.
- Factory contracts failed before implementation, then passed. A new repository integration check freezes all 12 scheduled workouts with 26 individual sets each and exact ranges, groups, cues and selected weights; activation retry creates no duplicates.
- Real browser activation exposed a pre-existing missing-max incompatibility: the editor accepts training max 0 for manual/bodyweight prescriptions, while the legacy session column requires positive values or NULL. Session start now projects only the editor's zero max to NULL in that column, preserving authored zero and selected load in editor metadata. Regression failed with HTTP 500 before the fix; all three default days now start/retry/log/complete without changing manual progression. No migration.
- Full unit/coverage pass: 1,063 tests in 113 suites; 87.38% statements, 81.03% branches, 94.21% functions and 90.13% lines. Lint passed. Final typecheck found a nullable test index; explicit guard fixed it and typecheck plus the affected seven tests passed.
- Browser evidence: four new default workflows passed without retries in Chromium/WebKit, including edit/save/reload/activate/start, exact Spoto range/cue, 26 saved sets, phone 375/393 actionability and dark enlarged-text renders. Ten existing workspace workflows also passed. A test locator was corrected to the actual combined superset heading; no product behavior or assertion requirement was weakened.
- Independent review found no blockers after verifying requirements, route/source ownership precedence, manual-load projection and fresh/shared identities; the reviewer independently passed 40 and 56 focused tests and inspected desktop, active-workout, 375px and 393px WebKit captures. Root inspected desktop and 375px action captures. Physical iPhone testing is not claimed.
- Existing generic logger displays all sets of the first superset member before its partner. Interleaving rounds is deferred UI work; this content release preserves the shared logger and authored pairing.
- Production build passed. Publication, exact-image staging and promotion receipts are recorded privately under `.playwright/full-body-default/release/`; final release gates pending.
