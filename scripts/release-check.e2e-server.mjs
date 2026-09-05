import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function createE2EServerOptions({ cwd = process.cwd(), env = process.env } = {}) {
  const port = Number(env.E2E_PORT ?? 3108);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("E2E_PORT must be a valid TCP port");
  const output = path.join(cwd, ".playwright");
  const nextEnvPath = path.join(cwd, "next-env.d.ts");
  const originalNextEnv = existsSync(nextEnvPath) ? readFileSync(nextEnvPath, "utf8") : null;
  mkdirSync(output, { recursive: true });
  const directory = mkdtempSync(path.join(output, "e2e-"));
  const tsconfigPath = path.join(directory, "tsconfig.json");
  const distDir = path.join(directory, "next");
  writeFileSync(tsconfigPath, JSON.stringify({
    extends: path.join(cwd, "tsconfig.json"),
    compilerOptions: { baseUrl: cwd },
    include: [path.join(cwd, "next-env.d.ts"), path.join(cwd, "src/**/*.ts"), path.join(cwd, "src/**/*.tsx"), path.join(distDir, "types/**/*.ts"), path.join(distDir, "dev/types/**/*.ts")],
    exclude: [path.join(cwd, "node_modules")],
  }, null, 2));
  return {
    cwd,
    restoreGeneratedTypes() {
      const ownTypesPath = `${path.relative(cwd, distDir).replaceAll("\\", "/")}/dev/types/routes.d.ts`;
      // next-env.d.ts is generated at the project root even with a custom
      // tsconfig. Restore it only if no other build has replaced our reference.
      if (!existsSync(nextEnvPath) || !readFileSync(nextEnvPath, "utf8").includes(ownTypesPath)) return;
      if (originalNextEnv === null) unlinkSync(nextEnvPath);
      else writeFileSync(nextEnvPath, originalNextEnv);
    },
    args: [path.join(cwd, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "localhost", "--port", String(port)],
    env: {
      ...env,
      NODE_ENV: "development",
      DB_PATH: path.join(directory, "e2e.sqlite"),
      REGISTER_ALLOWLIST: "",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_DIST_DIR: path.relative(cwd, distDir),
      NEXT_TSCONFIG_PATH: path.relative(cwd, tsconfigPath),
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = createE2EServerOptions();
  console.log(`Starting disposable E2E server on port ${options.args.at(-1)} with ${options.env.DB_PATH}`);
  const child = spawn(process.execPath, options.args, { cwd: options.cwd, env: options.env, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.once("error", error => { options.restoreGeneratedTypes(); console.error(error); process.exitCode = 1; });
  child.once("exit", (code, signal) => { options.restoreGeneratedTypes(); process.exitCode = code ?? (signal ? 1 : 0); });
}
