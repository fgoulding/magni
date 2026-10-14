import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { previewTemplate, compileTemplate } from "../src/features/program-templates/contract.mjs";
import { bundledTemplates, catalogTemplates, publishTemplate, readTemplateFile, rollbackTemplate, templateHash } from "../src/features/program-templates/storage.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [command, positional, ...rest] = process.argv.slice(2);
const args = positional?.startsWith("--") ? [positional, ...rest] : rest;
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const expectedRevision = () => option("--expect-current") === "none" ? null : Number(option("--expect-current"));
const databasePath = process.env.DB_PATH ?? path.join(root, "data", "workouts.db");
const directory = process.env.PROGRAM_TEMPLATES_DIR ?? path.join(path.dirname(databasePath), "program-templates");
try {
  let result;
  if (command === "validate" || command === "preview") {
    const template = readTemplateFile(positional);
    compileTemplate(template, { startDate: "2026-10-14" });
    result = command === "preview" ? previewTemplate(template) : { valid: true, id: template.id, revision: template.revision, sha256: templateHash(template) };
  } else {
    const bundled = bundledTemplates(path.join(root, "program-templates"));
    if (command === "list") result = catalogTemplates({ directory, bundled }).map(template => ({ id: template.id, revision: template.revision, title: template.title, sha256: templateHash(template) }));
    else if (command === "publish") {
      const receiptPath = option("--receipt");
      if (!receiptPath) throw new Error("Use --receipt PATH from a successful program-template-check rehearsal.");
      result = publishTemplate({ directory, bundled, template: readTemplateFile(positional), expectedRevision: expectedRevision(), receipt: JSON.parse(fs.readFileSync(receiptPath, "utf8")), engineRevision: process.env.APP_REVISION });
    } else if (command === "rollback") result = rollbackTemplate({ directory, bundled, id: positional, revision: Number(option("--revision")), expectedRevision: expectedRevision() });
    else throw new Error("Use validate FILE, preview FILE, list, publish FILE --expect-current REV|none --receipt FILE, or rollback ID --revision REV --expect-current REV.");
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch (error) { process.stderr.write(`Template operation failed: ${error.message}\n`); process.exitCode = 1; }
