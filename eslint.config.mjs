import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".agents/**",
    ".claude/**",
    ".codex-plugins/**",
    ".git/**",
    ".playwright/**",
    ".playwright-cli/**",
    ".worktrees/**",
    "coverage/**",
    "data/**",
    "docs/**",
    "node_modules/**",
    "playwright-report/**",
    "test-results/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
