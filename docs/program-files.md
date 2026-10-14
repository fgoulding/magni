# Magni program JSON

**Programs → Import JSON** accepts a file or pasted JSON and saves a new private
draft. The same visual builder edits imported and manually authored programs.
Review the workouts and schedule, then choose **Start program** when ready.
Importing never starts a program, replaces an open draft or changes workout history.

## Public format

Use UTF-8 JSON, conventionally named `my-program.magni.json`, smaller than 2 MB:

```json
{
  "format": "magni.program",
  "schemaVersion": 1,
  "program": {
    "name": "My program",
    "description": "A reusable workout plan",
    "unit": "lb",
    "weeks": []
  },
  "setup": { "cycles": 4, "weekdays": [1, 3, 5] }
}
```

This small skeleton is an unfinished draft. The [complete example](../src/features/program-files/example.magni.json)
contains actual exercises and sets. The [machine-readable schema](../src/features/program-files/program-file.schema.json)
is also served at `/api/program-imports/schema`; download the example from
`/api/program-imports/example`. **Copy AI instructions** on Import JSON provides
these links and the important authoring rules.

`program` holds reusable content. Optional `setup` holds personal defaults:
`cycles` repeats the complete ordered weeks (default 1), `weekdays` uses 0=Sunday
through 6=Saturday (default Monday/Wednesday/Friday), and optional `startDate`
uses `YYYY-MM-DD`. No start date is needed to import. The review screen requires
one before starting. A cycle is a repeat of the authored weeks, not necessarily
one calendar week: workouts occupy the next selected weekdays in order.

Each week has a distinct string `id`, `name`, `block` (empty when unused),
`deload` flag and ordered `days`. Each day has `id`, `name` and ordered
`exercises`. Each exercise has an appearance `id`, `name`, `progressionKey`,
`baseLoad`, `trainingMax`, `supersetGroup` (empty when unpaired), `notes`, `rule`
and ordered `sets`. Optional `historyKey` identifies appearances of the same
exercise separately from progression sharing. Put adjacent exercises in the same
superset by using the same group label within their day.

Each set has a distinct `id`, role (`warmup`, `work`, `top`, `backoff`, `amrap`),
integer `repMin`/`repMax`, `loadMode` (`working`, `fixed`, `percent`, `bodyweight`,
`added`), `load`, `effortKind` (`none`, `rpe`, `rir`), `effort`, `restSeconds`,
`tempo` and `notes`. A percentage uses the exercise's explicit positive training
max: `load: 75` means 75%. Fixed/added loads are literal values. Working sets use
`baseLoad`; bodyweight sets use zero external load. If a working weight is not
known, use zero and an explicit “Choose your working weight before logging.”
set note. Unit changes reinterpret values; they do not convert them.

`rule: null` means manual progression. Version 1 progression combines a condition
(`all_work_sets`, `double_progression`, `designated_set`, `weekly`) with an action:
`variable` (`load`, `trainingMax`, `reps`), `unit`, `operation` (`add`, `percent`),
`amount`, `rounding` (`mode`, `quantum`) and `timing`. Optional skip and partial
policies default to hold. Optional `failureReset` defines a failure count,
percentage reduction and rounding. A designated-set rule references a top/AMRAP
set ID in that exercise. Fixed deload weeks take precedence.

Reusing a `progressionKey` deliberately shares progression across appearances.
Those appearances must use the same initial load, training max and rule. Sets
may differ. Use separate keys for independent progression. Reusing a history
key alone does not share working weights. New imports remap portable IDs once,
preserving these relationships and designated-set references without claiming
another program's identity. Normal edits preserve IDs.

## Validation and compatibility

Unknown fields and unsupported versions are rejected with field paths, never
silently removed. The JSON schema checks structure; server validation also checks
ID uniqueness, references, shared progression, rep ranges, dates, document size
and schedule limits. Unfinished names or empty days may be saved as a draft;
starting requires a complete valid program. Current bounds include 52 authored
weeks, 14 days per authored week, 40 exercises per day, 30 sets per exercise,
10,000 authored sets and 3,640 scheduled workouts.

Existing rich `schemaVersion: 1` files without a format discriminator remain
accepted. The six rich examples in `examples/programs/` continue to work. Compact
operator catalog files with `lifts`/`days` are also accepted through an adapter.
New exports use `format: "magni.program"` and preserve all rich prescriptions,
progression rules, notes, roles and identity relationships. Unsupported hidden
fields cause an export error instead of being discarded.

Original training-system snapshots and proportional AMRAP rules use their
existing engine. They are not silently converted into a different progression
rule by this importer. Catalog publication remains an operator-only operation;
personal imports are never global defaults.

Starting creates an immutable version. Subsequent draft edits/imports do not
rewrite active runs, started sessions or historical prescriptions. Existing
reviewed active-workout edits remain a separate explicit operation.

See [direct JSON submission](program-import-api.md) for authenticated LLM uploads.
