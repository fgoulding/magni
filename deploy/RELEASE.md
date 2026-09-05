# Release verification and image identity

The `Publish image` workflow runs `Verify release candidate` for pull requests,
main pushes, `v*` tags, and manual runs. The publication job requires that job to
succeed and only publishes from main or a `v*` ref. Pull requests and manual runs
on other branches cannot publish. No check has a continue-on-error path.

The verification job installs the lockfile with Node 22, matching the Docker
runtime, and installs Chromium/WebKit plus their operating-system dependencies.
`node scripts/release-check.mjs` then runs, in order:

1. Release policy and failure-propagation checks.
2. `npm audit --omit=dev`, requiring the production dependency audit to pass.
3. Next route type generation and the normal typecheck command.
4. Lint with zero allowed warnings.
5. `npm run test:coverage`, which runs the full suite with the existing configured
   coverage thresholds. It accepts no coverage reduction or test filtering flags.
6. The normal production build.
7. Every configured E2E test in both Chromium and iPhone WebKit projects.

The first failure stops the sequence and marks all later checks skipped. CI
uploads per-check output and `result.json` even on failure, plus available
coverage, JUnit, HTML, and browser trace artifacts. The result identifies the
full tested commit, source ref, package version, dirty-checkout state, run ID,
and attempt. Keep this artifact with the release record. Repository branch
protection should require `Verify release candidate`; changing branch-protection
settings remains a repository administration step, separate from these files.

## Local verification

```sh
npm ci
npx playwright install --with-deps chromium webkit
node scripts/release-check.mjs
```

Check logs and `result.json` in `.playwright/release-checks/`. This command runs
checks only; it cannot tag, push, publish, or deploy. A dirty checkout, including
new untracked source files, is recorded as dirty and does not establish that its
current HEAD alone was verified.

For E2E checks alone, use `npm run test:e2e`. The default port is 3108; choose
another with `E2E_PORT=3109 npm run test:e2e`. An occupied port fails instead of
silently reusing an existing server. Each run creates its own
`.playwright/e2e-<random>/e2e.sqlite`, generated Next output, and temporary
TypeScript configuration. The launcher ignores an inherited personal `DB_PATH`,
never deletes another database, and leaves the disposable directory available
for debugging. It uses the current Node executable, with no machine-specific npm
path. Next's generated root `next-env.d.ts` is restored during normal teardown
only if it still references this run; a concurrent build's newer reference is
preserved. Stop the run before deleting its generated directory.

The E2E server currently runs development mode because registration tests create
unique synthetic users and production registration is intentionally allowlisted.
The production build is independently required first. These browser checks do
not establish installed-PWA behavior on a physical iPhone or validate a deployed
production server.

## Candidate, rollout, and rollback

Successful publication records a `published-image-<commit>-<attempt>` artifact
containing `commit`, `ref`, `version`, image tags, image digest, verified workflow
URL, and `pinnedImage`. OCI labels also include source and full revision, and
Buildx emits provenance. Main images carry `sha-<full-commit>` and `latest`; release
tags carry `sha-<full-commit>` and their `v*` tag. A release tag never implicitly
updates `latest`.

Use the recorded digest for an immutable candidate, for example
`ghcr.io/fgoulding/magni@sha256:<digest>`. Tags, including full-SHA tags, remain
registry pointers; the digest identifies the exact image bytes. Before an
authorized production rollout, rehearse the candidate on staging with a restored
populated backup, verify migration and recovery evidence, and record the digest,
backup, and application version together. The workflow's existing `latest`
publication can trigger Watchtower, so a main push is a rollout action on a
deployment following that tag. A local green check does not authorize that push.

Pin staging or production's `IMAGE` to the verified digest when deliberate
promotion is required. Pausing automatic updates and changing the deployed image
require deployment authorization. These repository changes do not modify any
running server or its Watchtower configuration.

For rollback, pair a previously verified image digest with a compatible schema.
When the earlier application cannot read the upgraded schema, use the tested
pre-upgrade backup/restore procedure. Do not infer schema compatibility from an
older image tag alone.


## Verified database maintenance

The deployed backup and restore wrappers use `scripts/database-maintenance.mjs`,
which is also exercised by the release gate. Online backup uses SQLite's backup
API, verifies integrity and foreign keys, and writes a SHA-256 receipt. The host
wrapper copies both files out of the application volume before marking
`/data/backup-status.json` successful. Settings reports this timestamp and marks
receipts older than48 hours stale. A receipt does not prove an off-host copy.

Restore verifies input before downtime, requires an explicit operator confirmation,
stops the app, verifies the checksum when a receipt is available, preserves the
current database as a rollback copy, and atomically replaces the database while
writers are stopped. If verification or restore fails, do not restart training
until the operator has resolved it. The wrapper leaves the application stopped
on a restore failure. Keep the original backup and its `.db.json` receipt together.

Local rehearsal evidence is recorded in the implementation checklist. The baseline
schema accepted additive extensions in the disposable fixture, but the prior app
does not understand custom-editor execution or occurrence scheduling. Prefer the
verified pre-upgrade backup plus prior image for rollback; exporting or preserving
post-upgrade workouts before rollback requires an explicit data reconciliation.
A real staging rehearsal and authorized deployment are separate pending gates.
