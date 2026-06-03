# Magni - iOS-Centric Design

## Overview

A self-hosted, iPhone-first workout app delivered as a Progressive Web App. The app is designed for Safari and Home Screen use on iOS first, with desktop and Android support as secondary targets.

The app manages multi-week workout programs for 2-10 users. Each user has their own programs, workout data, and settings. Users define exercises, set training maxes, assign progression templates, and the app calculates per-week weights/reps/sets. It supports controlled TM auto-progression from AMRAP performance.

PWAs are not dead for this use case. A self-hosted training log is a good PWA fit because it does not need App Store distribution, native sensors, subscriptions, or deep OS integration. The main caveat is that iOS PWAs should be treated as constrained Home Screen web apps, not native replacements.

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js current stable App Router + TypeScript |
| Styling | TailwindCSS current stable |
| Database | SQLite via better-sqlite3 (raw SQL) |
| API | Next.js route handlers (REST-ish) |
| PWA | iOS-focused manifest + Apple metadata + scoped service worker |
| Auth | Email/password + Argon2id preferred, bcrypt fallback, httpOnly session cookie |
| Deployment | Docker (multi-stage Node, bind-mounted DB) |

## Platform Strategy

### Recommended: iOS-First PWA

Use a responsive Next.js app that works in Safari and as an installed Home Screen web app.

This is the best V1 option because it keeps deployment simple, supports self-hosting, and avoids App Store review. It is also enough for the core workflows: view today's workout, log sets, adjust training maxes, review history, and edit programs.

Design around these iOS realities:

- No reliable browser-level install prompt on iOS. Provide an in-app "Install" help screen with Safari Share -> Add to Home Screen instructions.
- Home Screen web apps support service workers and manifests, but behavior differs from Chrome/Android.
- Push notifications exist for installed Home Screen web apps on modern iOS, but they require user permission and should not be a V1 dependency.
- Background sync is not a reliable iOS foundation. Offline writes should be stored locally and retried when the app is opened or regains connectivity.
- Storage can be evicted by the OS. The server database remains the source of truth.
- File uploads, camera, Bluetooth devices, HealthKit, widgets, and rich background behavior are not V1 assumptions.

### Alternative: Capacitor Shell

Wrap the same web app in Capacitor if native affordances become necessary: App Store install, native notifications, background tasks, haptics, HealthKit, or iCloud-style integrations.

Trade-off: more build and signing complexity, but a smoother iOS-native envelope.

### Alternative: React Native / Expo

Build a true native iOS app if the product becomes mobile-native first rather than self-hosted web first.

Trade-off: best native UX and APIs, but it requires a separate app architecture and App Store distribution.

### Not Recommended for V1: App Store Wrapper Only

A thin native wrapper around an otherwise unchanged website adds maintenance overhead without solving the main product problem. Revisit only when a specific iOS limitation blocks a real workflow.

## Data Model

```
User
  id, email (unique), password_hash, created_at

Program (belongs to User)
  id, user_id, name, description, num_weeks, current_week, current_day, created_at

Day (belongs to Program)
  id, program_id, name, day_number, sort_order

Exercise (belongs to Day)
  id, day_id, name, training_max, category (main/aux/accessory), progression_type, auto_progression_enabled, sort_order

WeekSetting (belongs to Exercise)
  id, exercise_id, week_number
  intensity_pct      (0.0–1.0)
  reps, sets
  rep_out_target     (AMRAP goal on last set)
  calculated_weight  (TM × intensity, rounded)

Session (logged workout)
  id, program_id, user_id, day_id, week_number, completed, date

SessionSet (belongs to Session + WeekSetting)
  id, session_id, week_setting_id
  actual_reps, actual_weight, tm_delta_applied, notes

UserSettings (per-user)
  user_id, key, value  (e.g., rounding=2.5)

AuthSession
  id, user_id, token (random), expires_at, created_at
```

## Auth Flow

- Register: POST `/api/auth/register` { email, password } → creates user, sets session cookie
- Login: POST `/api/auth/login` { email, password } → verifies the configured password hash, sets session cookie
- Logout: POST `/api/auth/logout` → deletes the server session and clears the cookie
- Next.js proxy middleware: redirects unauthenticated page requests and returns 401 for unauthenticated API requests
- API handlers call `getUser()` / `requireUser()` to validate the session against the database
- All `/api/*` routes except `/api/auth/*` return 401 if no valid session

## UI Screens

1. **Login / Register** — gate screens, shown when no session
2. **Programs list** (home) — cards showing program name, weeks, last session date; FAB to create new
3. **Program editor** — CRUD for days/exercises; set TM, category, template; delete with confirmation
4. **Today's workout** — daily-use screen; shows current week/day exercises with calculated weights; tap to log AMRAP reps; "Complete & Advance" button
5. **History** — past sessions table across all programs
6. **Settings** — rounding preference, logout button
7. **Install help** — iOS-specific Add to Home Screen guidance shown only in Safari/non-standalone mode

Bottom tab bar: Programs | Today | History | Settings. Single-column on phone.

## iOS UX Requirements

- Use `viewport-fit=cover`, safe-area padding, and a fixed bottom nav that does not collide with the Home indicator.
- Keep primary tap targets at least 44px.
- Avoid hover-only interactions.
- Avoid text inputs that trigger unwanted zoom by using 16px or larger input text.
- Prefer immediate, local UI feedback for workout logging.
- Detect standalone mode with `window.navigator.standalone` and `display-mode: standalone`.
- Show install guidance only when useful; do not block core app use.
- Provide real app icons and Apple touch icons, not placeholder 1x1 images.

## Progression Logic

- TM starts at user-input value
- Each week: working_weight = round(TM × intensity_pct)
- On "Complete & Advance": if actual AMRAP reps > rep_out_target → TM goes up; if < target → TM goes down
- Adjustment magnitude: main ±2.5/rep, aux/accessory ±1.25/rep
- TM changes are applied once per completed session in a transaction
- A completed session cannot apply TM progression twice
- "Custom" progression: user manually sets intensity/reps/sets per week, auto-progression disabled by default

## API Routes

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me              (current user info)

GET    /api/programs
POST   /api/programs
GET    /api/programs/:id
PUT    /api/programs/:id
DELETE /api/programs/:id

POST   /api/programs/:id/days
PUT    /api/days/:dayId
DELETE /api/days/:dayId

POST   /api/days/:dayId/exercises
PUT    /api/exercises/:exerciseId
DELETE /api/exercises/:exerciseId

POST   /api/programs/:id/sessions
GET    /api/programs/:id/sessions
GET    /api/sessions              (global history)

PUT    /api/sessions/:sessionId/sets

POST   /api/programs/:id/complete-and-advance

GET    /api/settings
POST   /api/settings
```

## Error Handling

- Form validation: field-level errors (empty TM, intensity out of range)
- Incomplete program: disable start until ≥1 exercise exists
- Week overflow: wrap back to W1/D1
- Auth errors: 401 with redirect to /login
- All API handlers wrapped in try/catch returning `{ error: string }` + status
- Concurrent writes: upsert pattern on session sets plus transaction boundaries for complete-and-advance

## Docker

Multi-stage current Node LTS Alpine build. SQLite file bind-mounted at `/data/workouts.db`. Schema auto-creates on first import.

## iOS PWA Scope

V1 should support resilient app use, not promise full offline parity.

- Service worker precaches static shell assets only.
- Runtime cache excludes authenticated API responses by default.
- Workout logging can use an in-memory/local pending state while the app is open.
- If a save fails, the user sees a clear retry state.
- Full offline write queue is a V2 feature because iOS background sync is not reliable enough to be the core design.

## Current Research Notes

- Apple/WebKit support Web Push for Home Screen web apps on iOS/iPadOS 16.4+, but it requires installation and explicit permission.
- iOS web apps can be useful, but platform behavior is not identical to Chromium PWAs.
- Next.js current App Router uses modern route handler conventions; keep the implementation plan aligned with the selected Next version.
- TailwindCSS v4 is current, but v3 remains common. Prefer current stable unless a dependency requires v3.
- Argon2id is the preferred password-hashing direction per OWASP; bcrypt is acceptable when Argon2 support is impractical in the target runtime.

Reference links:

- WebKit Web Push for iOS/iPadOS Home Screen web apps: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- MDN PWA install behavior: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
- Next.js PWA guide: https://nextjs.org/docs/app/guides/progressive-web-apps
- Next.js ESLint configuration: https://nextjs.org/docs/app/api-reference/config/eslint
- Tailwind CSS with Next.js: https://tailwindcss.com/docs/guides/nextjs
- OWASP password storage guidance: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- Capacitor iOS native runtime: https://capacitorjs.com/docs/ios
