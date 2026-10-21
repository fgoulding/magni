# Deployment & operations

How this open-source app is built in public and deployed privately, with HTTPS
and **a database that survives every redeploy**.

## Architecture: the image registry is the seam

You don't deploy *source* — you deploy a *built image*. That cleanly separates
the open code from your running instance.

```
 PUBLIC app repo (this one)            PRIVATE deploy repo (your server)
 ─────────────────────────            ────────────────────────────────
 source, Dockerfile, CI               docker-compose.yml + .env
        │                                        ▲
        │ push main → CI builds :latest          │ Watchtower auto-pulls + redeploys
        ▼                                        │
   ghcr.io/OWNER/REPO  ──────────────────────────┘   (private image)
                                                 │
                cloudflared (outbound tunnel) ──► app ──► /data/workouts.db (volume)
```

- **Public repo** = source + `Dockerfile` + CI that publishes a private image to
  GHCR. No domain, no secrets, no deploy state. Also ships a from-source
  `docker-compose.yml` so anyone can try it locally.
- **Private deploy repo** = the `deploy/` folder, copied out. Holds your tunnel
  token and allowlist; runs the published image. Your server never clones the
  public source. Full setup: [`deploy/README.md`](../deploy/README.md).
- **Edge** = a **Cloudflare Tunnel** (`cloudflared`) makes an *outbound* connection
  and Cloudflare terminates TLS — so no inbound ports are opened on the host.

---

## 1. Your data is safe across redeploys (read this first)

- The SQLite database lives in a **Docker named volume (`app_data`)** mounted at
  `/data`. It is **not** part of the image.
- Redeploying replaces the *image/container*, then remounts the **same volume**.
  Accounts, programs, and history are untouched.
- Migrations run **automatically and idempotently** on every container start
  (`initDb()` → `runMigrations()`), so a new build self-updates the schema
  without dropping rows.

| Action | Loses data? |
|---|---|
| `docker compose pull && up -d` (redeploy) | ❌ No |
| `docker compose down` / `restart` / reboot | ❌ No — volume persists |
| `docker compose down -v` | ⚠️ **YES** (the `-v` deletes volumes) |
| `docker volume rm <project>_app_data` | ⚠️ **YES** |
| Destroying the host without a backup | ⚠️ **YES** |

Never run `down -v` in production, and keep backups (§5).

---

## 2. Public repo, private secrets

Nothing secret is in the public repo:

- **`.env` is gitignored** and excluded from the image (`.dockerignore`).
- **`.env.example`** files are committed as templates only.
- The **database is gitignored** (`/data/`) and excluded from the image — user
  data never reaches the repo or a published image.
- The **published image is private** (GHCR); the server pulls it with a PAT.
- There are **no app signing secrets**: sessions are random server-side tokens,
  passwords are argon2id hashes. The only sensitive artifact is the DB file.

---

## 3. First deployment

See [`deploy/README.md`](../deploy/README.md) for the full walkthrough. In short:

1. Copy `deploy/` into a **private** repo (e.g. `magni-deploy`).
2. On the server: `cp .env.example .env`, set `IMAGE`, `TUNNEL_TOKEN`, `REGISTER_ALLOWLIST`.
3. `docker login ghcr.io` with a `read:packages` PAT (only if the image is private).
4. Create the Cloudflare Tunnel + public hostname → `http://app:3000` (no router
   ports needed), then `docker compose pull && docker compose up -d`.
5. Register your account at `https://YOUR_HOST/register` (allowlisted emails only).

---

## 4. Making changes & redeploying

### Local browser iteration and release evidence

The normal Playwright and release commands compile every discovered application
route before tests begin. CI retains the complete test discovery, both browser
engines, and the strict no-flaky-pass release gate. All Node script regressions,
including the template publishing CLI, run in the fixed `gate-policy` check.

For a focused local check, explicitly list the routes used by the workflow. Paths
are relative to `src/app`; dynamic paths use their source names. For example:

```bash
node scripts/release-check.focused.mjs \
  --route=today/page.tsx \
  --route=api/sessions/route.ts \
  -- tests/e2e/workout-save-toggle.spec.ts --project=mobile-safari
```

This uses the same disposable database/server and unchanged browser assertions.
Unlisted routes still compile on first use. Diagnostics go to a unique
`.playwright/local-focused-*` directory, and the warmup timing identifies the
profile. Focused mode is rejected in CI and by release entry points. Its browser
metadata cannot be accepted by release evidence aggregation; a local focused pass
never replaces the full release gates. Coordinate the local browser server with
other work before running it.

Authentication helpers wait for the existing hydrated form controls and submit
once. API fixture transport failures report only method, route, an allowlisted
error category and elapsed time; they fail immediately without a hidden retry.
Original browser traces remain separate diagnostics and may contain disposable
test account data.

### Tracked, guarded release tools

`scripts/deployment/` contains the reusable coordinator previously kept in private
per-release folders. Its Python modules and browser adapter do no work when
imported. All host operations require an explicit private configuration and an
explicit command. The offline guard tests run in `gate-policy` through
`scripts/release-check.deployment.test.mjs` and
`scripts/release-check.deployment-wrappers.test.mjs`.

This coordinator supports **same-schema releases only**: startup, restart, backup,
restore onto the old image, and return to the candidate must preserve every table,
row fingerprint, schema entry, exercise identity mapping and deletion marker.
Changing the schema requires a separately reviewed migration preservation and
old-image refusal policy; changing the configured number does not provide one.

Keep the configuration, database backups, receipts, logs and screenshots private.
An output directory inside the checkout must be below `.playwright/`; an absolute
directory outside the checkout is also accepted. The tools create private output
with mode `0700` and atomic receipts with mode `0600`. Do not commit these files.

Create a configuration using the real baseline identities and committed candidate
SHA. This is a sanitized example; replace the example paths, identities and spec
selection with the release's reviewed values:

```json
{
  "schemaVersion": 1,
  "repositoryRoot": "/path/to/magni",
  "outputDirectory": "/path/to/magni/.playwright/my-release",
  "sshHost": "operator@example.test",
  "deployDirectory": "/srv/magni",
  "appContainer": "magni-app-1",
  "updaterContainer": "magni-watchtower-1",
  "composeService": "app",
  "imageRepository": "ghcr.io/example/magni",
  "baselineRevision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "baselineImage": "ghcr.io/example/magni@sha256:1111111111111111111111111111111111111111111111111111111111111111",
  "baselineImageId": "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  "candidateRevision": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "githubRepository": "example/magni",
  "githubRunId": null,
  "schemaRevision": 7,
  "expectedTableCount": 44,
  "resourcePrefix": "magni-my-release",
  "localPort": 4123,
  "remotePort": 4123,
  "browserFiles": ["workout-save-toggle.spec.ts"],
  "browserHelpers": ["helpers.ts"]
}
```

`browserFiles` and `browserHelpers` are exact basenames from `tests/e2e`. Include
the workflow dependencies in the helper list. Both Chromium and iPhone WebKit run
every selected workflow with zero retries. Source bytes must match the candidate
commit before and after execution. The production rehearsal creates temporary
accounts only in its labelled disposable database; it retains normal application
authentication and ownership checks. Registration itself remains covered by the
full development-server CI suite. This is simulated iPhone WebKit evidence,
not a physical-device check.

The commit is known before pushing; GitHub's run ID is not. Leave `githubRunId`
as `null` for the initial updater pause, then pin it to the actual run ID as a
string. This is the only field excluded from `configHash`. Publication, staging
and promotion require a pinned run and verify its exact attempt and candidate.
Changing any deployment identity, schema, source, resource prefix or browser
selection requires a new output directory. An output ownership marker and each
receipt's hash prevent mixing configurations.

Run from the configured checkout with Node 22, Python 3, GitHub CLI, Docker CLI
and non-interactive SSH access available:

```bash
MAGNI_RELEASE_CONFIG=/private/path/release.json
python3 scripts/deployment/config.py --config "$MAGNI_RELEASE_CONFIG"

# After committing the candidate, before pushing a branch that publishes latest:
python3 scripts/deployment/release.py --config "$MAGNI_RELEASE_CONFIG" pause

# Push through the normal workflow, wait for CI, and set githubRunId in the file.
python3 scripts/deployment/publication.py --config "$MAGNI_RELEASE_CONFIG"
python3 scripts/deployment/stage.py --config "$MAGNI_RELEASE_CONFIG"

# After reviewing the CI, preservation and browser receipts/screenshots:
python3 scripts/deployment/release.py --config "$MAGNI_RELEASE_CONFIG" promote \
  --candidate ghcr.io/example/magni@sha256:REPLACE_WITH_VERIFIED_DIGEST \
  --browser-result /private/path/to/output/browser-RUN/result.json
```

`publication.py` requires the CI run to have finished successfully; it does not
wait or silently retry failed checks. `stage.py` pulls that immutable image and
runs populated preservation followed by disposable production browser workflows.
Each phase records its outcome. To repeat only a reviewed staging phase, use
`release.py ... rehearse --candidate IMAGE` or
`node scripts/deployment/browser-staging.mjs --config CONFIG --candidate IMAGE`.
Retain failed attempt folders and inspect their errors; a failed attempt does not
become passing evidence through a retry threshold.

Promotion checks the same clean commit, exact image ID/digest, eight CI gates,
complete CI discovery, configured staging cases, schema and successful cleanup.
It takes a fresh verified online backup, validates the existing data mount and
Compose target, verifies `latest` still resolves to the staged image, then replaces
only the app service. It verifies application health and a second backup before
restoring the same updater container. It never restores the live database.
If a check fails after the pause, the updater remains paused and the receipt
identifies the failed phase; inspect it before any recovery action. Staging
cleanup only removes resources bearing that run's ownership label, and restores
its database only after stopping its writer and checking for other writers.

```
edit code → PR → merge to main (public repo)
        → CI builds + pushes ghcr.io/OWNER/REPO:latest
        → Watchtower on the server auto-pulls it and redeploys (~minutes)
```

Tag `vX.Y.Z` as well when you want a pinned, rollback-able release. The
`app_data` volume carries history forward; migrations apply on boot. Roll back
by pinning `IMAGE` to an older tag (and pausing Watchtower) — migrations are
forward-only, so restore a DB backup if one changed the schema.

**Try changes from source locally** (no registry, no tunnel) with the root
compose: `docker compose up -d --build` → http://localhost:3000.

---

## 5. Protecting your data (corruption & loss)

The whole app is one SQLite file in the `app_data` volume. Defense in layers:

**On the engine — automatic, nothing to run:**
- **WAL journal mode** — a crash or `kill` mid-write can't corrupt the file; SQLite
  replays/discards the write-ahead log on next open.
- **`synchronous = FULL`** — a committed write is fsync'd, so it survives an OS crash
  or power loss, not just an app crash (worth the tiny cost at this write volume).
- **`busy_timeout`** — writers wait briefly instead of erroring under contention.
- **Boot integrity check** — `PRAGMA quick_check` runs on every start; a failure logs
  loudly (`[db] INTEGRITY CHECK FAILED …`) so you catch corruption *before* it spreads
  into backups. Watch it: `docker compose logs app | grep -i integrity` (no output = healthy).

**Backups — you must set these up (`deploy/backup.sh`, `deploy/restore.sh`):**
- `sh backup.sh` takes a **consistent online snapshot** (SQLite `.backup()`, not a raw
  `cp` that can copy a torn page), **verifies it with `quick_check` before keeping it**,
  gzips it, and **rotates** snapshots older than `KEEP_DAYS` (default 30).
- **Cron it daily AND copy snapshots off the box** — a backup on the same disk doesn't
  survive a disk failure:
  ```cron
  0 3 * * * cd /path/to/magni-deploy && sh backup.sh >> backups/backup.log 2>&1
  0 4 * * * rsync -a /path/to/magni-deploy/backups/ user@another-host:/backups/magni/
  ```
- **Restore:** `sh restore.sh backups/workouts-YYYYMMDD-HHMMSS.db.gz` — stops the app,
  swaps the file, drops the stale WAL/SHM (so SQLite can't replay an old log onto the
  restored DB), restarts. **Test a restore once** so you trust your backups.

**Don't:**
- ❌ `docker compose down -v` — deletes the volume (the one destructive command).
- ❌ Put the volume on a **network filesystem** (NFS/SMB) — SQLite locking is unsafe
  there and corrupts eventually. Keep it on a **local disk (ext4)**.
- ❌ Run **two app containers** against the same DB file — one writer only.
- ❌ `cp`/`tar` the live `.db` as a backup — use `backup.sh`.

**Watch the disk:** a full disk fails writes. Schedule `df -h` on the volume's disk and
alert before it fills.

---

## 6. Security model

| Control | Where |
|---|---|
| HTTPS / TLS termination at the edge (no inbound ports) | Cloudflare Tunnel (`cloudflared`) |
| HSTS + security headers (CSP, `X-Frame-Options: DENY`, `nosniff`, referrer, permissions) | `next.config.ts` |
| Registration allowlist — you control who signs up | `REGISTER_ALLOWLIST` |
| Brute-force rate limiting on `/login` + `/register` (prod only) | `src/lib/rate-limit.ts` |
| argon2id hashing, server-side opaque sessions | `src/lib/auth.ts` |
| CSRF: same-origin check on mutations | `src/lib/api.ts` |
| Non-root container, native module isolated, minimal image, private image | `Dockerfile` + GHCR |

Future hardening: nonce-based CSP (drops `'unsafe-inline'`, needs middleware),
and `fail2ban` on the host.

---

## 7. Common operations

Run these from the deploy directory on the host (where `docker-compose.yml` is).

```bash
docker compose ps                 # status + health
docker compose logs -f app        # app logs
docker compose pull && docker compose up -d   # deploy a new image tag
docker compose exec app sh        # shell inside the container (USER node)
```

Health endpoint: `GET /api/health` → `{"status":"ok"}` (container healthcheck +
uptime monitoring).

### Redeploy / restart safely

```bash
docker compose pull && docker compose up -d   # pull latest image, recreate
docker compose restart app                    # just bounce the app
docker compose up -d --force-recreate app     # rebuild the container from the same image
```

All of these keep your data: the database lives in the **`app_data` volume**, not
the container. Migrations re-run on boot and are **idempotent + additive-only**
(56 `IF NOT EXISTS` / column guards), so a redeploy never rewrites or drops data.

> ⚠️ The **only** command that destroys data is `docker compose down -v` — the
> `-v` deletes the volume. Plain `docker compose down` (no `-v`) is safe. Take a
> backup (§5) before anything you're unsure about.

### Reset a password / recover an account

No email is involved, so password recovery is a host-side admin action — you only
need SSH/console access to the box, not the app. From the deploy directory:

```bash
# Set a specific password:
docker compose exec app node scripts/reset-password.mjs user@example.com 'NewPassw0rd!'

# …or generate a random temporary one (printed once, share it securely):
docker compose exec app node scripts/reset-password.mjs user@example.com
```

It rehashes with argon2id (same cost as the app), writes directly to the live
database, and **revokes the user's existing sessions**. The container already
points `DB_PATH` at the mounted volume, so it edits real data. The user then logs
in and sets their own in **Settings → Password** (the in-app change-password
flow, which requires the current password).

> Self-service: a logged-in user changes their own password under
> **Settings → Password** — no host access needed. The CLI above is the
> break-glass path for a forgotten password / full lockout.
