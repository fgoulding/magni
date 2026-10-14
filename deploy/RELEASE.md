# Release verification and image identity

The `Publish image` workflow runs `Verify release candidate` for pull requests,
main pushes, `v*` tags, and manual runs. The publication job requires that job to
succeed and only publishes from main or a `v*` ref. Pull requests and manual runs
on other branches cannot publish. No check has a continue-on-error path.

CI installs the lockfile with Node 22, matching the Docker runtime. Application
checks and browser checks run concurrently on separate GitHub runners. The
application job runs `node scripts/release-check.core.mjs`:

1. Release policy and failure-propagation checks.
2. `npm audit --omit=dev`, requiring the production dependency audit to pass.
3. Next route type generation and the normal typecheck command.
4. Lint with zero allowed warnings.
5. `npm run test:coverage`, which runs the full suite with the existing configured
   coverage thresholds. It accepts no coverage reduction or test filtering flags.
6. The normal production build.
The browser job has four independent runners: two file-level shards of Chromium
and two of iPhone WebKit. Each installs its assigned engine and owns its Next
server, disposable SQLite database and generated output. Each retains one worker
and the existing order within test files; parallelism never shares a test server
or database. [Playwright sharding](https://playwright.dev/docs/test-sharding)
splits the full project suite without selecting or dropping test files. A test
that fails initially and passes on retry still fails the release gate; retries
collect diagnostic evidence and cannot turn a flaky run into a promotion.

The required `Verify release candidate` job aggregates these results. It requires
all seven application gates and all four browser jobs to succeed for the same
clean commit, ref, package version, workflow run and attempt. It compares every
executed case ID with the complete suite discovered independently by the
application job. Missing/duplicate shards or cases, skipped tests, unexpected
cases, failures, retries and collection errors block publication. Adding a test
automatically expands this expected set; there is no hardcoded case count or
path-based shortcut. The final receipt preserves all eight gate names, including
the complete `e2e` gate. Per-check and per-shard timings show where time is spent.

Evidence is split so normal promotion never downloads screenshots or traces:

- `release-checks-<commit>-<attempt>` is the small release receipt. It retains
  `.playwright/release-checks/result.json` and `coverage/coverage-summary.json`,
  preserving the paths used by guarded deployment tooling.
- `release-diagnostics-core-<commit>-<attempt>` contains core check logs.
- `release-diagnostics-browser-<commit>-<attempt>-<project>-<shard>` contains that
  shard's logs, JSON/JUnit/HTML report, screenshots and available traces. Download
  it only when investigating a failure. Traces include the first failed attempt,
  even when a later diagnostic retry passes.

The core and browser jobs also upload small intermediate receipts for aggregation.
Evidence uploads run after failures, while failed or missing evidence cannot
satisfy the publication gate. Keep the final receipt and published image identity
with the release record. Repository branch protection should require
`Verify release candidate`; changing branch-protection settings remains a
repository administration step, separate from these files.

## Local verification

```sh
npm ci
npx playwright install --with-deps chromium webkit
node scripts/release-check.mjs
```

The local command retains the full sequential eight-gate flow; it has no skip
flags. Check logs and `result.json` in `.playwright/release-checks/`. It runs
checks only; it cannot tag, push, publish, or deploy. A dirty checkout, including
new untracked source files, is recorded as dirty and does not establish that its
current HEAD alone was verified. CI aggregation rejects dirty receipts and any
source identity change during a check invalidates its evidence.

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
