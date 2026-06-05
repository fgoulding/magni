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

## 5. Backups

One SQLite file, in WAL mode — don't `cp` it live. Use the WAL-safe online
backup script in your deploy repo:

```bash
sh backup.sh            # snapshot into ./backups/
```

Cron it and copy snapshots **off the box**:

```cron
0 3 * * * cd /srv/workouts && sh backup.sh >> backups/backup.log 2>&1
```

Restore steps are in [`deploy/README.md`](../deploy/README.md). Test a restore
once so you trust your backups.

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
