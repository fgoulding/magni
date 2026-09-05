# Magni program files

A program file is UTF-8 JSON with `schemaVersion: 1`, conventionally named
`my-program.magni.json`. The standalone program workspace can import a complete
file, edit it visually, preview its rules, and activate it. Export includes the
current draft's definitions and rules, without workout history or account data.
Import replaces the current draft content; Undo restores the prior draft.

The six files in `examples/programs/` are complete examples of all-set linear,
double progression, percentage blocks, top/back-off sets, repeated-failure reset,
and manual A/B supersets. Change the start date before activating an example.

Top-level fields are `name`, `description`, `unit` (`lb` or `kg`), `cycles`,
`weekdays` (0=Sunday through 6=Saturday), `startDate` (`YYYY-MM-DD`), and `weeks`.
Each week has a name, optional block name, `deload` flag, and ordered days. Each
day has a name and ordered exercises. Each exercise defines its working load,
explicit training max, optional superset group, notes, ordered sets, and a rule.

Every week, day, exercise, and set has a distinct string `id`. Copies made in the
workspace automatically get new IDs. An exercise's `progressionKey` deliberately
shares its state with appearances in other weeks/days. Shared appearances use the
same starting load, training max and rule, while set prescriptions may differ.
Use another key to progress a variant independently. Designated-set rules target
the corresponding top/AMRAP set ID in each appearance.

Each set specifies its role (`warmup`, `work`, `top`, `backoff`, `amrap`), integer
rep range, load basis (`working`, `fixed`, `percent`, `bodyweight`, `added`), load,
effort kind and target, rest seconds, tempo and notes. A percentage always uses
the exercise's explicit training max. A fixed/added load is a literal override.
Unit changes reinterpret entered values; they do not convert them.

`rule: null` means manual progression. Version 1 rules combine a condition
(`all_work_sets`, `double_progression`, `designated_set`, `weekly`) with an action:
`variable` (`load`, `trainingMax`, `reps`), units, `operation` (`add` or `percent`),
amount, rounding direction and quantum, and evaluation timing. Optional skip and
partial policies default to hold. Optional `failureReset` specifies a failure
count, reduction percentage and rounding. Fixed deload weeks take precedence.
The workspace describes and previews the actual evaluator's decisions.

Full validation runs before import/activation and returns field-specific errors.
The exact types and validation limits live in
`src/features/program-editor/document.ts` and `progression.ts`. Draft saves allow
unfinished fields, but activation requires a complete valid program. An exported
unfinished draft may need those fields completed before file import.

Activation creates an immutable version. Later draft edits and file replacement
do not change that active run, its started sessions, or historical prescriptions.
Save a copy and activate separately to train a changed version. Moving an existing
workout only changes its date; performance may update future loads under its
frozen rule, and a started session retains the prescription it began with.
