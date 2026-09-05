import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export function verifyDatabase(databasePath) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = database.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error(`Database integrity check failed: ${integrity}`);
    if (database.pragma("foreign_key_check").length) throw new Error("Database has broken foreign key references");
    return { integrity, tables: database.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n };
  } finally { database.close(); }
}
export async function backupDatabase({ databasePath, outputPath, receiptPath }) {
  if (path.resolve(databasePath) === path.resolve(outputPath)) throw new Error("Backup destination must differ from the database");
  if (fs.existsSync(outputPath)) throw new Error("Backup destination already exists; choose a new filename");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${randomUUID()}.tmp`;
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    await database.backup(temporary);
    verifyDatabase(temporary);
    const hash = createHash("sha256").update(fs.readFileSync(temporary)).digest("hex");
    const receipt = { version: 1, completedAt: new Date().toISOString(), sha256: hash, bytes: fs.statSync(temporary).size, applicationRevision: process.env.APP_REVISION ?? "local-unreleased" };
    fs.renameSync(temporary, outputPath);
    fs.writeFileSync(`${outputPath}.json`, JSON.stringify(receipt,null,2) + "\n", { flag: "wx", mode: 0o600 });
    if (receiptPath) {
      const pending = `${receiptPath}.${randomUUID()}.tmp`;
      fs.writeFileSync(pending, JSON.stringify(receipt) + "\n", { mode: 0o600 }); fs.renameSync(pending, receiptPath);
    }
    return receipt;
  } finally { database.close(); fs.rmSync(temporary, { force: true }); }
}
export async function restoreDatabase({ sourcePath, targetPath, offline = false }) {
  if (!offline) throw new Error("Stop every database writer, then explicitly pass --offline");
  if (path.resolve(sourcePath) === path.resolve(targetPath)) throw new Error("Restore source must differ from the database");
  verifyDatabase(sourcePath);
  if (fs.existsSync(`${sourcePath}.json`)) {
    const receipt = JSON.parse(fs.readFileSync(`${sourcePath}.json`, "utf8"));
    const hash = createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
    if (receipt.sha256 !== hash) throw new Error("Backup checksum does not match its receipt");
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporary = `${targetPath}.${randomUUID()}.restore`;
  const rollbackPath = fs.existsSync(targetPath) ? `${targetPath}.before-restore-${randomUUID()}.db` : null;
  try {
    if (rollbackPath) await backupDatabase({ databasePath: targetPath, outputPath: rollbackPath });
    fs.copyFileSync(sourcePath, temporary, fs.constants.COPYFILE_EXCL);
    verifyDatabase(temporary);
    // The caller explicitly stopped all writers. Only now remove the old WAL.
    fs.rmSync(`${targetPath}-wal`, { force: true }); fs.rmSync(`${targetPath}-shm`, { force: true });
    fs.renameSync(temporary, targetPath);
    return { restored: true, rollbackPath, ...verifyDatabase(targetPath) };
  } finally { fs.rmSync(temporary, { force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, ...args] = process.argv.slice(2);
  const value = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  try {
    let result;
    if (operation === "backup") result = await backupDatabase({ databasePath: value("--database"), outputPath: value("--output"), receiptPath: value("--receipt") });
    else if (operation === "restore") result = await restoreDatabase({ sourcePath: value("--source"), targetPath: value("--database"), offline: args.includes("--offline") });
    else if (operation === "verify") result = verifyDatabase(value("--database"));
    else throw new Error("Use backup --database PATH --output PATH [--receipt PATH], verify --database PATH, or restore --source PATH --database PATH --offline");
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) { process.stderr.write(`Database maintenance failed: ${error.message}\n`); process.exitCode = 1; }
}
