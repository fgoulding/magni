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

**The automated loop:** push to `main` → CI verifies the exact commit → CI
publishes `:latest` → Watchtower redeploys within ~3 minutes. Verification requires
typecheck, strict lint, the full configured test coverage, a production build,
and Chromium plus iPhone WebKit E2E checks. Any failed check blocks publication.
Each image also has a full commit SHA tag and a recorded immutable digest.
See [release verification and image identity](RELEASE.md) before rollout.

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

After an authorized push to `main`, CI runs the release checks before publishing
`ghcr.io/fgoulding/magni:latest`; Watchtower then redeploys it. A failing or skipped
verification job prevents the publication job from starting. The `app_data`
volume is reused and schema migrations run automatically on boot; validate the
candidate against a restored populated backup before promoting an upgrade.

Watch it happen: `docker compose logs -f watchtower`.

## Pinned releases & rollback

```bash
git tag v1.0.0 && git push origin v1.0.0   # CI also publishes the :v1.0.0 image
```

Version tags are published only after the same verification and do not update
`:latest`. The `published-image-<commit>-<attempt>` Actions artifact records the
tag, full commit, workflow run, and digest. For an exact image, use its
`pinnedImage` value, for example
`IMAGE=ghcr.io/fgoulding/magni@sha256:<digest>`.

For rollback, stop Watchtower and select a previously verified digest. Confirm
that the earlier application supports the current database schema before
restarting it. If it does not, restore the corresponding tested pre-upgrade
backup using `restore.sh`; an image change alone does not undo migrations.

## Backups

```bash
sh backup.sh            # verified, gzip'd, rotated snapshot into ./backups/
```

`backup.sh` takes a consistent online snapshot, runs an integrity check on it
before keeping it, compresses it, and rotates anything older than `KEEP_DAYS`
(default 30). Automate it AND copy snapshots **off the box**:

```bash
0 3 * * * cd /path/to/magni-deploy && sh backup.sh >> backups/backup.log 2>&1
0 4 * * * rsync -a /path/to/magni-deploy/backups/ user@another-host:/backups/magni/
```

**Restore** (stops the app, swaps the file, clears the stale WAL/SHM, restarts):

```bash
sh restore.sh backups/workouts-YYYYMMDD-HHMMSS.db.gz
```

Test a restore once so you trust your backups. Full data-protection notes
(corruption defenses, what not to do, disk monitoring) are in
[`docs/deployment.md` §5](https://github.com/fgoulding/magni/blob/main/docs/deployment.md).

## Don't lose data

The database is the `app_data` volume. It survives `up`, `down`, `pull`, reboots,
and image updates. It is destroyed only by `docker compose down -v` (deletes the
volume) or losing the host disk. Keep off-box backups, and never put the volume on
a network filesystem (NFS/SMB) — SQLite corrupts there.
