# Unified Program Builder Implementation Plan

**Goal:** Make template selection, manual program building and JSON import understandable through one visual editor, including authenticated direct submissions that create private drafts.

**Architecture:** Retain the rich document, owned draft repository, immutable activation and current training engines. Add a public versioned file contract with adapters, import-only credentials and idempotent private import receipts. A day-based builder edits the same document without losing advanced fields. Preserve legacy original-system behavior behind the consolidated entry surface.

**Tech Stack:** Next.js16.3.8, React19, TypeScript, SQLite, Node22, Vitest and Playwright.

## Baseline and authorization

- User approved private draft review and the exact label Import JSON after the design proposal. [Design contract](./2026-10-13-unified-program-builder-design.md).
- Fetched origin/main at d477d97d980c79294ff4d697b5527cd85834cc48 with0/0 divergence. Reuse clean `.worktrees/unified-exercise-cards` on `codex/unified-program-builder`. Preserve four unrelated untracked plans in primary checkout.
- Baseline release is live and verified:1,087 unit tests,218 CI browser cases,42 exact-image staging cases, schema6. Do not repeat unchanged baseline tests just for ritual. Existing automatic updater is running; pause and back up before publishing this candidate.
- Use Node22 at `/private/tmp/magni-program-default-node22/node_modules/node/bin`; existing native dependencies match it. Coordinator alone owns shared browser/build runtime, Git and release. No worker commits or deployment.

## Ownership and dependency graph

1. Backend owns `src/features/program-files/`, `src/features/program-imports/`, new import/token/schema/example API routes, `src/proxy.ts` and tests, database schema/migration files and tests, public file examples/schema documentation. Publish function/API contracts to frontend before dependent integration.
2. Frontend owns the human builder and import/credential UI components and tests; Programs/new/editor/import routes; necessary integration with existing ProgramWorkspace, CreateProgramForm and SimpleProgramSetup. Coordinate any shared contract change with backend. Do not edit backend migrations/APIs or E2E files.
3. Designer owns visual contract refinements in the design note, and reviews actual coordinator screenshots. No app/runtime changes.
4. Coordinator owns this plan, end-to-end coverage/compatibility helpers, integration, app runtime, full checks and release. Independent verifier reviews completed requirements then code quality, without silently fixing code.

Respect four active slots. Disjoint backend/frontend work can proceed concurrently after a stable interface agreement. Rotate designer into verification when implementation is ready.

## Tasks and acceptance

### 1. Public program file and import adapters

Backend first writes focused failing tests in `src/features/program-files/*.test.ts` for public-format round-trip, rich/template compatibility, absent personal start date, complete advanced fields, designated-set references, unknown versions/fields, invalid data and size limits. Implement a small shared client-safe parser/exporter plus static JSON schema and complete example. Preserve all executable prescription semantics; never evaluate imported code. Expose typed normalization/export interfaces, and document them here. Run Node22 Vitest on the focused files and record failure-before-implementation and final pass evidence.

### 2. Owned private imports and credentials

Write failing real-SQLite and route tests covering cookie and bearer authentication, same-origin browser writes, token expiry/revocation/ownership, no raw token storage/listing, retry with same key/payload, conflict on same key/different payload, deleted-draft retry, and no activation or cross-user access. Add credential/import receipt tables in schema7 and test upgrade from populated schema6, repeat startup and backup compatibility. Import normalization and draft persistence must commit atomically; map IDs once and retain result for retries. Return a draft/review URL, never create a schedule on submission. Publish route payload/response types for UI and direct-upload documentation.

### 3. Human builder

Write meaningful component/operation tests before implementation: add/edit day, add superset, copy/reorder, compact identical sets, mixed set preservation, independent loads, designated-set references, lossless JSON export, save/reload and failed-save recovery. Implement the accepted day-based card layout using the same ProgramDocumentV1 and owned draft/activation APIs. A normal three-day program must not require navigating the old structure/prescriptions/progression tabs. Keep advanced capabilities, active-change safety and legacy original-system evaluation available. Use semantic tokens and installed Next.js docs. Run only owned focused tests during development; coordinator will run shared checks.

### 4. Import JSON and consolidated navigation

Programs exposes Choose a program / Build a program / Import JSON without duplicate workspace/original-system marketing links. File upload, paste and direct submission all produce a fresh private draft in the common builder. Provide example/schema/authoring instructions and revocable import credential controls. Keep input on invalid JSON/network errors; show human paths and actionable corrections. Existing links/files remain compatible or redirect deliberately. Ready rich templates enter the common builder with their exact prescriptions; original systems remain reachable without conversion loss.

### 5. Browser and independent verification

Coordinator adds `tests/e2e/program-builder.spec.ts` and `tests/e2e/program-import.spec.ts`. Exercise manual3day/superset creation, template editing, actual scheduling/start/log/reload, JSON export/import of advanced content, malformed file recovery, interrupted import retry, token direct submission/expiry/revocation/ownership, private draft visibility and zero workouts before Start. Update legacy browser navigation assumptions explicitly while retaining their engine/workflow assertions. Inspect375/393/320px and desktop1280 renders, dark/light,20px text, mixed sets, decimal input, keyboard/final action reachability. Designer reviews real images; verifier reviews requirements then code quality and confirms focused checks.

### 6. Integration and guarded release

After resolving findings, run full required core checks once plus changed browser workflows; use full CI matrix at the exact clean commit. Commit/push under existing authorization after fresh remote comparison. Pause updater, take schema6 baseline backup, verify publication receipts and stage the exact image with all new workflows. Rehearse schema6→7 populated upgrade and compare all preexisting tables; verify credential/import additions and backup restoration, baseline rollback on restored schema6, then candidate restart. Back up any runtime template catalog separately. Promote with a fresh backup, preserve live volume, verify public revision/assets, restore updater, remove owned disposable resources and record exact private receipts. No live data used for destructive tests.

## Evidence and next work

- Design and model audit completed. Critical compatibility finding: legacy proportional AMRAP progression is not equivalent to rich editor fixed add/percent rules. Preserve that evaluator.
- Shared contract implemented: client-safe `parseProgramFile(value,{startDate?})` returns document/source; `exportProgramFile` returns `format: magni.program`, schemaVersion1, program structure plus optional setup. Import server remaps identities once and returns `/programs/editor/{draftId}`.
- POST `/api/program-imports` accepts requestKey/file via cookie or import-only bearer. Cookie-only `/api/program-import-tokens` supports create/list/revoke. Public schema/example routes and full authoring instructions included.
- Frontend implemented three entry actions, shared autosave controller for day builder/advanced editor, templates into the same builder, Import JSON and optional direct-upload credentials. Mode selection survives reload; legacy Original training systems remain behind chooser without engine conversion.
- Backend focused regression86/86 passed. Frontend focused43/43 passed after independent review corrections. Root typecheck passed; root lint found credential effect state issue, fixed and targeted lint passed; full lint still to rerun.
- Independent review corrected unsafe upload retry-key clearing after401/403/429, copied-exercise superset split, missing desktop mixed-set headers, hidden single-week markers, missing export error handling and new-field focus. Explicit existing Ajv6.15.0 devDependency added for standalone schema validation (no transitive version change).
- Root added manual-builder/import browser cases, converted template setup coverage to the shared builder while retaining exact prescriptions/scheduling/retry assertions, and made advanced/legacy regression entry paths explicit. New browser suite is running against disposable local data. Screenshots, full core checks, integration CI and guarded schema7 release remain pending.

### Local verification complete

- Root production build, typecheck, full lint,21 release-policy/backup checks and production-only dependency audit passed (zero production advisories). Full unit/coverage run passed1,132tests/127files with87.38% statements,81.21% branches,94.19% functions,90.69% lines. Later visual changes passed34 focused builder/workspace/operation tests; full CI will recheck the final commit.
- Existing advanced authoring, progression, frozen active-change, copy/export/reload and logging workflows:52 browser cases passed across Chromium/WebKit. Final manual/template/import/retry/credential/legacy-program-management suite:34/34 passed withzero retries. Initial failures were updated navigation/textarea/alert selectors and the newly duplicated review action; no assertions were dropped.
- Designer independently reviewed final WebKit320/375(20px text)/393px, light/dark, decimal entry, mixed sets and review; desktop1280px also reviewed. Corrected duplicate cues, tied mixed-set metadata to its set, shortened progression summary and added a normal-flow footer review action. Final evidence lives in ignored `.playwright/unified-program-builder/design-review-final/`. Physical phones were not tested.
- Backend independent audit and focused checks passed; strict private upgrade helper proves42→44tables with all prior data/catalog/metadata unchanged and rejects13 corrupted fingerprints. Independent release-script review verified staged writer shutdown, old-image schema refusal, both backup restores, strict receipts, fresh live backup and volume/digest guards.
- Fresh fetch remains0/0 againstorigin/main d477d97. Live read-only preflight confirms same healthy revision/image and no runtime template catalog. No updater pause, push or deployment has occurred yet. Next: commit, pause updater/backups, CI publication, exact-image staging/restore rehearsal and guarded promotion.
