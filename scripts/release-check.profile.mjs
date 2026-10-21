// Local iteration may warm a bounded route list. Release commands and receipts
// must always use the complete profile; neither mode changes test assertions.
export function warmupProfile(env = process.env) {
  const name = env.MAGNI_E2E_WARMUP_PROFILE ?? "full-release";
  if (name === "full-release") {
    if (env.MAGNI_E2E_WARMUP_ROUTES || env.MAGNI_E2E_FOCUSED_OUTPUT) throw new Error("full-release preparation cannot select routes or focused output");
    return { name, routes: null, outputDirectory: ".playwright" };
  }
  if (name !== "local-focused") throw new Error("Unknown E2E warmup profile");
  if (env.CI || env.GITHUB_ACTIONS) throw new Error("CI requires full-release preparation");
  const routes = JSON.parse(env.MAGNI_E2E_WARMUP_ROUTES ?? "null");
  if (!Array.isArray(routes) || routes.length === 0 || new Set(routes).size !== routes.length
    || routes.some(file => typeof file !== "string" || file.startsWith("/") || file.includes("..") || !/^(?:[A-Za-z0-9_()[\]-]+\/)*(?:page\.tsx|route\.ts)$/.test(file))) {
    throw new Error("Focused preparation requires unique relative app route files");
  }
  const outputDirectory = env.MAGNI_E2E_FOCUSED_OUTPUT;
  if (!/^\.playwright\/local-focused-[A-Za-z0-9-]+$/.test(outputDirectory ?? "")) throw new Error("Focused output must use its own .playwright/local-focused-* directory");
  return { name, routes, outputDirectory };
}

export function assertFullReleaseEnvironment(env = process.env) {
  if (warmupProfile(env).name !== "full-release") throw new Error("Release evidence requires full-release preparation");
}
