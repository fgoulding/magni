import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import packageInfo from "../../package.json";

export function getSystemStatus(now = Date.now()) {
  const directory = path.dirname(db.name);
  let databaseReady = false;
  try { db.prepare("SELECT 1").get(); databaseReady = true; } catch { /* Probe reports unavailable. */ }
  let freeBytes: number | null = null;
  let databaseBytes: number | null = null;
  try { const storage = fs.statfsSync(directory); freeBytes = storage.bavail * storage.bsize; databaseBytes = fs.statSync(db.name).size + (fs.existsSync(`${db.name}-wal`) ? fs.statSync(`${db.name}-wal`).size : 0); } catch { /* An unavailable measurement is not zero. */ }
  let backup: { completedAt: string; ageHours: number; stale: boolean; bytes: number } | null = null;
  try {
    const receipt = JSON.parse(fs.readFileSync(path.join(directory,"backup-status.json"),"utf8"));
    const timestamp = Date.parse(receipt.completedAt);
    if (Number.isFinite(timestamp) && /^[a-f0-9]{64}$/.test(receipt.sha256) && receipt.bytes > 0) {
      const ageHours = Math.max(0,(now - timestamp) / 3_600_000);
      backup = { completedAt: receipt.completedAt, ageHours, stale: ageHours > 48, bytes: receipt.bytes };
    }
  } catch { /* No valid backup receipt is reported as unverified. */ }
  return { version: packageInfo.version, revision: process.env.APP_REVISION ?? "local-unreleased", databaseReady, databaseBytes, freeBytes, backup };
}
