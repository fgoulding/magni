import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", ".git/**", ".worktrees/**", "tests/**"],
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/__tests__/**",
        "src/app/layout.tsx",
        "src/app/**/page.tsx",
        "src/components/**",
      ],
      thresholds: {
        statements: 80,
        branches: 65,
        functions: 90,
        lines: 80,
      },
    },
  },
});
