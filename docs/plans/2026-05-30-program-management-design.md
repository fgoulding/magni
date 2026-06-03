# Program Management Redesign

## Goal

Make workout execution feel first-class while making program management clear. A user should understand the difference between a reusable program and the thing they are actively running this week.

## Problem

The current model treats `programs` as both:

- A reusable workout definition: days, exercises, progression templates, shared updates.
- A personal active run: current week/day, active state, private maxes, workout history.

That makes the UI confusing. Turning on many programs makes Today show many unrelated workouts, and there is no way to say that a run happens on Sunday, Tuesday, and Thursday.

## Recommended Model

Split program management into two concepts:

- **Program Definition:** reusable workout plan. It can be custom, built from a default, copied, or shared with another user.
- **Program Run:** one user running a definition. It owns schedule, current week/day, active state, expected maxes, skips, sessions, and private modifications.

Custom programs stay first-class. A blank custom program creates a private definition first, then optionally creates a run from it.

## Data Model

Add definition/run tables incrementally while preserving current behavior during migration.

- `program_definitions`
  - `id`
  - `owner_user_id`
  - `name`
  - `description`
  - `source_type`: `custom`, `default`, `shared`
  - `shared_program_id`
  - `shared_program_version_id`
  - `visibility`: `private`, `shared`
  - timestamps/archive fields

- `program_definition_days`
  - definition-owned training days in order.
  - display labels remain flexible: "Lower", "Sunday Lower", "Day 1".

- `program_definition_exercises`
  - definition-owned exercises, categories, progression type, superset group, sort order, stable shared/custom key.

- `program_definition_week_settings`
  - canonical week/set template rows.

- `program_runs`
  - `id`
  - `user_id`
  - `definition_id`
  - `name`
  - `status`: `active`, `paused`, `completed`, `archived`
  - `current_week`
  - `current_day`
  - `start_date`
  - `private_modifications_enabled`

- `program_run_schedule_days`
  - `program_run_id`
  - `weekday`: `0` through `6`, Sunday through Saturday.
  - optional `definition_day_number` for fixed mapping later. Initial version can rotate through definition days.

- `program_run_expected_maxes`
  - per run and exercise key.

- Sessions should eventually reference `program_run_id` and snapshot the definition version used when executed.

## UI Model

Bottom nav:

- `Today`
- `Programs`
- `History`
- `Settings`

Programs screen:

- **Active Runs** at top. These are things the user is currently doing.
  - Card shows next workout, week/day, weekday chips, progress ring or small activity sparkline.
  - Actions: Start, Pause, Edit Schedule, View Definition.

- **Library** below. These are reusable definitions.
  - Filters or segmented control: Custom, Shared, Defaults, Archived.
  - Actions: Start Run, Edit Definition, Duplicate, Share.

Program detail:

- `Run` tab: schedule, current cursor, expected maxes, pause/archive.
- `Definition` tab: days/exercises/progression editing.
- `History` tab: sessions and lift trends scoped to this run/definition.
- `Share` tab only when sharing is relevant.

Create flow:

1. Choose source: Blank, Default Template, Shared Program, Duplicate Existing.
2. Edit definition basics: name, weeks, days/exercises.
3. Optional "Start a run now".
4. If starting a run, choose weekdays and expected maxes.

## Today Behavior

Today should be schedule-driven, not just active-flag-driven.

- Show runs scheduled for today first.
- Show overdue runs second.
- Show optional "Other active runs" collapsed below.
- Allow multiple active runs, but make that an intentional schedule choice.

If no run is scheduled today, Today can show a calm empty state with "Start unscheduled workout" and "Edit schedule".

## Shared Programs

Shared program definitions are canonical. Users run them through personal runs.

- Shared definition updates can be reviewed and applied.
- Run expected maxes remain private per user.
- Private modifications should fork or override the user's run without mutating shared definition.
- Rollback applies to the definition version and leaves run history intact.

## Migration Strategy

Implement in small slices:

1. Add run schedule fields to current `programs` model as a bridge.
2. Update Today to use schedule and active status.
3. Redesign Programs screen into Active Runs + Library using current tables.
4. Introduce real `program_definitions` and `program_runs` tables.
5. Migrate current rows into one definition plus one run per existing program.
6. Move sessions/history to `program_run_id`.
7. Move shared sync to definitions while runs keep private maxes/history.

This avoids a giant rewrite and keeps the app usable after each merge.

## Testing

Coverage should prove:

- Existing custom programs migrate into custom definitions and active runs.
- A user can create a custom definition and start a scheduled run.
- Today only shows scheduled/overdue runs by default.
- Multiple active runs are supported and intentionally visible.
- Shared definition updates do not overwrite user expected maxes or historical sessions.
- Private modifications are preserved or surfaced as forks.

## Open Questions

- Should schedule map weekdays to specific definition days, or should it rotate through the next program day each scheduled date?
- Should a run have a planned start date before it appears on Today?
- Should "pause" hide from Today while preserving schedule?

Initial recommendation: rotate through the next program day on scheduled weekdays, add fixed day mapping later.
