# Magni

A self-hosted, iOS-first progressive web app for building strength programs, starting daily workouts, logging set performance, and reviewing training history. Named for Magni, the Norse god of strength.

## Current Scope

- Email and password auth with HTTP-only sessions.
- User-scoped programs, days, exercises, and generated week settings.
- SBS-style generated progression plus custom progression without automatic TM changes.
- Daily workout start, set logging, resilient failed-save retry, completion, and week/day advancement.
- History and settings views.
- iOS PWA shell with manifest, touch icons, safe area spacing, install guidance, and bottom navigation.

## iOS PWA Notes

This app is built around what iOS PWAs can reliably do today:

- Safari and home-screen installed PWAs can run the full app, persist auth cookies, and use local responsive UI.
- Push notifications, background sync, durable offline writes, and advanced install prompts remain more limited on iOS than in native apps.
- The app should treat network loss during workout logging carefully. Failed set saves are preserved in the UI and can be retried.
- A future offline mode should queue writes locally and reconcile them with the server before allowing workout completion.

If native-only capabilities become core requirements, the likely next step is a thin native wrapper or React Native/Expo app backed by the same API and database model. For the current workout logging workflow, a PWA is still a practical first build.

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

Run the checks before merging:

```bash
npm run test
npm run test:coverage
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev
```

Coverage thresholds are enforced in `vitest.config.ts`.

## Product Notes

- Set logging only records performance. It does not adjust training maxes until the workout is completed.
- Completion is idempotent so a retry does not double-apply progression.
- Auto progression requires logged reps for generated sets.
- Custom progression exercises do not auto-adjust training maxes.
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
