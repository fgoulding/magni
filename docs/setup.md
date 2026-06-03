# Setup & local development

Get Magni running on your machine, test it on your iPhone, and seed demo data.
For production self-hosting (Docker + HTTPS), see [deployment.md](deployment.md).

## Prerequisites

- **Node.js 20+** (22 recommended — it's what the Docker image uses).
- **npm** (ships with Node).
- **git**.

No database to install — Magni uses an embedded SQLite file created on first run.

## 1. Clone and install

```bash
git clone git@github.com:fgoulding/magni.git
cd magni
npm install
```

`npm install` compiles the native `better-sqlite3` addon, so the first install
needs a working C/C++ toolchain (preinstalled on macOS with Xcode CLT; on Linux
install `build-essential` + `python3`).

## 2. Configure (optional)

All configuration is via environment variables — copy the template and edit if
you need any of them:

```bash
cp .env.example .env
```

| Variable | Default | What it does |
|---|---|---|
| `DB_PATH` | `./data/workouts.db` | Where the SQLite file lives. The folder is created automatically. |
| `REGISTER_ALLOWLIST` | _unset_ | Comma/space-separated emails allowed to register. **Unset = open registration** (fine for local dev). Set it in production. |
| `DEV_ORIGIN` | _unset_ | Your computer's LAN origin so `next dev` accepts asset requests from your phone — see [§4](#4-test-on-your-iphone). |
| `NODE_ENV` | `development` | In `production`, auth cookies become `Secure` and login/register get rate-limited. Set automatically by the build. |

`.env` is gitignored and never committed.

## 3. Run the dev server

```bash
npm run dev
```

Open <http://localhost:3000>. Register an account (any email works locally),
then build a program from a template and start a workout.

> Editing `.env` or `next.config.ts` requires restarting `npm run dev` — Next
> reads those at startup, not on hot-reload.

## 4. Test on your iPhone

Magni is an iOS-first PWA, so test on a real phone on the same Wi-Fi:

1. Find your computer's LAN IP (macOS: `ipconfig getifaddr en0`), e.g. `192.168.1.20`.
2. Set it as `DEV_ORIGIN` and restart the dev server:
   ```bash
   DEV_ORIGIN=192.168.1.20 npm run dev
   ```
3. On the iPhone (same network), open `http://192.168.1.20:3000` in Safari.
4. **Install it:** Share → *Add to Home Screen*. Launch from the icon to get the
   real standalone PWA (full-screen, safe-area spacing, bottom nav).

> Note: an installed PWA caches its build. After deploying UI changes, **remove
> and re-add** the Home Screen icon to pick them up — a refresh isn't enough.

## 5. Seed demo data (optional)

With the dev server running, load a demo account with ~12 weeks of history so
Stats and Calendar have something to show:

```bash
npm run seed:demo
# then log in with  demo@demo.com  /  demo1234
```

## 6. Run the checks

Before committing:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Coverage thresholds are enforced in `vitest.config.ts` (`npm run test:coverage`).
End-to-end tests (Playwright, WebKit/iPhone): `npm run test:e2e`.

## Next steps

- **Add a training template** (the main extension point): [CONTRIBUTING.md](../CONTRIBUTING.md).
- **Deploy for real** (Docker, HTTPS, your domain): [deployment.md](deployment.md).
