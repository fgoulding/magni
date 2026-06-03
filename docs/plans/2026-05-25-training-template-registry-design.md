# Training Template Registry Design

## Goal

Make training and progression templates the first-class extension point for open-source contributors.

Contributors should be able to add a new template by creating one focused module, adding contract tests, and registering it in one place. They should not need to understand route handlers, database plumbing, or workout completion internals to contribute a template safely.

## Recommended Approach

Use a code-based template registry.

This gives the project a clear extension model while preserving TypeScript checks, focused tests, and room for future progression logic. JSON or YAML templates would be easier for pure data entry, but they would become awkward once a template needs category-specific rules, AMRAP behavior, or validation. Runtime plugin packages are too much surface area for this stage.

## Module Shape

Create a feature module:

```text
src/features/training-templates/
  types.ts
  registry.ts
  templates/
    custom.ts
    sbs.ts
    madcow.ts
    btm.ts
  training-templates.test.ts
```

`types.ts` defines the shared contributor-facing contract:

- `ExerciseCategory`: `main`, `aux`, or `accessory`
- `TemplateWeek`: week number, intensity, reps, sets, and AMRAP target
- `TrainingTemplate`: id, name, description, supported categories, default auto-progression flag, weeks by category, and optional progression behavior
- `TrainingMaxContext`: actual reps, target reps, category, current TM

`registry.ts` owns lookup and listing:

- `listTrainingTemplates()`
- `getTrainingTemplate(id)`
- `getTemplateWeeks(templateId, category)`
- `isTrainingTemplateId(id)`

Template files export one template each. The registry imports and exposes the built-ins.

## Template Contract

Each template should look roughly like this:

```ts
export const sbsTemplate = {
  id: "sbs",
  name: "SBS",
  description: "AMRAP-based strength progression.",
  supportedCategories: ["main", "aux"],
  autoProgression: true,
  weeksByCategory: {
    main: [...],
    aux: [...],
  },
  progression: {
    calculateTrainingMaxDelta(context) {
      return ...
    },
  },
};
```

For V1, custom progression remains a built-in template with `autoProgression: false`.

## App Integration

Route handlers should stop importing `src/lib/templates.ts` directly. Exercise creation should read template metadata and weeks from the registry. Workout completion should use the template/progression module rather than hard-coded category adjustment rules in the route handler.

The database can keep the current `progression_type` field for now. It should store the template id. That avoids a migration and keeps existing tests/data simple.

## Contributor Experience

Add documentation to the README or a dedicated `CONTRIBUTING.md` section:

1. Create a file under `src/features/training-templates/templates/`.
2. Export a `TrainingTemplate`.
3. Add it to `registry.ts`.
4. Add tests covering template lookup, weeks, and progression behavior.
5. Run the standard verification commands.

The project should prefer small, reviewable template contributions. New templates should include source notes or assumptions in code comments only when the numbers are not self-evident.

## Testing

Template tests should verify:

- Template ids are unique.
- All templates define at least one default week or intentionally opt into generated fallback weeks.
- Supported categories resolve correctly.
- Unknown template ids fail clearly.
- Progression delta behavior is covered independently from API routes.

Existing API and workout-flow tests should keep passing after the route handlers move to the registry.

## Non-Goals

- No external npm plugin system yet.
- No JSON/YAML authoring layer yet.
- No database migration for template metadata yet.
- No user-created template editor in V1.
