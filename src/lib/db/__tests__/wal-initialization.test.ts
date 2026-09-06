import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { DATABASE_SCHEMA_REVISION } from "../migrations";

type WorkerResult = { journalMode: string; revision: number; synchronous: number; foreignKeys: number; autoCheckpoint: number; changes: number; walWrites: number; lockAcquisitions: number };
type WorkerMessage = { type: "ready" | "step" | "result" | "failure"; step?: string; result?: WorkerResult; code?: string; message?: string };

function worker(dbPath: string, onStep?: (step: string) => void) {
  const child = fork(path.join(process.cwd(), "src/lib/db/__tests__/helpers/initialize-worker.mjs"), [], {
    env: { ...process.env, DB_PATH: dbPath }, execArgv: [], stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  let result: WorkerResult | undefined;
  let failure: WorkerMessage | undefined;
  child.stderr!.on("data", chunk => { stderr += String(chunk); });
  const ready = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("message", (message: WorkerMessage) => {
      if (message.type === "ready") resolve();
      if (message.type === "step") onStep?.(message.step!);
      if (message.type === "result") result = message.result;
      if (message.type === "failure") failure = message;
    });
    child.on("exit", code => { if (code) reject(new Error(`Worker exited before ready: ${stderr}`)); });
  });
  const done = new Promise<{ code: number | null; result?: WorkerResult; failure?: WorkerMessage; stderr: string }>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", code => resolve({ code, result, failure, stderr }));
  });
  return { child, ready, done, start: () => child.send("start") };
}

function freshPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "magni-wal-startup-")), "build.sqlite");
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

describe("multi-process WAL initialization", () => {
  it("waits for another initializer before changing a new database from DELETE to WAL", async () => {
    const dbPath = freshPath();
    const first = new Database(dbPath);
    const lockPath = `${dbPath}.init.lock`;
    const lock = fs.openSync(lockPath, "wx");
    // Hold a real SQLite read lock, as another bootstrap reader can do during
    // a journal transition. The initialization lock owns this entire phase.
    expect(first.pragma("journal_mode", { simple: true })).toBe("delete");
    first.exec("BEGIN");
    first.prepare("SELECT name FROM sqlite_master").all();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      first.exec("ROLLBACK");
      fs.closeSync(lock);
      fs.rmSync(lockPath);
    };
    const steps: string[] = [];
    const second = worker(dbPath, step => {
      steps.push(step);
      // A serialized initializer waits here until the first one finishes.
      // A WAL write outside that lock instead meets the held SQLite read lock.
      if (step === "initialization-lock") release();
    });
    try {
      await second.ready;
      second.start();
      const outcome = await second.done;
      expect(outcome, JSON.stringify(outcome)).toMatchObject({ code: 0, result: { journalMode: "wal", revision: DATABASE_SCHEMA_REVISION, synchronous: 2, foreignKeys: 1, autoCheckpoint: 1000 } });
      expect(steps).toEqual(["initialization-lock"]);
    } finally {
      await stop(second.child);
      release();
      first.close();
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  }, 15_000);

  it("boots nine workers on the same fresh database, then opens a current WAL database without write initialization", async () => {
    const dbPath = freshPath();
    const workers = Array.from({ length: 9 }, () => worker(dbPath));
    try {
      await Promise.all(workers.map(worker => worker.ready));
      workers.forEach(worker => worker.start());
      const outcomes = await Promise.all(workers.map(worker => worker.done));
      for (const outcome of outcomes) expect(outcome, JSON.stringify(outcome)).toMatchObject({ code: 0, result: { journalMode: "wal", revision: DATABASE_SCHEMA_REVISION, synchronous: 2, foreignKeys: 1, autoCheckpoint: 1000 } });
      expect(outcomes.reduce((sum, outcome) => sum + outcome.result!.walWrites, 0)).toBe(1);
      expect(fs.existsSync(`${dbPath}.init.lock`)).toBe(false);

      const writer = new Database(dbPath);
      writer.exec("BEGIN IMMEDIATE");
      const current = worker(dbPath);
      try {
        await current.ready;
        current.start();
        const outcome = await current.done;
        expect(outcome, JSON.stringify(outcome)).toMatchObject({ code: 0, result: { journalMode: "wal", changes: 0, walWrites: 0, lockAcquisitions: 0, synchronous: 2, foreignKeys: 1, autoCheckpoint: 1000 } });
        expect(writer.pragma("quick_check", { simple: true })).toBe("ok");
        expect(writer.pragma("foreign_key_check")).toEqual([]);
      } finally { await stop(current.child); writer.exec("ROLLBACK"); writer.close(); }
    } finally {
      await Promise.all(workers.map(worker => stop(worker.child)));
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  }, 20_000);
});
