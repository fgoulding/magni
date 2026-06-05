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
> (`#c2410c`), not `text-brand`. White-on-`bg-brand` is reserved for large/bold
> button labels (≥16px semibold).

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

**Chips / badges:** `rounded-full px-2.5 py-1 text-xs font-semibold`. Neutral =
`bg-surface-muted text-muted`. Status = soft+ink pair (e.g. Active =
`bg-success-soft text-success-ink` with a `bg-success` dot).

**Bottom nav** (`BottomNav.tsx`): fixed, `bg-surface/90 backdrop-blur-lg`,
`border-t border-line`. Active tab = `text-brand-strong` + a `bg-brand` top
indicator bar + `aria-current="page"`. Inactive = `text-faint`. Labels are
condensed uppercase.

**Dialogs/sheets:** overlay `bg-black/35`, panel `rounded-2xl bg-surface`,
header with `.eyebrow` + `.display` title and a ghost Close.

**Icons:** Lucide only (`lucide-react`), ~`size={16–20}`, `aria-hidden` when
decorative. Never emoji.

**Charts:** no charting dependency. Reuse the dependency-free primitives in
`src/components/Charts.tsx` — `Sparkline`, `MiniBars`, `SplitBar`, `DotGrid`.
They're pure/server-safe inline SVG+CSS and take their hue from `currentColor`,
so set the color with a `text-*` token class (e.g. `className="text-brand"`).
Stat aggregation lives in `src/features/programs/training-stats.ts` (pure,
unit-tested helpers + a DB entry point). The Stats page (`/history`,
`app/history/page.tsx`) composes these into cards.

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
