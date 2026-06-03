# Private deploy repo

This folder is a **template for a separate, private deploy repo** — it is the
only place your domain, allowlist, and certificates live. The public app repo
never knows about your deployment.

```
 public app repo ──(CI on tag)──► ghcr.io/OWNER/REPO:vX  ──(docker login + pull)──► THIS repo on your server
   source + Dockerfile              private image                                    compose + .env + Caddy
```

## One-time setup

1. **Create a private repo** (e.g. `workouts-deploy`) and copy these files into it:
   `docker-compose.yml`, `Caddyfile`, `.env.example`, `.gitignore`, `backup.sh`.

2. **On the server**, clone it and create `.env`:
   ```bash
   git clone <your-private-deploy-repo> workouts && cd workouts
   cp .env.example .env
   # set IMAGE=ghcr.io/OWNER/REPO:v1.0.0 , DOMAIN=... , REGISTER_ALLOWLIST=...
   ```

3. **Authenticate to GHCR** (the image is private). Create a GitHub PAT with the
   `read:packages` scope, then:
   ```bash
   echo "$GHCR_PAT" | docker login ghcr.io -u YOUR_GH_USERNAME --password-stdin
   ```

4. **DNS:** point an `A`/`AAAA` record for `DOMAIN` at the server; open ports 80 + 443.

5. **Start:**
   ```bash
   docker compose pull
   docker compose up -d
   docker compose logs -f caddy app   # watch the cert get issued
   ```
   Then register your account at `https://DOMAIN/register` (allowlisted emails only).

## Publishing a new image (from the public repo)

In the public app repo, tag a release — CI builds and pushes the image:
```bash
git tag v1.0.1 && git push origin v1.0.1   # triggers .github/workflows/docker-publish.yml
```

## Redeploying (here)

```bash
# bump IMAGE=...:v1.0.1 in .env, then:
docker compose pull && docker compose up -d
```
The `app_data` volume is reused, so **all history is preserved**. Schema
migrations run automatically on start. Roll back by setting IMAGE to an older
tag and re-running.

## Backups

```bash
sh backup.sh            # WAL-safe snapshot into ./backups/
```
Automate with cron and copy snapshots off the box. **Restore:**
```bash
docker compose down                      # NOT -v
docker compose cp backups/workouts-YYYYMMDD-HHMMSS.db app:/data/workouts.db
docker compose run --rm app sh -c 'rm -f /data/workouts.db-wal /data/workouts.db-shm'
docker compose up -d
```

## Don't lose data

The database is the `app_data` volume. It survives `up`, `down`, `pull`, reboots.
It is destroyed only by `docker compose down -v`, deleting the volume, or losing
the host. Keep backups.
