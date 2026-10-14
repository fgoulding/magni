# Active workout spacing review and implementation

**Goal:** Improve superset readability on iPhone without shrinking controls or
changing workout logging behavior.

**Architecture:** Presentation-only changes to WorkoutCard. Keep shared set
controls, save/undo state, authored targets and progression intact. No backend,
API or database changes.

**Baseline:** Fetched `origin/main` equals
`845166ee28a2b5c8f6f67926427b4dd7f7857506`. Reuse the clean checkout on
`codex/active-workout-spacing`; preserve unrelated primary-checkout plans.

## Design decision

The current screen is sound at 375px, 393px and enlarged text. Keep its input
labels, manual collapse, repeated exercise names, saved feedback and training
cues. Shrinking controls would reduce usability; hiding cues would add interaction
and remove useful context mid-set.

Two small refinements are justified:

1. Replace generic Work with Target before prescribed reps/load. Special set roles
   remain explicit: Warm-up target, Top-set target, Back-off target, AMRAP target.
   This distinguishes the prescription from changed actual inputs without adding
   a line.
2. Attach the round heading to its first lift: remove that redundant divider and
   top padding by giving the round's rows their own container. Retain separators
   between lifts and rounds, existing margins and 44px actions.

Independent designer agrees. [WAI grouping guidance](https://www.w3.org/WAI/tutorials/forms/grouping/)
supports clear grouping; this spacing choice is a recommendation, not a compliance
requirement. Enlarged-text wrapping remains intentional, following
[WCAG reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

## Ownership and verification

- Root coordinates implementation, runtime, screenshots, Git and release.
- Designer reviews rendered layouts read-only; independent verifier reviews diff.
- Update existing text expectations; no new tests for cosmetic spacing.
- Inspect current and proposed full-body supersets at mini/16 widths and enlarged
  text. Run existing set logging, superset round, recovery and layout checks.
- Require normal CI gates and production-image staging before guarded promotion.

## Evidence

- Reviewed current release screenshots and code; primary controls remain legible
  and at least 44px. No material clipping issue found.
- Fresh full-body WebKit comparison measured 13px less height per round at normal
  text and 16px at enlarged text, with no horizontal overflow. The first round's
  height changed from 470.94px to 457.94px at both normal phone widths.
- Implemented only the target-caption mapping and row container. Existing 48
  component tests, typecheck and lint passed; independent code review passed.
- Eight existing Chromium/WebKit workflows passed without retries, covering
  grouped/individual save and undo, reload, lost responses, conflicts, Today and
  Quick workout layouts. Inspected fresh 375px light, 393px dark and 375px enlarged
  text screenshots: targets/readable decimals and controls remain intact.
- Publication/staging/promotion remain pending until private receipts pass at
  `.playwright/active-workout-audit/release/`. Physical-device verification is
  separate from browser emulation.
