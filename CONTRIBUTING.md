# Contributing

Thanks for helping improve Magni.

## Adding a Training Template

Training templates live in `src/features/training-templates/`. Template-only contributions should stay inside this feature area and should avoid changing route handlers.

To add a template:

1. Create `src/features/training-templates/templates/<template-id>.ts`.
2. Export a `TrainingTemplate` using the current project helper pattern:

   ```ts
   import { defineTrainingTemplate } from "@/features/training-templates/define";
   import type { TrainingTemplate } from "@/features/training-templates/types";

   export const exampleTemplate = defineTrainingTemplate({
     id: "example",
     name: "Example",
     description: "A short summary of the training template.",
     supportedCategories: ["main"],
     autoProgression: true,
     weeksByCategory: {
       main: [],
     },
   } as const satisfies TrainingTemplate);
   ```

3. Register the exported template in `src/features/training-templates/registry.ts`.
4. Add or update tests in `src/features/training-templates/`.
5. Run the required verification commands:

   ```bash
   npm run test:coverage
   npm run typecheck
   npm run lint
   npm run build
   ```

Template ids should be lowercase URL-safe strings, such as `sbs` or `madcow`. Use the template display name for capitalization and spacing shown to users.
