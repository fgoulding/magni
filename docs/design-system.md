# Design System — Magni

> **Read this before touching any UI.** It is the single source of truth for the
> visual language. Use these tokens and patterns instead of inventing new ones so
> the app stays consistent across sessions and contributors.

Direction: **Light athletic.** Clean light base, one confident accent (energy
orange) plus a training green, bold condensed display type for headings and
numbers. Think gym/performance app — energetic but legible at a glance mid-set.

Implementation lives in:
- `src/app/globals.css` — tokens, fonts, utility classes (`.eyebrow`, `.display`, `.card`, `.safe-top`)
- `src/app/layout.tsx` — font wiring (Barlow / Barlow Condensed), `safe-top`, theme color

---

## 1. Color tokens

Defined as CSS variables in `globals.css` and exposed as Tailwind utilities via
`@theme inline` (e.g. `bg-surface`, `text-muted`, `border-line`, `bg-brand`).
**Always use the semantic token, never raw `zinc-*` / `amber-*` / hex.**

### Surfaces & text
| Token | Hex | Tailwind | Use |
|---|---|---|---|
| `--background` | `#faf9f7` | `bg-background` | App background (warm off-white) |
| `--surface` | `#ffffff` | `bg-surface` | Cards, sheets, inputs |
| `--surface-muted` | `#f5f4f1` | `bg-surface-muted` | Inset panels, nested boxes, day cells |
| `--foreground` | `#1c1917` | `text-foreground` | Primary text; also the neutral "ink" button bg |
| `--muted` | `#57534e` | `text-muted` | Secondary text (passes 4.5:1 on light) |
| `--faint` | `#a8a29e` | `text-faint` | Tertiary text, meta, inactive nav |
| `--line` | `#e7e5e4` | `border-line` | Borders, dividers |

### Brand — energy orange (the accent)
| Token | Hex | Tailwind | Use |
|---|---|---|---|
| `--brand` | `#ea580c` | `bg-brand` | Primary CTAs, active accents, calendar "Due", icon fills |
| `--brand-strong` | `#c2410c` | `text-brand-strong` | **Text/labels on light** (orange-600 fails 4.5:1; this passes), CTA `active:` |
| `--brand-soft` | `#fff3ea` | `bg-brand-soft` | Tinted backgrounds (install banner, current-lift box, today cell) |
| `--brand-line` | `#fcd9bd` | `border-brand-line` | Borders on brand-soft surfaces |

> **Contrast rule:** small orange text on white must use `text-brand-strong`
> (`#c2410c`), not `text-brand`. White-on-`bg-brand` does not meet 4.5:1 for
> normal text; 16px semibold is not qualifying large text. Use a verified ink
> pair such as `bg-foreground text-background` for small text actions.

### Success — training green
| Token | Hex | Tailwind | Use |
|---|---|---|---|
| `--success` | `#16a34a` | `bg-success` / `text-success` | Checkmarks, completed dots, status dot |
| `--success-ink` | `#15803d` | `text-success-ink` | Success text on light (passes 4.5:1) |
| `--success-soft` | `#effaf1` | `bg-success-soft` | "Active" / complete tinted backgrounds |
| `--success-line` | `#c7ecd1` | `border-success-line` | Borders on success-soft |

### Warning — hold amber & Danger
| Token | Hex | Tailwind | Use |
|---|---|---|---|
| `--warn-ink` | `#b45309` | `text-warn-ink` | Paused/held run text |
| `--warn-soft` | `#fffaeb` | `bg-warn-soft` | Hold/compressed-schedule notices |
| `--warn-line` | `#fbe3bd` | `border-warn-line` | Borders on warn-soft |
| `--danger-ink` | `#b91c1c` | `text-danger-ink` | Delete/destructive text + confirm button bg |
| `--danger-soft` | `#fef2f2` | `bg-danger-soft` | Error banners, destructive active states |
| `--danger-line` | `#fbcfcf` | `border-danger-line` | Borders on danger-soft |

> **Hue separation:** orange (brand) and amber (warn) are close. Don't put them
> adjacent as status indicators. The calendar legend uses **gray (`bg-muted`)**
> for "Skipped" specifically to stay distinct from orange "Due".

### Dark mode

A second palette lives under `:root[data-theme="dark"]` in `globals.css` — a warm
near-black base with elevated surfaces lifting toward the light. **You don't theme
components; you use the semantic tokens and they flip automatically.** The resolved
theme is set on `<html>` before paint by `ThemeScript` (reads `localStorage.theme`:
`system`/`light`/`dark`); `ThemeToggle` (Settings → Appearance) writes it and
follows the OS live in System mode.

Two conventions make tokens survive the flip:
- **Ink buttons** (`bg-foreground` / `bg-danger-ink` with light text) must use
  **`text-background`, not `text-white`** — `--foreground`/`--danger-ink` invert
  to *light* in dark, so white text would vanish. `text-background` is ~white in
  light and dark in dark, so it reads in both. `bg-brand` buttons keep `text-white`
  (orange stays dark enough for white in both modes).
- The `*-ink` / `*-strong` text tokens **lighten** in dark (e.g. `--brand-strong`
  → light orange) so small colored text keeps 4.5:1. Soft backgrounds darken to
  matching tints. Never hardcode a hex — add it to both palettes if a token is missing.

---

## 2. Typography

Two Google fonts, wired in `layout.tsx`:
- **Barlow** (`--font-barlow`, body/UI) — weights 300–700. Default `body` font.
- **Barlow Condensed** (`--font-barlow-condensed`, display) — weights 500–700.

Helpers (in `globals.css`):
- `.display` — Barlow Condensed, 700, tight tracking. **All page titles & card
  names.** Pair with a Tailwind size: `className="display text-4xl"` (page H1),
  `text-3xl` (hero card), `text-2xl`/`text-xl`/`text-lg` (sections).
- `.eyebrow` — Barlow Condensed, 600, uppercase, letter-spaced. Small section
  labels above a heading. Color it: `text-brand-strong` (active/important) or
  `text-faint` (neutral). Typical size `text-[11px]`.
- `font-display` utility — apply Condensed to numerals (weights, reps, tonnage,
  dates, stats) for the athletic "scoreboard" feel.

Body copy: Barlow, `text-sm`/`text-base`, `text-muted` for secondary.
Inputs are forced to 16px (prevents iOS zoom-on-focus).

---

## 3. Core utility classes

- `.card` — the standard elevated container: `rounded-2xl`, white surface,
  `border-line`, soft shadow. Use instead of re-deriving border/shadow.
- `.safe-top` — `padding-top: env(safe-area-inset-top)`. Applied to the `<main>`
  in `layout.tsx` so content clears the Dynamic Island / status bar when the app
  runs installed (standalone), where there's no browser chrome. **Don't remove.**
- `.safe-x` / `.safe-bottom` — horizontal & bottom safe-area padding.
- `.touch-target` — min 44×44px. Put on every interactive element.

---

## 4. Component patterns

**Radii:** cards/sheets `rounded-2xl`; buttons/inputs/chips `rounded-xl`; pills/dots `rounded-full`.

**Buttons**
- Primary (key action — Start Workout, Log Set, New, Create, Log in):
  `bg-brand text-white font-semibold active:bg-brand-strong`
- Neutral / terminal (Save, Add, Finish Workout):
  `bg-foreground text-white font-semibold active:opacity-90`
- Secondary / ghost: `border border-line bg-surface text-foreground active:bg-surface-muted`
- Destructive: text `text-danger-ink` ghost → confirm `bg-danger-ink text-white`
- All: `rounded-xl`, `touch-target`, `transition-colors`, `disabled:opacity-50`,
  use `…` (ellipsis char) for loading copy ("Saving…").

**Inputs / selects:** `rounded-xl border border-line bg-surface px-3`,
`outline-none focus:border-brand transition-colors`. Label as a `font-semibold`
`text-sm` stack above. Big numeric entry (reps) uses `font-display text-3xl text-center`.

**Cards:** `.card`. Hero/featured cards get a `h-1 bg-brand` top accent bar.
Card title = `.display`; small uppercase context = `.eyebrow text-brand-strong`.

**Today:** one primary workout logger for today, in normal document flow. Use the
shared collapsible exercise cards below; extra actions open from More. Old sessions stay on their Calendar dates and never take over
Today. The whole workout card must never stick over later content. Use a compact
Today/date header with access to workout history.
Lead the workout card with its authored workout name, then muted program/week
context. Use a plain lift list and one prominent Start/Resume action. Idle Pause
and Skip actions live under More. Show dates only when they add new context.
Use a quiet History link in the Today header. On an empty day, give Quick workout
the primary action and keep choosing a program secondary; avoid repeating History.

Active workout status leads with `N of M sets saved` and a labeled progress bar.
Count physical sets using the same saved/unsaved state as their rows; pending edits
and skipped lifts do not increase saved progress. Omit recorded volume from the
active logger so the first save does not insert a new line. Quick workout uses one
title, a compact Edit action, and omits the repeated date when embedded in Today.
Keep Add exercise directly accessible. Quick workout's trash icon requires a
hold to open a confirmation dialog; only its explicit Delete action deletes.
Keyboard and assistive activation open the same dialog. Focus Cancel initially
and return focus to the trash control when canceled. Planned More retains its
other useful actions.

Completed workout summaries show performed lifts and personal records without a
Progression explanation panel. Finishing still applies the configured rules.

Finish remains available when a lifter leaves sets unperformed. Ordinary unsaved
set inputs open a compact **Finish with saved sets?** dialog; explain that saved
sets are kept, unsaved edits discarded and unlogged sets left unperformed. Focus
**Keep training** initially; cancel/Escape preserve inputs and return focus to
Finish. Keep the confirmation open with a retryable error if completion fails.
Do not save prescriptions as actuals or clear drafts before the server confirms
completion and its saved results. In-flight requests, failed saves, conflicts,
unconfirmed Undo and unfinished Quick structure edits keep their recovery guards.

**Active workout exercises:** Quick Workout, planned Today, Calendar details and
planned resume share the same exercise disclosure and set-row presentation.
Use a full-width header button with the exercise name, saved count and
`aria-expanded`. For ordinary exercises, collapse is manual and does not mean completion; it preserves
entered values. Closed summaries still show pending, saving, failure or conflict
states. Saving the final set leaves its controls visible.

Active supersets present rounds vertically inside that same disclosure: 1a, 1b,
2a, 2b. While open, use a compact Superset A heading and saved count; show the
full exercise names in the closed summary and accessible heading. Each row keeps
its exercise name, concise targets, inputs and individual check.
Place the muted target beside the exercise/set name on the same baseline when
space permits. Wrap naturally for long names, detailed targets or enlarged text;
keep the full name, target role and prescribed load readable.
Keep the round heading attached to its first row without an intervening divider
or extra row padding; retain separators between lifts and rounds.
A compact Round N header is a full-width, 44px disclosure target with a muted
saved fraction and chevron. It only expands/collapses the round; individual set
checks save and undo. All rounds start open. A round automatically collapses once
its final member is successfully saved, after acknowledgement. Reopening stays
open for review and never changes saved work. Do not close on pending or failed
saves, accepting conflicting values, discarding edits, or unrelated updates.
Keep inputs mounted; closed summaries show exercise names plus unsaved, saving,
failed, conflicting or unconfirmed Undo feedback. If focus would be hidden by
automatic collapse, move it to that round's header without scrolling. Preserve
focus elsewhere. Do not auto-scroll. Preserve authored appearance identity, unequal counts
and three-or-more-member groups without inventing rows. Legacy multi-set records
remain explicit batches instead of pretending to be independent physical sets.
The whole superset follows the same acknowledgement rule: close after its final
actual member is successfully saved and no pending or recovery state remains.
Reopening the superset preserves each round's disclosure state and every saved
value; it makes no request and stays open for review. When the final round and
superset close together, focus must land on the visible superset header, unless
the user has moved focus elsewhere. Loaded saved supersets start open. Ordinary
exercise and Quick workout disclosures retain manual behavior.

Set rows have visible Reps and Weight (unit) labels above generously sized numeric
inputs and separate save feedback. Routine Not logged feedback is screen-reader
only; Saved and exceptional states remain visible. Unsaved checks use neutral
outlined styling, with green and visible Saved feedback after acknowledgement.
The same fixed-size check saves and unlogs a
set: green and pressed after acknowledgement, with an accessible Undo action
name. Do not replace the icon with text or change its width. Editing a saved row
shows Save and a secondary Undo icon together. At normal phone sizes, inputs and actions share
one line. Keep the controls mounted across state changes to preserve focus.
Fields and actions
wrap when space is tight or text is enlarged; never squeeze decimal digits behind
native input steppers. Use `text-muted` for meaningful secondary labels and at
least 44px targets. Keep authored targets, roles, bodyweight and superset context
visible in the rows. One Details disclosure per planned superset contains
previous-workout links and authored effort, rest, tempo and notes. Combine
identical guidance only within the same exercise appearance; label differing
guidance with its exact sets. Keep the complete target there, including zero
working loads omitted from the compact row. Do not infer loads from history.
Legacy rows storing multiple sets
remain clearly labeled as a batch. Undo clears actuals only after acknowledgement,
retaining the input values without treating them as unsaved performed work.

Label planned reps/load as Target to distinguish them from the editable actuals.
Keep special roles explicit: Warm-up target, Top-set target, Back-off target and
AMRAP target.

**Calendar:** Week is the default, with workout names and quiet status symbols.
Started workouts appear on their saved training date. Starting from Calendar
follows that date while preserving Week/Month mode and the selected workout.
Keep Move available for scheduled and unfinished workouts in both the weekly
menu and the workout dialog. Moving an unfinished workout changes its training
date while preserving saved sets. Keep completed and skipped dates fixed in Calendar.
Use the shared `CalendarStatus` shapes in Week, Month and the legend: completed
check, scheduled circle, in-progress play and skipped dash. Drag, More and Add
are borderless controls with visible focus/press feedback and 44px hit areas.
Full prescriptions are available when opening a workout. Keep one header with
the week’s month/day date range at left and the Week/Month switch at right.
Put Today and the arrows together on the next row. Week arrows move one week
and cross month boundaries; Month arrows move one month and stay in Month mode.
Today returns to the account's current date while keeping the selected view.
Omit global selection and undo controls from this compact toolbar. Keep Month as a separate grid. Icon controls stay at least 44px without taking
space away from names when text is enlarged. Tight Week rows show at most two
title lines, with the full name available on opening. Days with several workouts
open a complete day list instead of stretching the overview. Month cells use one
whole-cell target: single-workout days open that workout, multiple-workout days
open the day list, and empty dates open their week. Date and status/count fit
inside a roughly 56px cell. Normal Week and six-row Month overviews must fit an
iPhone 16 browser viewport without scrolling; enlarged text and open details
may scroll normally instead of clipping content.

**Program creation:** `/programs/editor` is a dedicated workspace designed for a
desktop screen. At desktop widths, use a wide canvas with a week/day outline
beside the editing panels and omit the phone bottom navigation. Keep Back to
programs at the upper left. Undo must have a visible text label alongside Save;
an arrow alone must not stand in for an editing action. Unfinished drafts expose
Delete draft with a named confirmation, separately from published programs.
Retain a contained phone fallback and the existing compact shell for training.
Use the sidebar as the desktop week/day navigator, with selectors below that
breakpoint. Prescriptions use aligned Set / Reps / Load / Rest rows and native
labelled form controls; Details reveals advanced fields and row actions. Keep
configured effort, tempo and notes visible in a short summary when collapsed.
Use aligned columns from `xl`; stack the rows below it even when the `lg`
sidebar is visible. Numeric fields need room for their digits, padding and native
spinner, including enlarged text, in addition to a 44px outer target.

The simple program builder uses manually collapsible exercise/superset cards.
Cards start open; closed summaries retain names, set/repetition/load targets and
configured effort, tempo and cues. Mixed prescriptions remain associated with
their individual sets. Collapse changes only the view, preserves draft values
and follows the group through reorder and day navigation. Moving an exercise
into a closed group opens that destination and keeps the edited field focused.
Reorder actions sit beside, never inside, the disclosure button.

For identical sets, group Min and Max under Reps. Desktop columns are Sets /
Reps / Weight; phone rows are Sets + Weight followed by the paired Reps fields.
Keep Reuse an exercise beside the add actions. Reuse copies full prescriptions
with independent working weight/progression and linked exercise history. Show
review corrections immediately below the review heading, before the schedule
and workout list.

Progression groups related controls under When, Change, Frequency and Missed
workouts. At `xl`, put the hypothetical sequence beside the rule controls; stack
it below them at smaller widths. Label every simulated workout and keep its
results separate from saved training. Start with one trial and disclose extra
scenarios. Rule presets replace only the rule. Rule copying lists all affected
appearances before Apply and preserves each target's starting values and
independent progression. Exercise reuse creates a complete, independent copy.

**Chips / badges:** `rounded-full px-2.5 py-1 text-xs font-semibold`. Neutral =
`bg-surface-muted text-muted`. Status = soft+ink pair (e.g. Active =
`bg-success-soft text-success-ink` with a `bg-success` dot).

**Bottom nav** (`BottomNav.tsx`): fixed, solid `bg-surface`,
`border-t border-line`. Active tab = `text-brand-strong` + a `bg-brand` top
indicator bar + `aria-current="page"`. Unselected = `text-muted` (these remain
operable controls, so their labels must meet normal text contrast). Labels use
normal case at 11px. The `.app-nav` targets are at least 64px high; its bottom
padding equals the device safe area, without an additional spacer or minimum.
The solid background reaches the viewport bottom. Share `--app-nav-height`
with the content clearance in `layout.tsx`, plus a 1rem gap for the final action.

**Dialogs/sheets:** overlay `bg-black/35`, panel `rounded-2xl bg-surface`,
header with `.eyebrow` + `.display` title and a ghost Close.

**Icons:** Lucide only (`lucide-react`), ~`size={16–20}`, `aria-hidden` when
decorative. Never emoji.

**Charts:** no charting dependency. Reuse the dependency-free primitives in
`src/components/Charts.tsx` — `Sparkline`, `MiniBars`, `SplitBar`, `DotGrid`.
They're pure/server-safe inline SVG+CSS and take their hue from `currentColor`,
so set the color with a `text-*` token class (e.g. `className="text-brand"`).
Progress (`/history`) defaults to **Big three**: Squat, Bench and Deadlift on one
date/value axis, with one metric and original unit. Distinguish the lifts with
names, colors and line/marker styles. Keep latest values dated separately; do not
invent same-day comparisons or a combined max. Each lift opens its individual
view. Preserve explicit exercise links and **One exercise** view selection.
The individual view has a searchable chooser led by Squat, Bench and Deadlift,
followed by search. Keep favorites in their management view. Default to all
history and the first primary lift with recorded history; preserve explicit
exercise/date/metric choices. Show two recent workouts beneath the individual
graph, with full history available on demand. The home screen must
not grow with the exercise library. Search and deliberate browsing replace a
bounded page of results; never append an infinite exercise list.

Chart original recorded units separately, keep workout dates on the horizontal
axis and label estimates as estimates. Missing loads and unsuccessful attempts
must not become estimated maxes. Provide dated values and source workout links.
Normalize exact names and approved whole-name equivalents into an owned durable
exercise identity when measurement families are compatible. Preserve named
variants and explicit historical separations; offer a variation choice for those
histories, never a false empty state. Pinning is only a navigation preference.
Keep date labels spaced when workouts cluster within a long chart range. Use
readable rounded axis ticks while preserving actual load precision in summaries
and evidence. Individual charts show dated latest/previous/best results over the
full selected range even when plotted points are capped. Point selection has
44px previous/next controls and source links; dated tables remain accessible.
One compact selected-exercise training summary shows workouts, recorded sets,
original-unit load volume and active Monday-based weeks. Missing loads are not
zero; active weeks are not adherence. Whole-account activity stays secondary.
Progress queries and identity live in `src/features/progress`; prior-performance
and training summaries also use `src/features/programs/training-stats.ts`.

---

## 5. Motion & accessibility

- Transitions 150–300ms, `transition-colors`/opacity only (no layout-shifting
  scale on press). Touch feedback via `active:` states, not hover.
- `globals.css` already neutralizes animations under `prefers-reduced-motion`.
- Maintain 4.5:1 text contrast — that's why `*-ink`/`*-strong` tokens exist for
  text on light. Icon-only buttons need `aria-label`; inputs need labels.

---

## 6. Verifying UI changes (screenshots)

This is a logged-in iPhone PWA; screenshot real renders rather than guessing.
A dev server runs on `localhost:3000`. Drive it with Playwright (WebKit,
`devices["iPhone 15"]`): register a user via `POST /api/auth/register` (sets the
session cookie on the browser context), then navigate and
`page.screenshot({ fullPage: true })`. The e2e helpers in `tests/e2e/helpers.ts`
show the exact UI flow to seed a scheduled program + session for populated states.
