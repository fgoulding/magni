# Training Template Registry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make training and progression templates modular so open-source contributors can add new templates without editing route handlers.

**Architecture:** Add a `src/features/training-templates/` feature module with a typed registry, one file per built-in template, and contract tests. Keep the current database schema and `progression_type` column, treating it as the template id. Route handlers will consume the registry instead of importing template data or hard-coding progression behavior.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, SQLite via `better-sqlite3`.

---

### Task 1: Add Template Registry Contracts

**Files:**
- Create: `src/features/training-templates/types.ts`
- Create: `src/features/training-templates/registry.ts`
- Create: `src/features/training-templates/templates/custom.ts`
- Create: `src/features/training-templates/templates/sbs.ts`
- Create: `src/features/training-templates/templates/madcow.ts`
- Create: `src/features/training-templates/templates/btm.ts`
- Create: `src/features/training-templates/training-templates.test.ts`
- Modify: `vitest.config.ts`

**Step 1: Write the failing registry tests**

Create `src/features/training-templates/training-templates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  getTemplateWeeks,
  getTrainingTemplate,
  isTrainingTemplateId,
  listTrainingTemplates,
} from "@/features/training-templates/registry";

describe("training template registry", () => {
  it("lists templates with unique ids and contributor-facing metadata", () => {
    const templates = listTrainingTemplates();

    expect(templates.map((template) => template.id)).toEqual(["custom", "sbs", "madcow", "btm"]);
    expect(new Set(templates.map((template) => template.id)).size).toBe(templates.length);
    expect(templates.every((template) => template.name && template.description)).toBe(true);
  });

  it("returns category-specific weeks and falls back to main weeks", () => {
    expect(getTemplateWeeks("sbs", "main")[0]).toMatchObject({
      weekNumber: 1,
      intensityPct: 0.7,
      reps: 5,
      sets: 5,
      repOutTarget: 10,
    });
    expect(getTemplateWeeks("sbs", "aux")[0]).toMatchObject({
      weekNumber: 1,
      intensityPct: 0.6,
      reps: 7,
      sets: 5,
      repOutTarget: 14,
    });
    expect(getTemplateWeeks("madcow", "aux")).toEqual(getTemplateWeeks("madcow", "main"));
  });

  it("identifies valid template ids and rejects unknown ids clearly", () => {
    expect(isTrainingTemplateId("sbs")).toBe(true);
    expect(isTrainingTemplateId("unknown")).toBe(false);
    expect(() => getTrainingTemplate("unknown")).toThrow("Unknown training template: unknown");
  });

  it("keeps custom progression non-automatic with fallback weeks", () => {
    const template = getTrainingTemplate("custom");

    expect(template.autoProgression).toBe(false);
    expect(getTemplateWeeks("custom", "main")).toEqual([]);
  });
});
```

**Step 2: Run the test to verify it fails**

Run:

```bash
npm run test -- src/features/training-templates/training-templates.test.ts
```

Expected: FAIL because the module does not exist.

**Step 3: Implement the template types and files**

Create `src/features/training-templates/types.ts`:

```ts
export type ExerciseCategory = "main" | "aux" | "accessory";

export type TemplateWeek = {
  weekNumber: number;
  intensityPct: number;
  reps: number;
  sets: number;
  repOutTarget: number;
};

export type TrainingMaxContext = {
  actualReps: number;
  repOutTarget: number;
  category: ExerciseCategory;
  currentTrainingMax: number;
};

export type ProgressionRule = {
  calculateTrainingMaxDelta: (context: TrainingMaxContext) => number;
};

export type TrainingTemplate = {
  id: string;
  name: string;
  description: string;
  supportedCategories: ExerciseCategory[];
  autoProgression: boolean;
  weeksByCategory: Partial<Record<ExerciseCategory, TemplateWeek[]>>;
  progression?: ProgressionRule;
};
```

Move the existing data from `src/lib/templates.ts` into one file per template. Use lowercase ids: `custom`, `sbs`, `madcow`, `btm`. Preserve existing week values exactly.

Create `src/features/training-templates/registry.ts`:

```ts
import { btmTemplate } from "@/features/training-templates/templates/btm";
import { customTemplate } from "@/features/training-templates/templates/custom";
import { madcowTemplate } from "@/features/training-templates/templates/madcow";
import { sbsTemplate } from "@/features/training-templates/templates/sbs";
import type { ExerciseCategory, TemplateWeek, TrainingTemplate } from "@/features/training-templates/types";

const TRAINING_TEMPLATES = [customTemplate, sbsTemplate, madcowTemplate, btmTemplate] satisfies TrainingTemplate[];

export function listTrainingTemplates(): TrainingTemplate[] {
  return TRAINING_TEMPLATES;
}

export function isTrainingTemplateId(id: string): boolean {
  return TRAINING_TEMPLATES.some((template) => template.id === id);
}

export function getTrainingTemplate(id: string): TrainingTemplate {
  const template = TRAINING_TEMPLATES.find((item) => item.id === id);
  if (!template) throw new Error(`Unknown training template: ${id}`);
  return template;
}

export function getTemplateWeeks(templateId: string, category: ExerciseCategory): TemplateWeek[] {
  const template = getTrainingTemplate(templateId);
  return template.weeksByCategory[category] ?? template.weeksByCategory.main ?? [];
}
```

**Step 4: Include feature module in coverage**

If `vitest.config.ts` already includes `src/**/*.{ts,tsx}`, no new include is needed. Keep component exclusions as-is.

**Step 5: Run tests**

Run:

```bash
npm run test -- src/features/training-templates/training-templates.test.ts
npm run test:coverage
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/features/training-templates vitest.config.ts
git commit -m "feat: add training template registry"
```

---

### Task 2: Route Exercise Creation Through Registry

**Files:**
- Modify: `src/app/api/days/[dayId]/exercises/route.ts`
- Modify: `src/app/api/programs/program-routes.test.ts`
- Modify: `src/lib/templates.ts`

**Step 1: Write or update failing API expectations**

In `src/app/api/programs/program-routes.test.ts`, update template creation requests to use lowercase ids:

```ts
jsonRequest({ name: "Bench", trainingMax: 200, category: "aux", progressionType: "sbs" })
```

Add one assertion that an old display name still works if backward compatibility is desired:

```ts
expect(
  (
    await exercisesRoute.POST(
      jsonRequest({ name: "Squat", trainingMax: 300, category: "main", progressionType: "SBS" }),
      params({ dayId: String(day.id) }),
    )
  ).status,
).toBe(201);
```

**Step 2: Run affected tests to verify failure**

Run:

```bash
npm run test -- src/app/api/programs/program-routes.test.ts
```

Expected: FAIL if lowercase ids are not yet supported by the route.

**Step 3: Update exercise creation**

In `src/app/api/days/[dayId]/exercises/route.ts`:

- Replace imports from `@/lib/templates` with registry imports.
- Normalize incoming `progressionType` with a helper:

```ts
function normalizeTemplateId(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return "custom";
  return value.trim().toLowerCase();
}
```

- Use `getTrainingTemplate(templateId)` and `getTemplateWeeks(templateId, category)`.
- Store `template.id` in `progression_type`.
- Use `template.autoProgression`.
- Preserve the existing fallback week behavior for templates with no weeks.

**Step 4: Keep compatibility shims temporarily**

Change `src/lib/templates.ts` to re-export from the new registry or delete it only after all imports are removed. Prefer a short compatibility file:

```ts
export {
  getTemplateWeeks,
  getTrainingTemplate as getTemplate,
  listTrainingTemplates,
} from "@/features/training-templates/registry";
export type { TemplateWeek, TrainingTemplate as ProgressionTemplate } from "@/features/training-templates/types";
```

**Step 5: Run tests**

Run:

```bash
npm run test -- src/app/api/programs/program-routes.test.ts src/features/training-templates/training-templates.test.ts
npm run test:coverage
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/app/api/days/[dayId]/exercises/route.ts src/app/api/programs/program-routes.test.ts src/lib/templates.ts
git commit -m "refactor: use training template registry in exercise creation"
```

---

### Task 3: Move Progression Rules Out Of Route Handlers

**Files:**
- Create: `src/features/training-templates/progression.ts`
- Create or modify: `src/features/training-templates/progression.test.ts`
- Modify: `src/app/api/programs/[id]/complete-and-advance/route.ts`
- Modify: `src/app/api/sessions/session-routes.test.ts`

**Step 1: Write failing progression tests**

Create `src/features/training-templates/progression.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { calculateTemplateTrainingMaxDelta } from "@/features/training-templates/progression";

describe("template progression rules", () => {
  it("uses template progression for main lifts", () => {
    expect(
      calculateTemplateTrainingMaxDelta({
        templateId: "sbs",
        actualReps: 12,
        repOutTarget: 10,
        category: "main",
        currentTrainingMax: 300,
      }),
    ).toBe(5);
  });

  it("uses smaller progression changes for aux lifts", () => {
    expect(
      calculateTemplateTrainingMaxDelta({
        templateId: "sbs",
        actualReps: 12,
        repOutTarget: 10,
        category: "aux",
        currentTrainingMax: 200,
      }),
    ).toBe(2.5);
  });

  it("does not change training maxes for custom progression", () => {
    expect(
      calculateTemplateTrainingMaxDelta({
        templateId: "custom",
        actualReps: 20,
        repOutTarget: 10,
        category: "main",
        currentTrainingMax: 300,
      }),
    ).toBe(0);
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
npm run test -- src/features/training-templates/progression.test.ts
```

Expected: FAIL because `progression.ts` does not exist.

**Step 3: Implement progression helper**

Create `src/features/training-templates/progression.ts`:

```ts
import { calculateTmDelta, getAdjustmentPerRep } from "@/lib/calculator";
import { getTrainingTemplate } from "@/features/training-templates/registry";
import type { ExerciseCategory } from "@/features/training-templates/types";

export type TemplateTrainingMaxDeltaInput = {
  templateId: string;
  actualReps: number;
  repOutTarget: number;
  category: ExerciseCategory;
  currentTrainingMax: number;
};

export function calculateTemplateTrainingMaxDelta(input: TemplateTrainingMaxDeltaInput): number {
  const template = getTrainingTemplate(input.templateId);
  if (!template.autoProgression) return 0;

  if (template.progression) {
    return template.progression.calculateTrainingMaxDelta({
      actualReps: input.actualReps,
      repOutTarget: input.repOutTarget,
      category: input.category,
      currentTrainingMax: input.currentTrainingMax,
    });
  }

  return calculateTmDelta(input.actualReps, input.repOutTarget, getAdjustmentPerRep(input.category));
}
```

**Step 4: Update completion route**

In `src/app/api/programs/[id]/complete-and-advance/route.ts`:

- Add `e.progression_type` to the completion query.
- Replace direct `calculateTmDelta(... getAdjustmentPerRep(...))` with `calculateTemplateTrainingMaxDelta`.
- Keep `applyTmDelta` and `calculateWeight` in `@/lib/calculator`.
- Keep the auto-progression enabled database guard for current behavior.

**Step 5: Run affected tests**

Run:

```bash
npm run test -- src/features/training-templates/progression.test.ts src/app/api/sessions/session-routes.test.ts
npm run test:coverage
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/features/training-templates/progression.ts src/features/training-templates/progression.test.ts src/app/api/programs/[id]/complete-and-advance/route.ts src/app/api/sessions/session-routes.test.ts
git commit -m "refactor: move progression rules into template module"
```

---

### Task 4: Add Contributor Documentation

**Files:**
- Create: `CONTRIBUTING.md`
- Modify: `README.md`

**Step 1: Add contributor docs**

Create `CONTRIBUTING.md` with:

```md
# Contributing

## Adding a Training Template

Training templates live in `src/features/training-templates/`.

To add one:

1. Create `src/features/training-templates/templates/<template-id>.ts`.
2. Export a `TrainingTemplate`.
3. Register it in `src/features/training-templates/registry.ts`.
4. Add or update tests in `src/features/training-templates/`.
5. Run `npm run test:coverage`, `npm run typecheck`, `npm run lint`, and `npm run build`.

Template ids should be lowercase, URL-safe strings. Use display names for capitalization.

Avoid changing route handlers for template-only contributions.
```

Update `README.md` with a short `Open Source Extension Points` section linking to `CONTRIBUTING.md`.

**Step 2: Run docs-adjacent checks**

Run:

```bash
npm run lint
```

Expected: PASS.

**Step 3: Commit**

```bash
git add CONTRIBUTING.md README.md
git commit -m "docs: document training template contributions"
```

---

### Task 5: Full Verification

**Files:**
- No source edits expected.

**Step 1: Run full checks**

Run:

```bash
npm run test
npm run test:coverage
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev
```

Expected: all pass. Coverage must remain above configured thresholds.

**Step 2: Browser smoke**

With the dev server running:

```bash
npm run dev -- --port 3000
```

Verify the app loads and the Programs, Today, History, and Settings navigation still works.

**Step 3: Final commit if needed**

If any cleanup edits were required:

```bash
git add <changed-files>
git commit -m "chore: finalize training template registry"
```
