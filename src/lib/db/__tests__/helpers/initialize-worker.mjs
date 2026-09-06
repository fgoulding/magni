// Load the actual initialization module in an independent Node/SQLite process.
// TypeScript is already a direct dev dependency; this avoids a build or server.
import fs from "node:fs";
import path from "node:path";
import Module, { createRequire } from "node:module";
import ts from "typescript";
import Database from "better-sqlite3";

const load = createRequire(import.meta.url);
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...options) {
  return resolveFilename.call(this, request.startsWith("@/") ? path.join(process.cwd(), "src", request.slice(2)) : request, parent, ...options);
};
load.extensions[".ts"] = (module, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

let firstStep = false;
let walWrites = 0;
let lockAcquisitions = 0;
function sensitiveStep(step) {
  if (firstStep) return;
  firstStep = true;
  process.send({ type: "step", step });
}
const open = fs.openSync;
fs.openSync = function (filename, flags, ...options) {
  const initLock = String(filename) === `${process.env.DB_PATH}.init.lock` && flags === "wx";
  if (initLock) sensitiveStep("initialization-lock");
  const result = open.call(this, filename, flags, ...options);
  if (initLock) lockAcquisitions += 1;
  return result;
};
const pragma = Database.prototype.pragma;
Database.prototype.pragma = function (source, ...options) {
  if (/^journal_mode\s*=\s*WAL$/i.test(source)) {
    sensitiveStep("wal-transition");
    walWrites += 1;
  }
  return pragma.call(this, source, ...options);
};

process.once("message", () => {
  try {
    const { db } = load(path.join(process.cwd(), "src/lib/db/index.ts"));
    const result = {
      journalMode: db.pragma("journal_mode", { simple: true }),
      revision: db.pragma("user_version", { simple: true }),
      synchronous: db.pragma("synchronous", { simple: true }),
      foreignKeys: db.pragma("foreign_keys", { simple: true }),
      autoCheckpoint: db.pragma("wal_autocheckpoint", { simple: true }),
      changes: db.prepare("SELECT total_changes() AS count").get().count,
      walWrites,
      lockAcquisitions,
    };
    db.close();
    process.send({ type: "result", result }, () => process.disconnect());
  } catch (error) {
    process.exitCode = 1;
    process.send({ type: "failure", code: error.code, message: error.message }, () => process.disconnect());
  }
});
process.send({ type: "ready" });
