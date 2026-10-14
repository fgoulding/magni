/** Local/CI content rehearsal. The production image only needs program-template.mjs. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compileTemplate, previewTemplate } from "../src/features/program-templates/contract.mjs";
import { readTemplateFile, templateHash } from "../src/features/program-templates/storage.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [filename, ...args] = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const git = (...parameters) => execFileSync("git", parameters, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const contentOnly = filename => /^program-templates\/[a-z][a-z0-9-]*\.json$/.test(filename) || filename.startsWith("docs/");
function matchingEngine(revision) {
  const changed = git("diff", "--name-only", revision, "--").split("\n").filter(Boolean);
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean);
  return [...changed, ...untracked].every(contentOnly);
}
try {
  if (!filename || !option("--receipt")) throw new Error("Use program-template-check.mjs TEMPLATE.json --receipt PATH [--engine-revision LIVE_SHA].");
  const candidatePath = path.resolve(filename); const receiptPath = path.resolve(option("--receipt"));
  const template = readTemplateFile(candidatePath); const hash = templateHash(template);
  compileTemplate(template, { startDate: "2026-10-14" });
  const engineRevision = git("rev-parse", "--verify", `${option("--engine-revision") ?? "HEAD"}^{commit}`);
  const sourceBefore = matchingEngine(engineRevision);
  process.stdout.write(JSON.stringify(previewTemplate(template), null, 2) + "\n");
  execFileSync(process.execPath, [path.join(root, "node_modules", "vitest", "vitest.mjs"), "run", "src/features/program-templates/rehearsal.test.ts"], {
    cwd: root, stdio: "inherit", env: { ...process.env, PROGRAM_TEMPLATE_CANDIDATE: candidatePath },
  });
  if (templateHash(readTemplateFile(candidatePath)) !== hash) throw new Error("Template changed during rehearsal; run the check again.");
  const engineSourceMatches = sourceBefore && matchingEngine(engineRevision);
  const result = { schemaVersion: 1, status: "passed", templateId: template.id, templateRevision: template.revision, templateSha256: hash, engineRevision, engineSourceMatches, completedAt: new Date().toISOString(), checks: ["template-schema", "preview", "compile", "save-retry", "activate-retry", "schedule", "start-retry", "log", "complete-retry", "database-integrity"] };
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true }); fs.writeFileSync(receiptPath, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  process.stdout.write(JSON.stringify(result) + "\n");
  if (!engineSourceMatches) process.stderr.write("Rehearsal passed, but application source differs from the specified engine revision. This receipt cannot publish content. Rehearse with the deployed engine checkout.\n");
} catch (error) { process.stderr.write(`Template rehearsal failed: ${error.message}\n`); process.exitCode = 1; }
