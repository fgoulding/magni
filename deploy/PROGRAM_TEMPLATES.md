# Publishing reusable programs as data

Ordinary users choose a named program in **Programs → Create**, set a start date,
weekdays and repeat cycles, optionally choose day-specific working weights, and
create their own independent program. The advanced workspace remains available.
Creating a personal copy never changes the shared default or another user's data.

The app reads the published catalog on each request. Publishing a new template
revision does **not** build an image, restart the app, rewrite existing drafts,
change active prescriptions or alter workout history. This runtime catalog needs
one initial application release; subsequent supported content changes use the
workflow below. Changes to application behavior still use all normal release gates.

## Format and limits

`program-templates/full-body-supersets-3-day.json` is a complete authoring example.
Template schema version 1 supports 1–7 full-body or split days, one weekday per
day, 1–52 repeated weeks, manual working loads, bodyweight, superset groups, rep
ranges, rest, RIR, tempo and notes. Percentage loading, automatic progression,
variable week blocks and weighted bodyweight require the advanced document editor;
unknown template fields are rejected rather than silently discarded.

Every lift has a stable `id`, display `name` and `loadMode`. Every day has an `id`
and `name`. Every exercise appearance has a globally unique slot `id`, a `liftId`
reference and its prescription. Reusing a lift ID links history within a newly
created program; each slot has independent working weight and progression state.
Copies receive fresh internal IDs. Loads are not inferred from training maxes or
converted when the user selects units. Blank working weights are zero/unset with
the workout cue “Choose your working weight before logging.” Bodyweight remains
bodyweight. Program name is limited to 140 characters, loads to 0–1,000,000.

Increment `revision` for changes to a shared template; never reuse a revision
number with different content. Template IDs are lowercase letters, numbers and
hyphens, starting with a letter. New named programs use new IDs and revision 1.

## Preview and rehearse against the deployed engine

Use a local checkout of the deployed application revision, with dependencies
installed under Node 22. Put your candidate JSON in that checkout's
`program-templates/` directory or an external scratch directory. Obtain the running
revision from `/api/health` or the container's `APP_REVISION`.

```sh
node scripts/program-template.mjs validate /tmp/candidate.json
node scripts/program-template.mjs preview /tmp/candidate.json
node scripts/program-template-check.mjs /tmp/candidate.json \
  --engine-revision RUNNING_APP_SHA --receipt /tmp/template-rehearsal.json
```

Review the preview's days, sets, ranges and pairings. The focused rehearsal uses
the real application database and workout engine with **disposable data**: schema
validation, document compilation, save/retry, frozen activation/retry, all scheduled
dates and sets, and starting/logging/completing each distinct training day. It also
checks SQLite integrity. It never opens the deployment database.

The receipt binds validated content to the deployed engine revision and checks
that local application source matches it. Only JSON in `program-templates/` and
documentation under `docs/` may differ. A local development rehearsal can pass
while reporting `engineSourceMatches: false`; that receipt cannot publish.
Changing application source requires an application release. Use a new receipt
filename for every check. Candidate changes after a check require another check.

## Owner-only publication

Only the server operator can publish. There is no web publishing endpoint and no
global-admin privilege inferred from an ordinary user's shared-program role.
The CLI is packaged in the application image and needs no test or TypeScript
runtime dependencies.

Copy the reviewed candidate and its receipt into the running container, then:

```sh
docker compose exec -T app node scripts/program-template.mjs list
docker compose exec -T app node scripts/program-template.mjs publish \
  /tmp/candidate.json --expect-current 1 --receipt /tmp/template-rehearsal.json
```

Use `--expect-current none` for a new template ID. The current revision must still
match what you reviewed. The CLI rejects unsupported data, changed content,
mismatched engine revisions and a rehearsal with modified application source.
An identical completed publish can be safely retried after a lost response.
An interrupted publish can recover the same newest immutable candidate under the
same compare-and-swap check. Different content always needs a new revision.

The catalog defaults to `program-templates/` beside `DB_PATH`, normally
`/data/program-templates`; `PROGRAM_TEMPLATES_DIR` can override it. Immutable
revision files and their rehearsal receipts live in `revisions/`; small `current/`
pointers are replaced atomically under an operator write lock. Invalid pointers or
hash mismatches fail closed. A persistent lock after an operator crash requires
checking that no publisher is still running before removing `.write.lock`.

## Rollback and backup

Rollback changes only the catalog entry used for future creations:

```sh
docker compose exec -T app node scripts/program-template.mjs rollback \
  full-body-supersets-3-day --revision 1 --expect-current 2
```

The first publication also archives the prior bundled revision. Rollback uses the
same revision check and validates the stored content; it never restores or changes
the training database.

**Database-only backups do not contain the runtime catalog.** Back up the entire
catalog directory alongside normal database backups, including `current/`,
`revisions/` and receipts. Run the catalog backup when no publisher holds its lock.
Retain the image revision referenced by each receipt. Prefer the rollback command
for content mistakes. For disaster recovery, stop the app and publishers, restore
the complete catalog directory from one backup, keep ownership writable by the
container's `node` user, then run `list` to validate all pointers before restarting.
Never replace individual revision files or restore a training database to undo a
template edit.
