# Unified exercise cards

Date: 2026-10-08. Approved direction: the user wants Quick Workout-style set rows across workout loggers, with exercises they can collapse when finished and a clear way to undo a saved set. This note specifies that direction; no further design approval is needed.

## Decision and scope

Use one shared exercise disclosure and set-row presentation in Quick Workout, planned Today, and planned workout detail. Keep their existing data adapters, authored prescriptions, workout identity, progression and save/conflict protection. Program authoring remains the desktop workspace; it is not a workout logger.

Three approaches considered:

- **Manual exercise disclosure, recommended:** consistent rows, user-controlled collapse, saved feedback and Undo stay in place.
- Automatic collapse on the last save: shorter immediately, but hides recovery controls and moves the page during a save.
- One-set wizard: compact, but makes comparing or correcting previous sets harder and diverges from the requested Quick Workout layout.

Use manual collapse only. Saving does not move focus, collapse a card or advance to another exercise. Exercises initially open so their rows can be compared; users close lifts as they finish, and a newly added exercise opens. Preserve user choices during edits and saves. Collapse is presentation state, never completion or skipping.

## Shared UI contract

1. Retain one workout heading and its quiet program/week context. List exercise sections below it in normal document flow; remove duplicate exercise selectors/headings when the list already provides navigation. Avoid an additional tinted card around every set.
2. The exercise heading contains a full-width disclosure button: wrapped exercise name, chevron, and a second-line summary such as **2 of 3 sets saved**. Complete exercises use a success check and text. Zero sets is an empty state, not Complete. Do not put Save, Undo, training max or other interactive controls inside this button.
3. The expanded section shows consistent Set / Reps / Weight / Save information. Put visible Reps and Weight (lb/kg) labels above inputs rather than spending row width on trailing unit labels. Keep per-set actual values separate from prescribed targets. Saved rows remain editable.
4. Set status is explicit: Not logged, Unsaved, Saving…, Saved, Save failed. Keep a named Save/Log action; a saved check is feedback, not an unexplained undo toggle. For a saved result expose a visible **Undo** action with an accessible name such as “Undo Bench Press set 2.”
5. Undo marks the existing result unlogged after server acknowledgment. It preserves the entered reps/weight, the set identity and prescription. Store retained values as durable unlogged input values, **not pending save intent**, so a user can leave that set unperformed and still finish a partial workout. Editing them later creates pending changes normally. Undo is also available for older saved rows; it is not a timed toast-only action.
6. Pending saves, failed saves, conflicts and failed Undo must remain visible. If manually collapsed, the heading still reports **Unsaved changes**, **Saving…**, **Save failed**, or **Resolve conflict** as applicable. A failed request must not show a success check. Keep error explanation and retry beside the affected row when open. Announce status politely and errors appropriately without moving keyboard focus.
7. Preserve existing prescriptions: warm-up/work/AMRAP role, rep range, load mode and unit, RPE/RIR, rest, tempo and notes. Keep a concise target line under each planned row; notes can use a disclosure. Bodyweight fields read **Added weight**, not body mass. Training-max controls and less frequent actions can use More, outside the exercise disclosure button.
8. Supersets retain their existing ordering and grouping; identify each constituent exercise beside its rows. Repeated exercise names must not be merged by display text. Use persisted group/set identity for component state.
9. Some legacy records represent a batch (`sets > 1`). Label it honestly, for example **3 sets together**, and name recovery **Undo 3-set log**. Do not invent independently saved row IDs or claim independent set accuracy. Any future expansion into individual records is a separate data change.

## Responsive hierarchy and spacing

- Preserve warm surface tokens, condensed display headings, orange accents and training-green saved feedback. Use `text-muted` for meaningful secondary labels; `text-faint` is unsuitable for these labels. Use existing semantic surface, line, ink, brand and success tokens.
- Use approximately 16px outer section padding, 8px between entry controls and 12px between sets. A rule/divider is sufficient between sets; avoid nested cards. Exercise names and status wrap rather than truncate.
- Give weight entries enough intrinsic width for values such as **62.5**, **225.25**, padding and native number steppers. Prefer flexible grid columns with non-shrinking input minimums. Move the action/status to the next line when necessary; do not squeeze numeric content to keep a single row.
- At narrow widths or enlarged text, retain two generously sized input fields where they fit, then stack if they do not. This is preferable to horizontal scrolling. Match field height to text rather than fixing the entire row height.
- On desktop keep the same component and reading order, allowing wider controls; no separate visual grammar or new side panel. The dedicated desktop program editor is unchanged.
- Inputs retain at least 16px rendered text; all interactive targets use Magni's 44px minimum. Keep page scroll and bottom-navigation clearance; do not add internal workout scrolling or sticky exercise overlays.

### Implemented screenshot review: compact row refinement

Reviewed the first implemented `quick-saved-card-light-16px.png`, `quick-saved-card-dark-20px.png`, and `planned-today-card-light-16px.png` in the worktree's `.playwright/test-results/` exercise-cards result directories. Decimal values are legible, but each set has a full-width Save/Saved footer plus its separate status, making the surface substantially taller than the Quick Workout reference. The shared interaction model is sound; this footer is not a required design element.

Refine the normal-text row as follows:

- Keep the small Set/status header. Immediately below, align **Reps input / Weight input / Save check** in one line, with visible labels over the inputs and the action aligned with their bottom edge. Keep the specific accessible Save name and visible status so the icon is understandable.
- At a typical 311px inner width, use minimum widths of about **80px reps**, **100px weight**, **44px action**, and two **8px gaps**; flexible inputs share the remaining width. Weight minimum should grow with text (approximately 6.25rem), rather than remain 100px while its digits enlarge. Retain enough native-stepper and padding space for 225.25.
- Remove the full-width Save footer. A saved row uses quiet success feedback in the same action position; do not repeat the large disabled “Set saved” button. Keep explicit **Undo** below/right only for logged or unconfirmed-Undo rows, as a quiet text action with a 44px target. Reuse this recovery row for Retry undo and pending-edit actions instead of adding empty space to every unlogged row.
- At enlarged text, move the action below rather than shrinking the fields. A container threshold relative to text size can support three columns around 18rem available width, two input columns plus a following action below that, and single-column fields when approximately 12rem is unavailable. These are implementation starting points; rendered content and minimum sizes determine the final breakpoint.
- Save failures, conflicts and long authored targets may add height; do not clip them to force uniform row heights. Keep prescription content before the entry line. Normal simple rows should lose roughly one 44px action row plus its gap compared with the first implementation; saved rows retain the extra Undo target deliberately.

This refinement preserves every save, Undo, retry and collapse behavior. Re-capture normal and enlarged Mini/13/16-sized Quick/planned screenshots after the layout change; no new browser runtime was launched by the designer.

### Compact implementation review

The coordinator's final `.playwright/exercise-cards/phones-verified.log` reports **9 passed (41.9s)** across iPhone 13 mini, 13 and 16-sized WebKit. Designer inspected these artifacts under `.playwright/exercise-cards/phone-results/`:

- Mini Quick `quick-saved-card-light-16px.png`: Reps, Weight and Save align in one row; **225.25** is fully visible beside native steppers. Saved status and explicit Undo are clear; the oversized Save footer is gone.
- Mini Quick `quick-saved-card-light-32px.png` and full-page `quick-saved-light-32px.png`: the exercise name wraps, controls reflow, and decimal values remain visible. An intermediate render kept input numerals at 16px because of the global input rule. The final scoped rule enlarges input text with the root; browser assertions verify 32px numerals and the one-column fallback. This does not certify whole-app WCAG conformance.
- Mini `quick-collapsed.png`: a compact heading with the saved-set count remains visible while set inputs are hidden.
- 16-sized planned `planned-today-card-dark-20px.png` and `planned-calendar-card-dark-20px.png`: shared row layout remains consistent, with prescribed load/reps/rest and explicit save states visible. Their expected extra prescription content adds height without squeezing the fields.

**Exercise-card design accepted. The surrounding footer finding was resolved:** an intermediate Mini 32px-root render clipped Finish beneath Discard. Both logger footers now wrap with a text-relative preferred button width. The final 9/9 phone checks assert text fits within the buttons, and independent review inspected the corrected full-page screenshot. Fixed-navigation overlays in tall card captures were not treated as new clipping bugs. Numeric entries now use scoped root-relative font sizing and a one-column fallback at enlarged text; final browser checks assert 16/20/32px input text. This verifies the changed controls, not whole-app WCAG compliance.

## Accessibility acceptance criteria and sources

**Web requirements:** text contrast at least 4.5:1, or 3:1 only for qualifying large text; 16px semibold is not qualifying large text. Text must resize to 200% without lost content or functionality. WCAG 2.2 AA target size is 24 CSS pixels with listed exceptions; Magni deliberately uses a stronger 44px product minimum. Sources: [W3C contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [resize text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html), [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

**Implementation guidance:** a semantic heading with a native button, `aria-expanded`, stable `aria-controls`, and hidden collapsed content follows [W3C's accordion pattern](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/). Enter/Space toggle; Tab follows ordinary document order; hidden fields are not focusable. Do not create an excessive number of named landmark regions. This APG pattern is guidance, not an additional WCAG success criterion.

**Platform recommendation:** Apple recommends 44×44-point touch controls, screen-fitting content, sufficient text spacing and controls near the content they affect. The web uses CSS pixels rather than claiming an exact native-point equivalence. [Apple UI design guidance](https://developer.apple.com/design/tips/).

Use a contrast-verified existing token pair for smaller text actions (for example `bg-foreground text-background`). The coordinator corrected the design-system note that had incorrectly treated 16px semibold as qualifying large text.

## Evidence reviewed and verification gates

Reviewed code: `QuickWorkout.tsx`, `WorkoutCard.tsx`, `workout-card-utils.ts`; repository instructions/design system/team; installed Next.js client-component and CSS guides. Source baseline: `1bace30c247ab738dd779983b3de56d7ac528c44`, equal to origin/main in the isolated worktree. The coordinator owns the fresh remote fetch and implementation plan.

Reviewed actual pre-change screenshots:

- Quick Workout iPhone 13 mini dark, 20px root text: decimal weight **62.5** is partly obscured by native steppers despite no overall overflow. iPhone 16-sized light normal-text screenshot fits. Evidence directory: `/private/tmp/magni-audit-20261006-ifiyj9wj/.playwright/quick-phone-review-20261008/results/`.
- Planned Today iPhone screenshot repeats Bench Press in selector and card and emphasizes the legacy batch logger. `/private/tmp/magni-mini-review-20261008/screenshots/active-workout-light.png`.
- Saved desktop authoring screenshot shows a separate wide program workspace; retain it. `.playwright/editor-desktop/final-desktop-viewport.png` in the primary checkout. This is prior evidence, not a new desktop runtime check.

Before completion capture the implemented Quick, planned Today and planned detail states at 375px (13 mini), 390px (13), 393px (16-sized) and a desktop width, light/dark, normal and enlarged text. The previous 20px root test is only a 25% enlargement check; add 200% text/zoom checks for the affected controls. Inspect actual decimal contents, not just bounding boxes. Verify save/reload, independent values, Undo/reload/re-log, partial finish after Undo, manual collapse/reopen, long names, bodyweight, units, rich prescriptions, legacy batches, and failures/conflicts without disappearing drafts. Verify keyboard disclosure and named inputs/actions. Native keyboard and physical-device safe-area behavior still need physical-device evidence; WebKit viewport checks do not certify those.

No application code, schema, deployment, runtime server or production data changed by this design review.
