# Magni — private deploy (Cloudflare Tunnel)

This folder is a **template for a separate, private deploy repo**. It is the only
place your tunnel token, allowlist, and host config live. The public app repo
never knows about your deployment.

```
 public repo (magni) ──push to main──► GitHub Actions builds & pushes
        │                                ghcr.io/fgoulding/magni:latest  (private)
        │                                          │
        │                                          ▼
   your server ◄── Watchtower polls GHCR, pulls the new image, recreates the
        │           container with the SAME app_data volume (history preserved)
        │
        └── cloudflared ──outbound tunnel──► Cloudflare edge ──► https://magni.tylergould.ing
            (no inbound ports opened — anything else on the host is untouched)
```

**The automated loop:** you push to `main` → CI publishes `:latest` → Watchtower
redeploys within ~3 minutes. That's the whole flow. No SSH needed for routine
updates. Tag `v*` only when you want a pinned, rollback-able release.

---

## One-time setup

### 1. Cloudflare tunnel (gives you the public HTTPS URL, no port-forwarding)

1. In the **Cloudflare Zero Trust** dashboard → **Networks → Tunnels → Create a
   tunnel → Cloudflared**. Name it `magni`. Copy the **tunnel token** it shows.
2. In that tunnel's **Public Hostnames**, add:
   - **Subdomain:** `magni`  **Domain:** `tylergould.ing`
   - **Service:** `HTTP`  →  `app:3000`
   (Cloudflare auto-creates the `magni.tylergould.ing` DNS record for you.)

### 2. GHCR access (the image is private)

Create a GitHub PAT with the **`read:packages`** scope. On the host:

```bash
echo "$GHCR_PAT" | docker login ghcr.io -u fgoulding --password-stdin
```

This writes `~/.docker/config.json`, which Watchtower mounts to pull updates.
(If you ran `docker login` as a non-root user, set `DOCKER_CONFIG_DIR` in `.env`
to that user's `.docker` directory.)

### 3. Put the stack on the host

```bash
mkdir -p magni-deploy && cd magni-deploy
# copy these files here (git clone your private deploy repo, or scp them)
cp .env.example .env
# edit .env: paste TUNNEL_TOKEN, set REGISTER_ALLOWLIST
docker compose pull
docker compose up -d
docker compose logs -f cloudflared app   # watch the tunnel connect + app boot
```

Then open **https://magni.tylergould.ing/register** and create your account
(allowlisted emails only). Add it to your iPhone Home Screen to install the PWA.

---

## Updating (the normal path — automatic)

Just push to `main` in the public repo. CI builds `ghcr.io/fgoulding/magni:latest`
and Watchtower redeploys it. The `app_data` volume is reused, so **all history is
preserved** and schema migrations run automatically on boot.

Watch it happen: `docker compose logs -f watchtower`.

## Pinned releases & rollback

```bash
git tag v1.0.0 && git push origin v1.0.0   # CI also publishes the :v1.0.0 image
```

To roll back, set `IMAGE=ghcr.io/fgoulding/magni:v0.9.0` in `.env`, comment out the
`watchtower` service (so it stops re-pulling `:latest`), then
`docker compose up -d`.

## Backups

```bash
sh backup.sh            # WAL-safe snapshot into ./backups/
```

Automate with cron and copy snapshots off the box:

```bash
0 3 * * * cd /path/to/magni-deploy && sh backup.sh >> backups/backup.log 2>&1
```

**Restore:**

```bash
docker compose down                      # NOT -v
docker compose cp backups/workouts-YYYYMMDD-HHMMSS.db app:/data/workouts.db
docker compose run --rm app sh -c 'rm -f /data/workouts.db-wal /data/workouts.db-shm'
docker compose up -d
```

## Don't lose data

The database is the `app_data` volume. It survives `up`, `down`, `pull`, reboots,
and image updates. It is destroyed only by `docker compose down -v`, deleting the
volume, or losing the host. Keep backups.
