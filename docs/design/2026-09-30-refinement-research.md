# Magni interface refinement — research and implementation brief

The user approved these five refinements on September 30, 2026. This brief applies them to the existing design system; it does not introduce new workout or program behavior. Reviewed `CalendarAgenda`, `WorkoutCard`, `ProgramWorkspace`, `SetPrescriptionEditor`, and the saved iPhone/calendar/Today and desktop editor screenshots.

## 1. Calendar: quieter rows, intact actions

Keep the date range and Week/Month switch in the first header row, Today and arrows in the second. Each workout has one surface and one primary name link. Remove individual borders around the grip, More, and Add controls; retain visible icons, focus indicators, press feedback, and nonoverlapping 44 × 44 CSS px hit areas. Rest days use a shorter plain row, with their Add target still 44 px high. Names may wrap when needed.

This is our application of [Apple's button guidance](https://developer.apple.com/design/human-interface-guidelines/buttons), which recommends generous hit areas, recognizable actions, press feedback, and limited prominent actions. Apple's native measurement is points; Magni's existing web standard is 44 CSS px. [WCAG 2.2 AA target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) itself specifies 24 CSS px, with exceptions; 44 px is the stronger project choice.

Keep More → Move as the tap alternative to dragging. Do not make dragging the only path or nest the action buttons inside the workout link. [WCAG dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) requires a pointer alternative that does not depend on dragging.

## 2. Today: identify the workout first

Use the workout/day name as the primary card title, with program name and week/day beneath in muted sentence case. Retain the actual authored name; do not derive an inconsistent new name from the exercise list. Show today's date once in the page header. Omit redundant weekday pills and original-date text when they repeat the current date; retain meaningful rescheduling information when dates differ.

Start/Resume remains the prominent action. Put Pause and Skip under a visibly labeled More control, using explicit action names such as “Pause program” and “Skip workout.” Preserve existing confirmation/error behavior. Present the lift preview as a simple list inside the main card, without another strong heading or filled nested panel. Do not displace the active exercise/set controls with decorative metadata.

## 3. Program workspace: aligned prescription rows

On desktop, use the sidebar as the sole week/day selector. Retain the compact selectors below the sidebar breakpoint so navigation remains available on narrow or zoomed views.

Replace individual set cards with shared aligned columns: **Set · Reps · Load · Rest · Details**. Keep both minimum and maximum reps editable and clearly labeled. Include load units/basis and seconds for rest. Working load and bodyweight remain meaningful readouts; fixed, percentage, and added loads retain their editable values. Expand each row for role, load basis, effort, tempo, notes, reorder, copy, and remove. Retain a brief visible summary of configured advanced values so important prescriptions do not become invisible.

Use native labeled inputs and a CSS layout or semantic table. A spreadsheet appearance does not require `role="grid"`: the [WAI-ARIA grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) entails managed internal focus and arrow-key behavior. Keep normal Tab navigation for this refinement. A native `details`/`summary` is suitable for advanced fields; a custom disclosure must support Enter/Space and expose expanded state. See the [disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/).

## 4. Emphasis and spacing

Reserve orange for the primary action, selected navigation, and today's context. Use a quiet scheduled marker, a visible check for completed, and a distinct skipped/in-progress shape or label. Include status in accessible names. Color alone, or color plus screen-reader-only text, is insufficient for sighted users who cannot distinguish the colors. See [WCAG use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).

Use the existing semantic tokens, `.display`, 44 px controls, consistent 8/12/16 px gaps, and 16 px card padding. Keep secondary labels in sentence case and `text-muted`; do not reduce their contrast to achieve quietness. Borderless controls still need visible focus and pressed states.

## Verification criteria

- Capture populated iPhone WebKit and desktop views in light/dark themes, including enlarged text and long names. Verify no horizontal overflow or overlapping targets.
- Check Today idle, active, and completed states; More/Pause/Skip; Start/Resume; and fixed bottom navigation clearance. At enlarged text sizes, allow ordinary page scrolling instead of clipping controls to enforce a single-screen layout. [Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) protects access at narrow widths; [focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) protects keyboard focus from sticky UI.
- Exercise calendar Move and drag, completion/skipped states, rest-day Add, Month toggle, and week navigation.
- Edit and reload all five load bases, rep ranges, rest, and advanced set fields; copy/reorder/delete sets; confirm desktop sidebar and phone selectors choose the same data. Preserve autosave, Undo, activation, draft deletion, and immutable started-workout behavior.

Sources checked September 30, 2026. Layout recommendations are project-specific design judgments informed by the linked guidance; the sources do not prescribe Magni's exact layout.
