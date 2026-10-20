# Active workout decluttering

**Goal:** Make the active superset easy to scan and log on iPhone while retaining
all prescriptions, history links and recovery controls.

**Baseline:** Fetched `origin/main` and the reusable working checkout both point
to `2db370b3f1080caabd92d184e8417ecc08a52d93`. Preserve unrelated untracked plans
in the primary checkout. The user's October 20 screenshot supersedes the previous
spacing review's judgment that all supporting text should remain expanded.

## Design

Keep rounds and individual exercise names visible. An expanded superset needs a
short Superset A heading, a saved count and manual collapse; its full exercise
names remain available in the closed summary and accessible heading. Each row
keeps its 1a/1b identity, concise target and labeled numeric inputs.

Move previous-workout links and rest/effort/tempo/notes into one Details
disclosure per superset. Keep single-lift prescriptions inline for this focused
pass. Group identical cues by exercise appearance; associate
different cues with their actual sets. This changes presentation, not stored
prescriptions. Do not infer intended load from history.

Quiet routine Not logged text while retaining screen-reader feedback and
acknowledged green checks with a small visible Saved cue. Keep saving, pending edits, failure, conflicts,
missing recorded loads and unconfirmed Undo visible. Use neutral outlined
unsaved checks. Keep round and individual save/undo, 44px targets, stable inputs,
explicit batch/special-role targets and enlarged-text wrapping.

Compared with removing information entirely, disclosure retains useful support.
Compared with a single-round wizard, it preserves the user's requested top-down
superset flow without extra navigation.

## Work graph and ownership

1. Coordinator: remote baseline, this plan, design-system update, browser runtime,
   integration and release.
2. Designer: read-only screenshot/code review and responsive acceptance.
3. Frontend: ExerciseLogCard, WorkoutCard, optional view-only details helper and
   associated component tests. No API, storage or database changes.
4. Coordinator: adapt existing browser assertions to disclosure; render populated
   workouts at 375px and 393px, dark/light and enlarged text.
5. Independent verifier: requirements, code and actual screenshot review.

## Acceptance and verification

- [x] First round shows both lift entries without paragraphs of instructions.
- [x] Notes and previous performance are reachable through one group disclosure;
      mixed prescriptions retain exact appearance/set association.
- [x] Save, undo, group save, partial failure, conflicts, collapse and resume
      preserve their existing semantics.
- [x] No horizontal overflow; labels and decimal values remain readable at
      iPhone mini/16 widths and enlarged text.
- [x] Focused component checks, lint, typecheck and browser workflows pass.
- [x] Independent review findings resolved.
- [ ] Required CI/release gates pass before any live publication claim.

## Evidence

- Frontend reproduced missing compact-heading/disclosure behavior before changes;
  100 focused component tests passed afterward. Full suite: 130 files / 1,189
  tests pass with configured coverage. Full lint and typecheck pass.
- Eight local WebKit workflows pass with zero retries, including the screenshot's
  long names, five-set pairs and verbose notes from older program copies.
  Details exposes each repeated cue once; editing and manual collapse preserve
  values. Existing group save, partial failure/retry, individual undo, reload,
  Calendar resume and Quick stationary-control workflows pass.
- Fresh 375px and 393px screenshots show the complete first round (330px high)
  below the compact header. At 375px/20px enlarged text, controls wrap without
  clipping. All measured inputs/actions meet 44px. Independent designer and
  verifier reviewed normal, enlarged and saved-state screenshots without a
  material finding. This is browser emulation, not physical-device testing.
- No API/schema/storage changes. Single-lift prescriptions remain inline.
  Existing audit bugs concerning exercise additions and training-max saving
  remain separate work.
- Private release evidence lives under `.playwright/quiet-supersets/release/`;
  publication, immutable-image staging and promotion follow the existing gates.
