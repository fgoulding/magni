import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { backupDatabase, restoreDatabase, verifyDatabase } from "./database-maintenance.mjs";

test("online WAL backup and offline restore preserve committed records and provide rollback", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "magni-recovery-"));
  const source = path.join(dir,"source.db"); const snapshot = path.join(dir,"snapshot.db");
  const database = new Database(source); database.pragma("journal_mode=WAL"); database.exec("CREATE TABLE sets (id INTEGER PRIMARY KEY,reps INTEGER,weight REAL); INSERT INTO sets VALUES (1,10,40)");
  try {
    const receipt = await backupDatabase({databasePath:source,outputPath:snapshot,receiptPath:path.join(dir,"backup-status.json")});
    assert.equal(receipt.sha256.length,64); assert.equal(receipt.bytes>0,true);
    database.exec("INSERT INTO sets VALUES (2,12,42.5)"); database.close();
    const result = await restoreDatabase({sourcePath:snapshot,targetPath:source,offline:true});
    const restored = new Database(source); const rollback = new Database(result.rollbackPath);
    assert.deepEqual(restored.prepare("SELECT * FROM sets").all(),[{id:1,reps:10,weight:40}]);
    assert.equal(rollback.prepare("SELECT COUNT(*) n FROM sets").get().n,2); restored.close(); rollback.close();
    assert.equal(verifyDatabase(source).integrity,"ok");
  } finally { if(database.open) database.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});
test("rejects corruption, checksum mismatch, overwrite and online restoration without touching target", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "magni-recovery-bad-")); const source=path.join(dir,"source.db");const backup=path.join(dir,"backup.db");const target=path.join(dir,"target.db");
  const database=new Database(source); database.exec("CREATE TABLE values_saved(value INTEGER); INSERT INTO values_saved VALUES (400)");database.close();
  fs.copyFileSync(source,target);const initial=fs.readFileSync(target);
  try {
    await backupDatabase({databasePath:source,outputPath:backup});
    await assert.rejects(backupDatabase({databasePath:source,outputPath:backup}),/already exists/);
    await assert.rejects(restoreDatabase({sourcePath:backup,targetPath:target}),/Stop every/);
    fs.writeFileSync(`${backup}.json`,JSON.stringify({sha256:"wrong"}));
    await assert.rejects(restoreDatabase({sourcePath:backup,targetPath:target,offline:true}),/checksum/);
    fs.writeFileSync(backup,"corrupt");
    await assert.rejects(restoreDatabase({sourcePath:backup,targetPath:target,offline:true}));
    assert.deepEqual(fs.readFileSync(target),initial);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
