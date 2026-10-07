# Single-record Progress correction

The user reported that one completed quick workout shows “Keep matching records separate” instead of its result. Current finder queries classify every unlinked exercise by recorded name, regardless of whether the group contains only one exercise identity.

## Scope and decisions

- One underlying exercise identity opens its existing graph directly, including one-point results. Multiple sets are not multiple exercises.
- Resolve uniqueness across recorded history, not only the selected date range or result page. Separate exercise identities sharing a name remain separate until deliberately linked.
- Preserve old recorded-name URLs by resolving an unambiguous group to the underlying exercise. Preserve date/metric/return context; discard an incompatible grouping cursor when converting a detail route.
- Read-only presentation/query correction. No automatic linking, renaming, migration, or edits to saved training data. Aliases and typo suggestions remain a separate proposed improvement.

## Work and evidence

- Coordinator fetched remote before changes: baseline `f881ec1f7bc6b05083711817ece605299bd4f3e7`, zero divergence, clean release checkout. Original workspace's four unrelated untracked plans remain untouched.
- Reuse the prepared writable release checkout `/private/tmp/magni-audit-20261006-ifiyj9wj`, branch `codex/single-record-progress`; retain the attached managed checkout for synchronization. No running application or test process depended on the checkout at start.
- Backend owns `src/features/progress/queries.ts` and its query tests: reproduce first, implement all-history singleton resolution and finder classification, preserve bounded queries and ownership.
- Coordinator owns route integration, route/browser regressions and visual checks.
- Independent verification reviews requirements and code after integration. Only the coordinator handles Git and rollout.

## Acceptance and release gates

- [x] Single quick exercise, including multiple sets, immediately shows recorded result/one chart without grouping prompt.
- [x] Existing recorded-name URL behaves correctly and preserves navigation context.
- [x] Two separately logged same-name exercises still require explicit linking, including when one is outside the selected dates.
- [x] Known reused exercise identity remains one series; other users' records cannot affect resolution.
- [x] Local unit/coverage/build/static checks, six focused browser cases and iPhone viewport screenshots pass; full clean-commit CI remains required before publication.
- [ ] Exact candidate verified in staging before authorized rollout; final evidence saved with the release receipts.

## Implementation verification

- Backend reproduced the actual SQLite classification failure with a three-set quick exercise, then verified all-history identity resolution, repeated identities, ownership, pin exclusions, bounded pagination, and 200/1000-exercise libraries. No mutation occurs during these reads.
- Two route tests failed before integration and passed afterward. Existing recorded-name URLs resolve to the owned identity, retaining metric/period and back navigation; detail redirects drop only an incompatible name-group cursor.
- Independent review found and resolved old-link edge cases after pinning, real reuse (which promotes lineage), and explicit grouping. The fallback runs only when no unpinned unlinked records remain and all matching recorded names reference exactly one existing owned identity. Multiple pinned/confirmed identities remain ambiguous.
- All 872 unit/integration tests in 97 files pass. Coverage: statements 87.03%, branches 80.38%, functions 93.98%, lines 89.88%. Strict lint, typecheck, route generation, production build and dependency audit pass (zero vulnerabilities).
- Chromium and iPhone WebKit regression screens show the recorded 60 lb value, one chart point, and “One recorded workout.” Dark enlarged text has no horizontal overflow. These checks use disposable data, not a physical installed PWA.
- Both application changes and private same-schema release guards passed independent review. The release rehearsal requires exact equality of all schema-5 tables/rows and compatible baseline restart, with the existing prohibition on database restoration after public ingress reopening.
- Final browser, clean-commit CI, staging, backups and live rollout evidence will be recorded in `.playwright/single-record/release/final-result.json`; this file is authoritative for deployment completion. No user action is needed for the authorized rollout.

Final focused browser verification: 6/6 cases passed on Chromium and iPhone WebKit, with zero retries. The old-link pin state uses real API fixture setup; the existing grouping journey separately exercises the pin button. See `.playwright/single-record/local-validation.json` for pre-publication evidence.
