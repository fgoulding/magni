# Shared Program Sync Design

## Goal

Make workout execution the primary experience while supporting shared workout programs for a small group, beginning with two lifters who train from the same structure but use different loads.

The system should let invited admins publish shared program changes, let members review and sync those changes, preserve personal training maxes and workout history, and support native rollback to previous shared versions.

## Product Principles

- Shared program structure is global to the group.
- Personal loading and history are private to each user.
- Shared definition wins when a user chooses to sync.
- Sync is reviewed by the user before it changes their active program.
- Rollback is a first-class action, not a manual database repair.
- Workout execution should feel more important than program setup.

## Shared Definition

A shared program definition owns the reusable training structure:

- Program name and description.
- Week count.
- Ordered training days.
- Ordered exercise slots.
- Exercise categories.
- Training/progression template choices.
- Week schemes: intensity, reps, sets, rep-out targets.

It does not own user-specific loads, active progress, completed workouts, notes, or private session history.

Shared programs use an owner/admin permission model:

- The creator is the owner.
- The owner can invite admins.
- Invited admins can edit the shared definition and publish new versions.
- Members can view and sync versions, but cannot publish changes unless promoted to admin.

## Versioning

Admins do not edit users' live program rows directly. Instead, admins publish immutable shared program versions.

Each version is a snapshot of the shared structure at publication time. Versions make three important workflows possible:

- Members can review differences between their current applied version and the latest published version.
- Members can apply a version without overwriting personal training maxes or workout history.
- Members can roll back their local structure to a previously applied shared version.

Exercise identity must be stable across versions. A shared exercise slot should have a stable identifier that survives renames, so changing "Squat" to "Comp Squat" preserves each user's personal max and session history link.

## Personal State

Each user keeps their own program state linked to the shared program:

- Current week and day.
- Training maxes or expected maxes per shared exercise slot.
- Training max history per lift.
- Working weight history per performed set.
- Implied max history derived from training max and logged performance.
- Completed sessions.
- Skipped sessions.
- Set results.
- Notes.
- Applied shared version.
- The shared program version used when a workout was performed.
- Rollback history.

When a user syncs, structural data is replaced from the selected shared version. Personal values are carried forward by stable shared exercise slot ID.

Private structural modifications are not supported in the first design. If a user wants to change the structure, an admin should publish a shared update. This keeps the mental model simple: shared definition is the source of truth.

## Sync With Review

When a newer shared version exists, members see an update available state.

The review screen should show:

- Added, removed, renamed, and reordered days.
- Added, removed, renamed, and reordered exercises.
- Template/progression changes.
- Week-scheme changes.
- Any exercise slots that require the user to confirm an expected max.

The user can:

- Apply the update.
- Skip for now.
- Roll back to a previously applied version.

Applying a sync should be transactional. Either all shared structure changes and personal max mappings apply, or none do.

## Expected Maxes And Gauge

During sync, each user confirms an expected max for each relevant exercise slot.

The form should default to the user's existing expected max when one exists. If there is no existing value, it may show other members' submitted maxes as a reference gauge, not an automatic assignment.

Example gauge copy:

- "You: 275 lb"
- "Sam: 315 lb"
- "Alex: 245 lb"

These values should only be visible to members of the shared program. They are training context, not public leaderboard data.

## Lift History And Analytics

The app should store enough information to generate useful historical views later, without requiring another schema rewrite.

Track at least:

- Training max changes by exercise slot and user.
- Working weight used on each logged set.
- Actual reps and rep-out performance.
- Implied max derived from training max and logged performance.
- Shared program version used for each workout session.
- Skipped workouts as explicit history events.

History should support questions like:

- "What was my squat training max over time?"
- "What working weights did I use on SBS week 3?"
- "How has my implied max changed?"
- "Which version of the shared program did I run that day?"
- "Which workouts were skipped and why?"

This does not require building charts immediately. The first implementation should record durable facts so later analytics can be generated cleanly.

## Workout Execution Priority

The app should make "what do I lift today?" the first-class path.

Recommended UI direction:

- The Today screen becomes the primary workout dashboard.
- Active workout cards show the current shared version status when relevant.
- If a sync is available, show a clear but non-blocking prompt before starting.
- Starting or continuing a workout should be visually stronger than editing setup details.
- Program setup/editing remains available, but secondary.
- Users can skip a workout when they do not have time. Skips are logged with the same program/day/week/version context as completed workouts and can optionally include a note.

This work should not require a visual redesign before the data model is ready. The first UI step can be modest: stronger Today cards, clearer start/continue actions, and update prompts that lead to the sync review.

## Program Editing And Defaults

Program defaults should support two workflows:

- Start from a default or existing shared program, then save as a new private/shared program.
- Edit an existing shared definition and publish it as an update.

Exercise order matters. Program editing should support reordering lifts within a day and preserve stable exercise keys so personal history follows the lift across renames and reorders.

## Data Model Direction

Add shared-program tables alongside existing private program tables. Keep existing private programs working.

Proposed entities:

- `shared_programs`: shared definition metadata, owner, active published version.
- `shared_program_members`: user membership and role.
- `shared_program_versions`: immutable published snapshots.
- `shared_program_member_state`: user's applied version and active progress link.
- `shared_program_expected_maxes`: user's expected max per shared exercise slot.
- `exercise_max_history`: user/lift max snapshots and implied max values over time.
- session version fields: every workout session records the shared program version active at start.
- skip/session status fields: sessions can be completed, skipped, or in progress.

Snapshots can start as structured JSON for the shared definition. That keeps versioning and diffing straightforward while the product surface is still changing. Private runnable programs can continue using normalized `programs`, `days`, `exercises`, and `week_settings` rows.

When a user applies a shared version, the app materializes or updates that user's private runnable program rows from the snapshot. This preserves current workout APIs and reduces risk.

## Error Handling

- Non-members cannot view or sync shared programs.
- Members cannot publish versions unless they are admins.
- Sync rejects stale requests if a newer version is selected unexpectedly.
- Removed exercise slots preserve historical sessions but no longer appear in future workouts.
- Rollback creates the same kind of reviewed structural update as forward sync.
- Sync failures return clear messages and leave the user's current structure unchanged.
- Skipping a workout records a skipped session and does not apply training max progression.

## Testing Strategy

Tests should cover:

- Permission rules for owner, admin, member, and non-member.
- Publishing immutable versions.
- Sync review diff output.
- Applying sync while preserving personal expected maxes.
- Applying sync while preserving session history.
- Rollback to a previously applied version.
- Workout start behavior after sync.
- Workout skip behavior and history logging.
- Session records include the applied shared version.
- Lift max, working weight, and implied max history can be queried by exercise slot.
- Reordering lifts preserves stable exercise identity.
- Existing private program behavior unchanged.

Use route-level tests for API behavior and focused unit tests for snapshot diff/apply logic.

## Open Questions

- Invitation UX: email-based invite, direct member add, or local-only first pass.
- Whether owners can demote/remove admins in the first implementation.
- Whether a member can choose not to sync indefinitely while remaining in the shared program.
- Whether expected maxes should support units per user or only app-level rounding/unit settings.
