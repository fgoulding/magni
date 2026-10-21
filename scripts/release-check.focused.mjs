import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { warmupProfile } from "./release-check.profile.mjs";

export function focusedInvocation(args, env = process.env, id = randomUUID()) {
  const divider = args.indexOf("--");
  const selectors = args.slice(0, divider);
  const browserArgs = args.slice(divider + 1);
  if (divider < 1 || !selectors.every(arg => arg.startsWith("--route=")) || !browserArgs.length) {
    throw new Error("Usage: node scripts/release-check.focused.mjs --route=today/page.tsx [--route=...] -- tests/e2e/example.spec.ts [Playwright selection flags]");
  }
  if (browserArgs.some(arg => /^(?:-c|--config|--reporter|--output)(?:=|$)/.test(arg))) throw new Error("Focused runs must retain their config and isolated diagnostics");
  const nextEnv = {
    ...env,
    MAGNI_E2E_WARMUP_PROFILE: "local-focused",
    MAGNI_E2E_WARMUP_ROUTES: JSON.stringify(selectors.map(arg => arg.slice("--route=".length))),
    MAGNI_E2E_FOCUSED_OUTPUT: `.playwright/local-focused-${id}`,
  };
  // Reporter environment overrides must not overwrite another run's evidence.
  for (const key of Object.keys(nextEnv)) if (/^PLAYWRIGHT_(?:JSON|JUNIT|HTML)_/.test(key)) delete nextEnv[key];
  nextEnv.PLAYWRIGHT_HTML_OPEN = "never";
  const profile = warmupProfile(nextEnv);
  return { args: ["node_modules/playwright/cli.js", "test", ...browserArgs], env: nextEnv, outputDirectory: profile.outputDirectory };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const invocation = focusedInvocation(process.argv.slice(2));
  console.log(`Local focused run; not release evidence. Diagnostics: ${invocation.outputDirectory}`);
  const child = spawn(process.execPath, invocation.args, { env: invocation.env, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("error", error => { console.error(error); process.exitCode = 1; });
  child.on("exit", (code, signal) => { process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1); });
}
