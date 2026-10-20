import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import currentTemplate from "../../../program-templates/full-body-supersets-3-day.json";
import { catalogTemplates, publishTemplate, rollbackTemplate, templateHash } from "./storage.mjs";

const directories: string[] = [];
// Catalog versioning has its own fixture, independent of the shipped default.
const bundled = { ...currentTemplate, revision: 1 };
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
const directory = () => { const value = fs.mkdtempSync(path.join(os.tmpdir(), "magni-catalog-")); directories.push(value); return value; };
const revision = (number: number) => ({ ...structuredClone(bundled), revision: number, title: `Revision ${number}` });
const receipt = (value: unknown) => ({ schemaVersion: 1, status: "passed", templateSha256: templateHash(value), engineRevision: "engine-v1", engineSourceMatches: true });

describe("operator-owned runtime template catalog", () => {
  it("publishes only a rehearsed revision and updates reads without application restart", () => {
    const catalogDirectory = directory(); const candidate = revision(2);
    expect(catalogTemplates({ directory: catalogDirectory, bundled: [bundled] })[0].revision).toBe(1);
    expect(() => publishTemplate({ directory: catalogDirectory, bundled: [bundled], template: candidate, expectedRevision: 1, receipt: receipt(candidate), engineRevision: "engine-other" })).toThrow(/engine/i);
    expect(() => publishTemplate({ directory: catalogDirectory, bundled: [bundled], template: candidate, expectedRevision: 1, receipt: receipt(revision(3)), engineRevision: "engine-v1" })).toThrow(/checksum/i);
    publishTemplate({ directory: catalogDirectory, bundled: [bundled], template: candidate, expectedRevision: 1, receipt: receipt(candidate), engineRevision: "engine-v1" });
    expect(catalogTemplates({ directory: catalogDirectory, bundled: [bundled] })[0]).toEqual(candidate);
    expect(publishTemplate({ directory: catalogDirectory, bundled: [bundled], template: candidate, expectedRevision: 1, receipt: receipt(candidate), engineRevision: "engine-v1" })).toMatchObject({ revision: 2, unchanged: true });
  });

  it("preserves immutable history and compares the current revision before publish or rollback", () => {
    const catalogDirectory = directory(); const candidate = revision(2);
    const options = { directory: catalogDirectory, bundled: [bundled], engineRevision: "engine-v1" };
    publishTemplate({ ...options, template: candidate, expectedRevision: 1, receipt: receipt(candidate) });
    const changed = { ...candidate, title: "Overwritten" };
    expect(() => publishTemplate({ ...options, template: changed, expectedRevision: 2, receipt: receipt(changed) })).toThrow(/immutable/i);
    expect(() => publishTemplate({ ...options, template: revision(3), expectedRevision: 1, receipt: receipt(revision(3)) })).toThrow(/changed/i);
    expect(() => rollbackTemplate({ ...options, id: candidate.id, revision: 1, expectedRevision: 1 })).toThrow(/changed/i);
    rollbackTemplate({ ...options, id: candidate.id, revision: 1, expectedRevision: 2 });
    expect(catalogTemplates(options)[0]).toEqual(bundled);
    rollbackTemplate({ ...options, id: candidate.id, revision: 2, expectedRevision: 1 });
    expect(catalogTemplates(options)[0]).toEqual(candidate);
  });

  it("fails closed on malformed publication pointers and refuses unsafe IDs or concurrent writers", () => {
    const catalogDirectory = directory(); const options = { directory: catalogDirectory, bundled: [bundled], engineRevision: "engine-v1" };
    fs.mkdirSync(path.join(catalogDirectory, "current"), { recursive: true });
    fs.writeFileSync(path.join(catalogDirectory, "current", `${bundled.id}.json`), '{"revision":2}');
    expect(() => catalogTemplates(options)).toThrow(/pointer/i);
    fs.rmSync(path.join(catalogDirectory, "current", `${bundled.id}.json`));
    expect(() => rollbackTemplate({ ...options, id: "../escape", revision: 1, expectedRevision: 1 })).toThrow(/identifier/i);
    fs.writeFileSync(path.join(catalogDirectory, ".write.lock"), "locked");
    const candidate = revision(2);
    expect(() => publishTemplate({ ...options, template: candidate, expectedRevision: 1, receipt: receipt(candidate) })).toThrow(/writer/i);
    expect(catalogTemplates(options)[0]).toEqual(bundled);
  });

  it("recovers an identical interrupted publication without overwriting revisions or losing backup rollback", () => {
    const catalogDirectory = directory(); const candidate = revision(2);
    const options = { directory: catalogDirectory, bundled: [bundled], engineRevision: "engine-v1" };
    const storedDirectory = path.join(catalogDirectory, "revisions", candidate.id);
    fs.mkdirSync(storedDirectory, { recursive: true });
    fs.writeFileSync(path.join(storedDirectory, "2.json"), JSON.stringify(candidate));
    expect(catalogTemplates(options)[0]).toEqual(bundled);
    publishTemplate({ ...options, template: candidate, expectedRevision: 1, receipt: receipt(candidate) });
    const backup = directory(); fs.cpSync(catalogDirectory, backup, { recursive: true });
    rollbackTemplate({ ...options, id: candidate.id, revision: 1, expectedRevision: 2 });
    expect(catalogTemplates(options)[0]).toEqual(bundled);
    expect(catalogTemplates({ ...options, directory: backup })[0]).toEqual(candidate);
    rollbackTemplate({ ...options, directory: backup, id: candidate.id, revision: 1, expectedRevision: 2 });
    expect(catalogTemplates({ ...options, directory: backup })[0]).toEqual(bundled);
  });
});
