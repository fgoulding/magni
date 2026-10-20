# Auto-collapse completed superset rounds

**Goal:** Collapse a round after its final set is confirmed saved, while preserving
independent header reopening and individual save/undo controls.

**Design:** The existing full-width Round N header remains the disclosure control.
A newly completed round closes after acknowledgement, never on optimistic click,
pending work, failure or conflict. Reopening completed work stays open until a new
completion transition; unrelated renders must not close it again. Keep inputs
mounted and saved values unchanged. If focus is inside the content being hidden,
move focus to its round header without scrolling or taking focus from another
round. Preserve manual collapse and recovery summaries. Apply to every actual
member, including three-member and unequal rounds. No API/database change.

The user explicitly requested this change to the previous manual-only behavior.
No extra design approval is needed. Baseline is the previous verified release
`7300e40`; fetch and compare remote before editing.

## Ownership and sequence

1. Frontend owns SupersetRoundCard.tsx, WorkoutCard.tsx if a minimal prop is needed,
   WorkoutCard.supersets.test.tsx and related component tests. First demonstrate
   the missing auto-collapse regression; implement and verify completion, reopen,
   pending/failure/conflict, focus and retained-value behavior.
2. Coordinator owns active-superset-rounds.spec.ts and related affected browser
   assertions, design-system guidance, this plan, runtime and release. Inspect
   iPhone mini/16 viewport screenshots and run focused browser workflows.
3. Independent verifier reviews source and evidence. Resolve findings before
   integration. Keep normal CI and immutable-image staging/release gates.

## Acceptance

- Final successfully saved member collapses the round; a partial round stays open.
- Header reopening makes no requests and does not undo or alter recorded sets.
- Reopened completed rounds stay open through unrelated updates.
- Pending edits, failed saves and conflicts do not count as completion.
- Focus is not stranded inside hidden content or stolen from another control.
- Hidden fields stay mounted and retain their values; target/layout stays compact.
- Local checks, CI, staging and public readiness pass before claiming live release.

Private artifacts and exact release receipts belong under
`.playwright/auto-collapse-rounds/`; physical-device checks are separate.

## Implementation and review

- Fetched remote before editing; baseline matched `origin/main` with no divergence.
- Successful local saves publish a per-set acknowledgement version after draft
  and saving-state cleanup. Each round consumes that version once; reopening,
  discarding drafts and accepting server values cannot replay the close action.
- Inputs remain mounted. The header only changes disclosure state. Focus displaced
  when a saving control becomes disabled is restored to the closed header with
  `preventScroll`; focus deliberately moved elsewhere is preserved.
- Independent source review found no data/recovery blocker. Actual Chrome and
  WebKit checks caught the initial disabled-button focus loss; a regression
  reproduced it before the focus correction. Browser verification is required
  before release. No backend, database or schema change is involved.
- Final local validation passed: 1,197 unit tests across 130 files with required
  coverage, lint, typecheck and production build. The final Chrome/WebKit save,
  reopen, retained-value and keyboard-focus workflows passed. Earlier affected
  preset and lost-response browser checks also passed; CI and staging recheck the
  complete candidate before promotion.
- Inspected final Safari renders at 375px and 393px, including collapsed rounds,
  dark theme and enlarged text. Disclosure targets and saved values remain
  readable without horizontal overflow. These are browser viewport checks,
  not physical iPhone testing.
- Release evidence is recorded privately under the directory above. CI,
  immutable-image staging, promotion and public readiness must all pass; restore
  the updater after the guarded rollout.
