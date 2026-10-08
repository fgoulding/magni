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

**Active workout exercises:** Quick Workout, planned Today, Calendar details and
planned resume share the same exercise disclosure and set-row presentation.
Use a full-width header button with the exercise name, saved count and
`aria-expanded`. Collapse is manual and does not mean completion; it preserves
entered values. Closed summaries still show pending, saving, failure or conflict
states. Saving the final set leaves its controls and Undo visible.

Set rows have visible Reps and Weight (unit) labels above generously sized numeric
inputs, separate save feedback and an explicit Undo action. Fields and actions
wrap when space is tight or text is enlarged; never squeeze decimal digits behind
native input steppers. Use `text-muted` for meaningful secondary labels and at
least 44px targets. Keep authored targets, roles, effort, rest, tempo, notes,
bodyweight and superset context available. Legacy rows storing multiple sets
remain clearly labeled as a batch. Undo clears actuals only after acknowledgement,
retaining the input values without treating them as unsaved performed work.

**Calendar:** Week is the default, with workout names and quiet status symbols.
Use the shared `CalendarStatus` shapes in Week, Month and the legend: completed
check, scheduled circle, in-progress play and skipped dash. Drag, More and Add
are borderless controls with visible focus/press feedback and 44px hit areas.
Full prescriptions are available when opening a workout. Keep one header with
the week’s month/day date range at left and the Week/Month switch at right.
Put Today and the arrows together on the next row. Week arrows move one week
and cross month boundaries; Month arrows move one month and stay in Month mode.
Today returns to the account's current date while keeping the selected view.
Omit global selection and undo controls from this compact toolbar. Keep Month as a separate grid. Icon controls stay at least 44px without taking
space away from names when text is enlarged.

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
indicator bar + `aria-current="page"`. Inactive = `text-faint`. Labels use
normal case at 11px. The `.app-nav` targets are at least 64px high; its bottom
padding clears the device safe area and raises the controls above the home
indicator. Keep matching content clearance in `layout.tsx`.

**Dialogs/sheets:** overlay `bg-black/35`, panel `rounded-2xl bg-surface`,
header with `.eyebrow` + `.display` title and a ghost Close.

**Icons:** Lucide only (`lucide-react`), ~`size={16–20}`, `aria-hidden` when
decorative. Never emoji.

**Charts:** no charting dependency. Reuse the dependency-free primitives in
`src/components/Charts.tsx` — `Sparkline`, `MiniBars`, `SplitBar`, `DotGrid`.
They're pure/server-safe inline SVG+CSS and take their hue from `currentColor`,
so set the color with a `text-*` token class (e.g. `className="text-brand"`).
Progress (`/history`) starts with one selected exercise chart, a searchable
exercise chooser and at most three favorite shortcuts. Show two recent workout
records beneath it, with full history available on demand. The home screen must
not grow with the exercise library. Search and deliberate browsing replace a
bounded page of results; never append an infinite exercise list.

Chart original recorded units separately, keep workout dates on the horizontal
axis and label estimates as estimates. Missing loads and unsuccessful attempts
must not become estimated maxes. Provide dated values and source workout links.
Matching exercise names alone are not proof that records belong in one graph;
historical linking requires an explicit review. Activity totals are secondary.
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
