import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { validateTemplate, TemplateValidationError, previewTemplate } from "./contract.mjs";

const safeId = id => typeof id === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(id);
const safeRevision = revision => Number.isInteger(revision) && revision > 0 && revision <= 1000000;
const stableJson = value => JSON.stringify(value, (_key, row) => row && typeof row === "object" && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
export const templateHash = value => createHash("sha256").update(stableJson(value)).digest("hex");
export function readTemplateFile(filename) {
  if (fs.statSync(filename).size > 2000000) throw new Error("Template files must be smaller than 2 MB.");
  const value = JSON.parse(fs.readFileSync(filename, "utf8"));
  const issues = validateTemplate(value); if (issues.length) throw new TemplateValidationError(issues);
  return value;
}
export function bundledTemplates(directory) {
  return fs.readdirSync(directory).filter(name => /^[a-z][a-z0-9-]*\.json$/.test(name)).sort().map(name => readTemplateFile(path.join(directory, name)));
}
function revisionPath(directory, id, revision) {
  if (!safeId(id) || !safeRevision(revision)) throw new Error("Invalid template identifier or revision.");
  return path.join(directory, "revisions", id, `${revision}.json`);
}
function currentTemplate(directory, bundled, id) {
  if (!safeId(id)) throw new Error("Invalid template identifier.");
  const pointerPath = path.join(directory, "current", `${id}.json`);
  if (!fs.existsSync(pointerPath)) return bundled.find(template => template.id === id) ?? null;
  if (fs.statSync(pointerPath).size > 2000) throw new Error("Invalid template publication pointer.");
  const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
  if (!pointer || pointer.id !== id || !safeRevision(pointer.revision) || typeof pointer.sha256 !== "string") throw new Error("Invalid template publication pointer.");
  const template = readTemplateFile(revisionPath(directory, id, pointer.revision));
  if (template.id !== id || template.revision !== pointer.revision || templateHash(template) !== pointer.sha256) throw new Error("Template publication pointer checksum mismatch.");
  return template;
}
/** Read each request so atomic publication needs no application restart. */
export function catalogTemplates({ directory, bundled }) {
  const ids = new Set(bundled.map(template => template.id));
  const currentDirectory = path.join(directory, "current");
  if (fs.existsSync(currentDirectory)) for (const filename of fs.readdirSync(currentDirectory)) {
    if (/^[a-z][a-z0-9-]{0,79}\.json$/.test(filename)) ids.add(filename.slice(0, -5));
  }
  return [...ids].map(id => currentTemplate(directory, bundled, id)).filter(Boolean);
}
function durableWrite(filename, content, flag = "wx") {
  const handle = fs.openSync(filename, flag, 0o600);
  try { fs.writeFileSync(handle, content); fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
}
function syncDirectory(directory) {
  const handle = fs.openSync(directory, "r"); try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
}
function saveImmutable(directory, template) {
  const filename = revisionPath(directory, template.id, template.revision);
  if (fs.existsSync(filename)) {
    if (templateHash(readTemplateFile(filename)) !== templateHash(template)) throw new Error("Template revisions are immutable; use a new revision number.");
    return;
  }
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    durableWrite(temporary, JSON.stringify(template, null, 2) + "\n");
    // A reader can see only the complete immutable revision, even after a crash.
    fs.linkSync(temporary, filename); syncDirectory(path.dirname(filename));
  } finally { fs.rmSync(temporary, { force: true }); }
}
function pointAt(directory, template) {
  const currentDirectory = path.join(directory, "current"); fs.mkdirSync(currentDirectory, { recursive: true });
  const destination = path.join(currentDirectory, `${template.id}.json`); const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    durableWrite(temporary, JSON.stringify({ id: template.id, revision: template.revision, sha256: templateHash(template) }) + "\n");
    fs.renameSync(temporary, destination); syncDirectory(currentDirectory);
  } finally { fs.rmSync(temporary, { force: true }); }
}
function withWriter(directory, operation) {
  fs.mkdirSync(directory, { recursive: true }); const lockPath = path.join(directory, ".write.lock");
  let handle;
  try { handle = fs.openSync(lockPath, "wx", 0o600); }
  catch (error) { if (error.code === "EEXIST") throw new Error("Another catalog writer holds the lock; retry after it finishes."); throw error; }
  try { fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); return operation(); }
  finally { fs.closeSync(handle); fs.rmSync(lockPath, { force: true }); }
}
function requireExpected(current, expectedRevision) {
  if (expectedRevision !== null && !safeRevision(expectedRevision)) throw new Error("Supply the expected current revision, or none for a new template.");
  if ((current?.revision ?? null) !== expectedRevision) throw new Error("Current template revision changed; review the new current revision before retrying.");
}
export function publishTemplate({ directory, bundled, template, expectedRevision, receipt, engineRevision }) {
  const issues = validateTemplate(template); if (issues.length) throw new TemplateValidationError(issues);
  if (!receipt || receipt.schemaVersion !== 1 || receipt.status !== "passed") throw new Error("A successful content rehearsal receipt is required.");
  if (receipt.engineSourceMatches !== true) throw new Error("Content rehearsal must use the exact application engine source.");
  if (receipt.templateSha256 !== templateHash(template)) throw new Error("Content rehearsal checksum does not match the candidate template.");
  if (!engineRevision || engineRevision === "local-unreleased" || receipt.engineRevision !== engineRevision) throw new Error("Content rehearsal engine revision must match the running application.");
  return withWriter(directory, () => {
    const current = currentTemplate(directory, bundled, template.id);
    if (current && templateHash(current) === templateHash(template)) return { id: template.id, revision: template.revision, unchanged: true };
    const existing = revisionPath(directory, template.id, template.revision);
    if (fs.existsSync(existing) && templateHash(readTemplateFile(existing)) !== templateHash(template)) throw new Error("Template revisions are immutable; use a new revision number.");
    requireExpected(current, expectedRevision);
    const previousDirectory = path.dirname(existing);
    const highestStored = fs.existsSync(previousDirectory) ? Math.max(0, ...fs.readdirSync(previousDirectory).filter(file => /^\d+\.json$/.test(file)).map(file => Number(file.slice(0, -5)))) : 0;
    // An interrupted publish may have durably saved this exact revision before
    // swapping its pointer. Recover it only while it remains the newest revision.
    if (template.revision <= (current?.revision ?? 0) || template.revision < highestStored) throw new Error("Publish a new higher revision; use rollback to select a prior revision.");
    if (current) saveImmutable(directory, current);
    saveImmutable(directory, template);
    const receiptPath = existing.replace(/\.json$/, ".receipt.json");
    if (!fs.existsSync(receiptPath)) durableWrite(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
    pointAt(directory, template);
    return { id: template.id, revision: template.revision, previousRevision: current?.revision ?? null, preview: previewTemplate(template) };
  });
}
export function rollbackTemplate({ directory, bundled, id, revision, expectedRevision }) {
  revisionPath(directory, id, revision);
  return withWriter(directory, () => {
    const current = currentTemplate(directory, bundled, id);
    if (current?.revision === revision) return { id, revision, unchanged: true };
    requireExpected(current, expectedRevision);
    const filename = revisionPath(directory, id, revision);
    const template = fs.existsSync(filename) ? readTemplateFile(filename) : bundled.find(item => item.id === id && item.revision === revision);
    if (!template || template.id !== id || template.revision !== revision) throw new Error("That template revision is not available for rollback.");
    saveImmutable(directory, template); pointAt(directory, template);
    return { id, revision, previousRevision: current?.revision ?? null };
  });
}
