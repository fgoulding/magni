# Active editor changes implementation plan

> Execute with the test-driven-development and verification-before-completion skills. Root coordinates review and workspace insertion; this delegated task owns scoped editing modules and panel. Do not commit or touch deployment infrastructure.

**Goal:** Apply reviewed prescription/rule changes to one unstarted occurrence, the remaining contiguous block in its cycle, or a reusable published definition, preserving all started and terminal records.

**Architecture:** Retain the original run/version identity and add immutable applied revisions. Each changed occurrence embeds its complete versioned prescription and revision reference. Requests preview exact before/after values plus state effects; a fingerprint guards draft, occurrence and state revisions, and a request key safely replays a committed apply. Published definitions provide a real immutable source for future copies.

**Tech stack:** Next route handlers, SQLite immediate transactions, validated TypeScript documents/evaluator, React client panel, Vitest disposable databases, isolated Playwright browser test.

## Approved API and semantics

- `GET /api/programs/:id/editor-changes`: owned source draft/version, published revision, candidate occurrence identities with original source week/day/block/cycle, statuses and dates.
- `POST` preview/apply: `draftId`, `expectedDraftRevision`, scope `occurrence | remaining_block | definition`, optional `occurrenceId`, progression state `preserve | use_draft`, and `preview`. Apply also supplies `expectedPreviewToken` and client `requestKey`.
- `remaining_block` starts at the selected logical slot and ends with its contiguous named source block in the same cycle. Ignore scheduled-date movement. Started/completed/skipped records are explicitly excluded and preserved.
- Active edits map existing source week/day IDs. Missing/removed source structure is a contextual error; do not silently remap days by array order. Existing days can gain/remove exercises and sets. Dates, logical positions and occurrence IDs stay unchanged.
- Prescription-only overrides preserve shared progression if configuration is unchanged. Rule/config changes that would affect protected/out-of-scope appearances get distinct progression keys seeded from current state (`preserve`) or edited initial values and zero failures (`use_draft`). Preview describes sharing, values and counters.
- Definition publishing writes an immutable reusable snapshot without changing active occurrence content. Copying that published source creates a real new editable draft, distinct from copying unsaved/current draft content.
- `ActiveProgramChanges` props: `{ programId, draftId, saveDraft: () => Promise<number | null> }`. Root inserts the panel and owns ProgramWorkspace changes.

## TDD sequence

1. Add disposable service/route tests for one-occurrence scope, block/cycle boundaries, protected statuses, current-state carry vs explicit reset, shared configuration, preview conflicts, safe retry, source mismatch, ownership and published copying. Observe missing implementation failures.
2. Add immutable revision schema in `src/features/program-editor/migration.ts` and optional applied metadata identifiers in repository types. Coordinate central migration version with the logging agent.
3. Implement `src/features/program-editor/active-changes.ts` and `/api/programs/[id]/editor-changes/route.ts`, using the existing document validation and prescription/evaluator semantics. Resolve added exercises/sets through owned stable database mapping and preserve foreign keys.
4. Run focused service/routes plus existing execution/repository tests. Prove a late old session cannot change newly separated state; saved active/terminal values and all occurrence dates/identities are unchanged.
5. Write panel interaction tests before implementing `src/components/ActiveProgramChanges.tsx`: scope choice, explicit state policy, review before apply, stale preview errors, committed-response retry, and published copy.
6. Add one isolated browser proof after root inserts the panel, including mobile screenshot review. No global build/E2E/deployment changes. Record precise evidence and freeze for root review.
