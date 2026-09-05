# Magni

A self-hosted, iOS-first progressive web app for building strength programs, starting daily workouts, logging set performance, and reviewing training history. Named for Magni, the Norse god of strength.

## Current Scope

- Email and password auth with HTTP-only sessions.
- Direct program workspace with autosaved drafts, blocks/weeks, reusable days, per-set prescriptions, copy, bulk edits and undo.
- Configurable progression with readable rules, outcome previews, shared or independent lift state, and immutable activated versions. Original training systems remain available.
- Weekly calendar with stable workout identity, move/swap, touch drag, duplicate, skip, group shifts and undo.
- Planned and unplanned workouts, retained pending edits, conflict resolution and safe retries.
- Chronological history, corrections, repeat workouts, reusable routines and statistics from performed sets.
- iOS PWA shell with manifest, touch icons, safe area spacing, install guidance, and bottom navigation.

## iOS PWA Notes

The responsive browser workflows are verified with iPhone WebKit, including enlarged text, themes, touch controls and retained pending edits. Unsaved values stay on the device and completion waits for acknowledged saves; a connection is required to save and finish. This is not a fully offline app. Physical installed-PWA suspend/resume and update checks remain a separate release gate.

## Program Workspace

Open **Programs → Custom program** to start blank, customize one of six presets or resume a draft. Structure, Prescriptions, Progression & preview, and Review & activate are separate sections; advanced settings are collapsed. Activation freezes a version for training. Later draft changes do not silently change active or historical prescriptions.

Program files are optional: import/export a versioned JSON file from **Presets and program files**. See [the format and examples](docs/program-files.md). Complete programs can also be authored directly in the UI.

## Tech Stack

- Next.js App Router
- React
- SQLite via `better-sqlite3`
- Argon2id password hashing
- Vitest with route, library, workflow, PWA asset, and component tests
- Tailwind CSS

The app uses Next's `proxy.ts` convention for request gating instead of the deprecated `middleware.ts` naming path.

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

See **[docs/setup.md](docs/setup.md)** for the full setup guide — prerequisites,
environment variables (`DB_PATH`, `REGISTER_ALLOWLIST`, `DEV_ORIGIN`), testing on
your iPhone over the LAN, and seeding demo data.

## Deployment

This repo is public source; deployments run a **private, published image** from
a **separate private deploy repo** — the server never clones this source. See
[docs/deployment.md](docs/deployment.md) for the full model and
[deploy/README.md](deploy/README.md) for the production setup template.

- **Try it from source** (local HTTP, no domain): `docker compose up -d --build` → http://localhost:3000
- **Production** (HTTPS, your domain): copy `deploy/` into a private repo and follow its README.
- Your workout history lives in a Docker volume and **survives every redeploy** (see the persistence guarantees in the deploy docs).

## Open Source Extension Points

Training templates are the first supported extension point. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add, register, test, and verify a new training template.

## Verification

Run the complete release gate before merging or publishing:

```bash
node scripts/release-check.mjs
```

This runs the production dependency audit, typecheck, strict lint, all tests with the existing coverage thresholds, a production build, both browser projects and release-policy/maintenance checks. Each test suite and browser run uses disposable data. See [release verification](deploy/RELEASE.md) for evidence, image identity, backups, staging and rollout gates.

## Product Notes

- Set logging only records performance. It does not adjust training maxes until the workout is completed.
- Completion is idempotent so a retry does not double-apply progression.
- Auto progression requires logged reps for generated sets.
- Editor progression follows the configured rule. The original manual custom progression option retains its existing behavior.
- Corrections update recorded actuals and statistics, preserve prescriptions and show a hypothetical progression comparison; they do not retroactively rewrite progression or completed downstream workouts.
- Program and history APIs are scoped to the authenticated user.

## Demo data

With the dev server running, seed a demo account with ~12 weeks of training
history (so Stats and Calendar have data to look at):

```bash
npm run seed:demo
# then log in with  demo@demo.com  /  demo1234
```

## License

[MIT](LICENSE)
