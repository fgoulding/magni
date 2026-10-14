# Simple program setup design

Date: 2026-10-13. Scope approved by the user: simplify creation along the existing “Original training systems” flow, including Full Body Supersets 3-Day, and reduce release overhead for program content. This note owns presentation decisions; the coordinator owns implementation and release. No new approval gate is needed.

## Problem and decision

`CreateProgramForm` presents a source, name, weeks and training maxes in one form. `ProgramWorkspace` asks the user to navigate structure, prescriptions, progression and review/activation, even when a complete default is already available. The workspace is useful for authoring, but is unnecessary work when the task is “start this program.”

Use the simple creation entry as the primary Create destination. Include Full Body Supersets alongside the existing training systems. Choosing a ready program should require only confirming its schedule and selecting **Create program**. Working weights can be supplied during setup when supported, and full editing remains optional. Internally retain the rich program document: the legacy snapshot cannot faithfully represent this program's rep ranges, individual sets and cues.

Alternatives considered: placing another shortcut in the workspace still requires the authoring workflow; downgrading the default to a legacy snapshot loses prescriptions. A simple form backed by the rich document gives the familiar interaction without those compromises.

## Screen and interaction contract

1. **New program** has a plain Back to programs link and one short description. The existing training systems remain discoverable. Ready programs lead; blank/custom authoring is a secondary workspace link. A direct link to this default arrives with it selected. Source selection never creates data or navigates without the user choosing an action.
2. The selected program shows its title and concise summary: **3 days a week · 3 supersets a day** and **A/B: 5 rounds · C: 3 rounds**. Do not call 18 exercise appearances “18 unique lifts.”
3. **Your schedule** contains prefilled program name, start date, duration and selected weekdays. Full Body defaults to the account's current date, 4 weeks and Mon/Wed/Fri. This template's one-week cycle can be presented as weeks; do not expose “cycles” as a second number. Show a concise result, such as “12 workouts · first workout Wed, Oct 14,” calculated from the actual schedule. Day 1 begins on the first selected weekday on or after the start date. Require exactly three weekdays for this three-day weekly setup, with an actionable inline error; no hidden compression or expansion.
4. **Starting weights (optional)** opens three day groups. Each group shows A/B/C pairs and exact sets/rep ranges, with one working-weight input per weighted exercise appearance. Repeated rows and raises can have different weights on different days. Bodyweight pull-ups show “Bodyweight” rather than a weight or training-max input. Labels include units; number fields support decimal input. Do not infer working weights from training maxes. Do not silently copy a changed weight to other days. Preserve full exercise names by wrapping.
5. Blank weights may mean “Choose when logging” only when that meaning is carried honestly through the existing prescription/logger contract. Never inherit the legacy fallback max of 100, present zero as a recommended load, or promise that logging changes future targets automatically. If that meaning cannot be supported in this implementation, require working weights with inline errors rather than making an inaccurate promise. In either case, retain all entered values on errors. An intentionally entered zero remains distinct from a blank field in the form.
6. **Create program** is the single primary action; adjacent text explains that it adds the program's workouts to the calendar. The existing APIs save the draft, then atomically activate it and schedule workouts. Stable draft/document identity and reconciliation make that two-request flow safe to retry. Successful submission opens the created program with its schedule and clear access to training. A second click or retry must not create a second run.
7. **Customize in workspace** is a quiet secondary action for changing exercises, sets or progression. It must preserve setup edits when transferring them, or live after creation and open the saved source document. It must not silently throw away entered weights. No mandatory questionnaire, draft-management step, second activation step, or nested confirmation for ordinary creation.

## Exact content to preserve

| Day | A — 5 rounds | B — 5 rounds | C — 3 rounds |
| --- | --- | --- | --- |
| Squat | Barbell back squat 4–6 + one-arm DB row 8–12/side | DB Romanian deadlift 8–12 + barbell Spoto press 6–8 | Pull-up 5–10 + DB lateral raise 12–20 |
| Bench | Barbell bench press 4–6 + B-stance DB RDL 8–10/side | KB Bulgarian split squat 8–10/leg + standing DB overhead press 8–12 | One-arm DB row 10–12/side + DB lateral raise 12–20 |
| Deadlift | Barbell deadlift 3–5 + incline DB bench press 8–12 | KB goblet squat 10–15 + pull-up 5–10 | One-arm DB row 10–15/side + single-leg DB calf raise 12–20/side |

Each day remains 26 physical working sets; pairs contain at most one barbell exercise. Preserve unilateral cues, Spoto hover, bodyweight, effort, rest, independent load progression and shared same-name exercise history. Name/schedule/load customization must not rewrite sets or progression. Template updates must not change programs already created from an earlier version.

## Hierarchy, layout and states

- Use `.display` headings, `.card`, semantic surfaces/text/borders and a restrained orange selection accent. Prefer a verified ink primary button (`bg-foreground text-background`) for normal-sized button text; do not introduce arbitrary colors. Selected source/weekday states include checked/pressed semantics, not color alone.
- Use one visibly labelled native **Choose a program** select for the ready-program flow. Eight stacked source buttons hide the schedule below an unnecessary screen of choices on phones. Keep the selected program's complete title and summary immediately below the select, including when a narrow native control cannot display the whole title. The existing legacy-only snapshot chooser can retain its button layout.
- At desktop widths, keep a readable form width (roughly 44–48rem), with name full width and date/duration/unit fields grouped only when labels and values fit. A secondary preview may sit beside the form; no authoring sidebar is needed. Use 16px section padding and 12–16px field gaps rather than placing every item in a separate card.
- At 375px and 393px, use one column, labels above controls, wrapping titles, and normal document scrolling. Do not compress this setup into a no-scroll phone screen. Numeric controls retain room for decimal values. At least 44×44px interactive targets, including weekday controls and disclosure summaries. Seven 44px controls plus gaps do not fit inside a padded 375px card; wrap deliberately (e.g. four then three) rather than shrinking or horizontally scrolling them.
- Keep the action in normal flow with the shared bottom-nav clearance. No sticky action overlapping a field or a second fixed footer. Keyboard focus and the last action remain visible above the nav. Enlarged text may increase height naturally.
- Loading: retain the form and its values, change the action to **Creating…**, disable duplicate submissions, announce status. Do not blank the content. Failure: concise error summary plus linked/associated field errors; open any disclosure containing the first invalid field. Focus the first invalid control or an actionable summary. Network errors retain edits and offer retry.
- No template available: a clear empty state with the workspace link. Template removed or invalid before submission: explain that it is unavailable, retain user input, offer selection of another program; do not silently substitute an unrelated template.

## Research and acceptance criteria

These design choices apply published guidance to this product; Apple HIG and WAI tutorials are recommendations, not additional product requirements. WCAG success criteria below are accessibility requirements when targeting WCAG 2.2 AA.

- Apple recommends reasonable defaults, avoiding unnecessary entry, and choosing from options when practical. This supports a prepared template, account date/units, weekday choices and optional deeper customization. [Apple HIG: Entering data](https://developer.apple.com/design/human-interface-guidelines/entering-data).
- WAI recommends short forms that ask only for needed information, labelled controls and related field groups. Use real labels/fieldsets, with day and exercise context in each weight's accessible name; placeholders are supplementary. [WAI Forms](https://www.w3.org/WAI/tutorials/forms/), [WAI Labels](https://www.w3.org/WAI/tutorials/forms/labels/).
- Errors identify the field and how to fix it, and successful creation is announced. [WAI Notifications](https://www.w3.org/WAI/tutorials/forms/notifications/).
- Reflow must work at 320 CSS px without two-direction scrolling. Magni's 44px touch-target convention is deliberately larger than WCAG 2.2 AA's 24px minimum with its exceptions. [WCAG 1.4.10 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [WCAG 2.5.8 Target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

Acceptance: create the full-body default from the simple path without visiting the workspace; verify exact schedule and 26-set prescriptions; keyboard-complete the form and invalid-input recovery; verify retry creates one program; inspect desktop and iPhone 13 mini/16-size WebKit renders, including 20px text, expanded day groups, decimal values and the final action. Check 320px reflow separately. Physical-device behavior remains unverified unless tested on actual hardware.

## Evidence and limits

Inspected `CreateProgramForm.tsx`, `ProgramWorkspace.tsx`, `/programs/new`, `/programs`, the existing default entry and the full-body factory. Read the repository/team/design instructions and the prior default-program task plan. Source research retrieved 2026-10-13. No application code, shared runtime or Git changes made by this designer.

First-pass visual review inspected coordinator-supplied real renders in `.playwright/simple-program-setup/first-pass-visuals/`: 375px with enlarged text/dark theme, 393px light, 320px dark and 1280px desktop. The source chooser's excessive vertical space prompted the select decision above.

Final visual review inspected all five actual WebKit renders in `.playwright/simple-program-setup/final-visuals/simple-program-setup-simpl-f030e-ged-phone-and-desktop-sizes-mobile-safari/`: `simple-program-320.png`, `simple-program-375.png` (20px text/dark), `simple-program-393.png` (light), `simple-program-1280.png`, and `simple-program-weights-375.png`. The labelled native select resolves the excessive source-list height; the complete selected title remains visible. Schedule fields, deliberate four-plus-three phone weekday layout, desktop field grouping and normal-flow primary action are readable without visible horizontal clipping. Expanded supersets preserve exercise names, rep ranges, unit labels and technique notes. The focused `42.5` weight remains fully visible with room for the native stepper. Final actions have clear space above the bottom navigation. No material visual blocker remains in these reviewed states.

The coordinator reports 32/32 changed and legacy browser cases passing across Chromium and WebKit without retries; this designer independently inspected the images rather than rerunning that suite. Screenshots alone do not establish complete keyboard behavior or assistive-technology conformance. These are browser-emulated viewports, not physical iPhone tests; the wide WebKit render retains the test project's iPhone user agent and consequently shows the install-on-iPhone banner.
