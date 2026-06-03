import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedProgramSnapshot } from "@/features/shared-programs/types";

const cookieMock = vi.hoisted(() => {
  const store = new Map<string, string>();

  return {
    store,
    cookies: {
      get: vi.fn((name: string) => {
        const value = store.get(name);
        return value ? { name, value } : undefined;
      }),
      set: vi.fn((name: string, value: string) => {
        store.set(name, value);
      }),
      delete: vi.fn((name: string) => {
        store.delete(name);
      }),
    },
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => cookieMock.cookies,
}));

let dbModule: typeof import("@/lib/db");
let auth: typeof import("@/lib/auth");
let sharedProgramsRoute: typeof import("./route");
let sharedProgramRoute: typeof import("./[id]/route");
let membersRoute: typeof import("./[id]/members/route");
let versionsRoute: typeof import("./[id]/versions/route");
let syncReviewRoute: typeof import("./[id]/sync-review/route");
let syncRoute: typeof import("./[id]/sync/route");
let rollbackRoute: typeof import("./[id]/rollback/route");

type RouteContext = {
  params: Promise<{ id: string }>;
};

function jsonRequest(body: unknown, url = "http://localhost/api"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function crossOriginJsonRequest(body: unknown, url = "http://localhost/api"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
    body: JSON.stringify(body),
  });
}

function params(id: number | string): RouteContext {
  return { params: Promise.resolve({ id: String(id) }) };
}

function createUser(email: string): number {
  const result = dbModule.db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run(email, "hash");

  dbModule.db
    .prepare("INSERT INTO user_settings (user_id, key, value) VALUES (?, 'rounding', '2.5')")
    .run(result.lastInsertRowid);

  return Number(result.lastInsertRowid);
}

function authenticate(userId: number): void {
  const { token } = auth.createSession(userId);
  cookieMock.store.set("auth_token", token);
}

function makeExercise(key: string, name: string): SharedProgramSnapshot["days"][number]["exercises"][number] {
  return {
    key,
    name,
    category: "main",
    progressionType: "sbs",
    weeks: [
      { weekNumber: 1, intensityPct: 0.7, reps: 5, sets: 3, repOutTarget: 8 },
      { weekNumber: 2, intensityPct: 0.75, reps: 4, sets: 4, repOutTarget: 7 },
    ],
  };
}

function makeSnapshot(overrides: Partial<SharedProgramSnapshot> = {}): SharedProgramSnapshot {
  return {
    schemaVersion: 1,
    name: "Shared Strength",
    description: "Synced program",
    numWeeks: 3,
    days: [
      {
        key: "lower",
        name: "Lower",
        exercises: [makeExercise("squat", "Squat")],
      },
    ],
    ...overrides,
  };
}

async function createSharedProgram(ownerUserId: number, snapshot = makeSnapshot()) {
  authenticate(ownerUserId);

  const response = await sharedProgramsRoute.POST!(
    jsonRequest({ name: snapshot.name, description: snapshot.description, snapshot }),
  );

  expect(response.status).toBe(201);

  return (await response.json()) as { id: number; activeVersionId: number };
}

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shared-program-routes-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  dbModule = await import("@/lib/db");
  auth = await import("@/lib/auth");
  sharedProgramsRoute = await import("./route");
  sharedProgramRoute = await import("./[id]/route");
  membersRoute = await import("./[id]/members/route");
  versionsRoute = await import("./[id]/versions/route");
  syncReviewRoute = await import("./[id]/sync-review/route");
  syncRoute = await import("./[id]/sync/route");
  rollbackRoute = await import("./[id]/rollback/route");
});

beforeEach(() => {
  cookieMock.store.clear();
  vi.clearAllMocks();
  dbModule.db.exec(`
    DELETE FROM session_sets;
    DELETE FROM sessions;
    DELETE FROM week_settings;
    DELETE FROM exercises;
    DELETE FROM days;
    DELETE FROM programs;
    DELETE FROM exercise_max_history;
    DELETE FROM shared_program_applied_versions;
    DELETE FROM shared_program_expected_maxes;
    UPDATE shared_programs SET active_version_id = NULL;
    DELETE FROM shared_program_versions;
    DELETE FROM shared_program_members;
    DELETE FROM shared_programs;
    DELETE FROM user_settings;
    DELETE FROM auth_sessions;
    DELETE FROM users;
  `);
});

describe("shared program APIs", () => {
  it("rejects unauthenticated shared-program requests", async () => {
    expect((await sharedProgramsRoute.POST!(jsonRequest({}))).status).toBe(401);
    expect((await sharedProgramRoute.GET!(new Request("http://localhost/api/shared-programs/1"), params(1))).status).toBe(
      401,
    );
    expect((await membersRoute.POST!(jsonRequest({}), params(1))).status).toBe(401);
    expect((await versionsRoute.POST!(jsonRequest({}), params(1))).status).toBe(401);
    expect(
      (
        await syncReviewRoute.GET!(
          new Request("http://localhost/api/shared-programs/1/sync-review?targetVersionId=1"),
          params(1),
        )
      ).status,
    ).toBe(401);
    expect((await syncRoute.POST!(jsonRequest({}), params(1))).status).toBe(401);
    expect((await rollbackRoute.POST!(jsonRequest({}), params(1))).status).toBe(401);
  });

  it("allows an owner to create and read a shared program from a snapshot", async () => {
    const ownerUserId = createUser("shared-owner@example.com");
    const snapshot = makeSnapshot({ name: "Owner Template", description: "Made for the group" });

    const sharedProgram = await createSharedProgram(ownerUserId, snapshot);
    const readResponse = await sharedProgramRoute.GET!(
      new Request(`http://localhost/api/shared-programs/${sharedProgram.id}`),
      params(sharedProgram.id),
    );
    const readBody = await readResponse.json();

    expect(readResponse.status).toBe(200);
    expect(readBody).toMatchObject({
      id: sharedProgram.id,
      ownerUserId,
      name: "Owner Template",
      description: "Made for the group",
      role: "owner",
      activeVersionId: sharedProgram.activeVersionId,
    });
    expect(
      dbModule.db
        .prepare("SELECT version_number, snapshot_json FROM shared_program_versions WHERE id = ?")
        .get(sharedProgram.activeVersionId),
    ).toEqual({ version_number: 1, snapshot_json: JSON.stringify(snapshot) });
  });

  it("rejects malformed shared program ids instead of partially parsing them", async () => {
    const ownerUserId = createUser("malformed-id-owner@example.com");
    const sharedProgram = await createSharedProgram(ownerUserId);

    const response = await sharedProgramRoute.GET!(
      new Request(`http://localhost/api/shared-programs/${sharedProgram.id}abc`),
      params(`${sharedProgram.id}abc`),
    );

    expect(response.status).toBe(404);
  });

  it("rejects cross-origin shared-program mutations", async () => {
    const ownerUserId = createUser("csrf-owner@example.com");
    const sharedProgram = await createSharedProgram(ownerUserId);

    expect(
      (
        await sharedProgramsRoute.POST(
          crossOriginJsonRequest({ name: "CSRF", description: "", snapshot: makeSnapshot() }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await versionsRoute.POST(
          crossOriginJsonRequest({ snapshot: makeSnapshot({ name: "CSRF Version" }) }),
          params(sharedProgram.id),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await syncRoute.POST(
          crossOriginJsonRequest({ targetVersionId: sharedProgram.activeVersionId, expectedMaxes: { squat: 315 } }),
          params(sharedProgram.id),
        )
      ).status,
    ).toBe(403);
  });

  it("allows owners to add members but prevents admins and members from adding members", async () => {
    const ownerUserId = createUser("membership-owner@example.com");
    const adminUserId = createUser("membership-admin@example.com");
    const memberUserId = createUser("membership-member@example.com");
    const targetUserId = createUser("membership-target@example.com");
    const sharedProgram = await createSharedProgram(ownerUserId);

    const adminResponse = await membersRoute.POST!(
      jsonRequest({ userId: adminUserId, role: "admin" }),
      params(sharedProgram.id),
    );
    const memberResponse = await membersRoute.POST!(
      jsonRequest({ userId: memberUserId, role: "member" }),
      params(sharedProgram.id),
    );

    expect(adminResponse.status).toBe(201);
    expect(memberResponse.status).toBe(201);

    cookieMock.store.clear();
    authenticate(adminUserId);
    expect(
      (await membersRoute.POST!(jsonRequest({ userId: targetUserId, role: "member" }), params(sharedProgram.id))).status,
    ).toBe(403);

    cookieMock.store.clear();
    authenticate(memberUserId);
    expect(
      (await membersRoute.POST!(jsonRequest({ userId: targetUserId, role: "admin" }), params(sharedProgram.id))).status,
    ).toBe(403);
    expect(
      dbModule.db
        .prepare("SELECT role FROM shared_program_members WHERE shared_program_id = ? AND user_id = ?")
        .get(sharedProgram.id, targetUserId),
    ).toBeUndefined();
  });

  it("returns a client error when adding a missing user as a member", async () => {
    const ownerUserId = createUser("missing-member-owner@example.com");
    const sharedProgram = await createSharedProgram(ownerUserId);

    const response = await membersRoute.POST!(
      jsonRequest({ userId: 999999, role: "member" }),
      params(sharedProgram.id),
    );

    expect(response.status).toBe(404);
  });

  it("allows owners and admins to publish versions but prevents members from publishing", async () => {
    const ownerUserId = createUser("publish-owner@example.com");
    const adminUserId = createUser("publish-admin@example.com");
    const memberUserId = createUser("publish-member@example.com");
    const sharedProgram = await createSharedProgram(ownerUserId);
    await membersRoute.POST!(jsonRequest({ userId: adminUserId, role: "admin" }), params(sharedProgram.id));
    await membersRoute.POST!(jsonRequest({ userId: memberUserId, role: "member" }), params(sharedProgram.id));

    const ownerVersionResponse = await versionsRoute.POST!(
      jsonRequest({ snapshot: makeSnapshot({ name: "Owner Update" }) }),
      params(sharedProgram.id),
    );
    const ownerVersion = await ownerVersionResponse.json();

    expect(ownerVersionResponse.status).toBe(201);
    expect(ownerVersion).toMatchObject({ versionNumber: 2, publishedByUserId: ownerUserId });

    cookieMock.store.clear();
    authenticate(adminUserId);
    const adminVersionResponse = await versionsRoute.POST!(
      jsonRequest({ snapshot: makeSnapshot({ name: "Admin Update" }) }),
      params(sharedProgram.id),
    );
    const adminVersion = await adminVersionResponse.json();

    expect(adminVersionResponse.status).toBe(201);
    expect(adminVersion).toMatchObject({ versionNumber: 3, publishedByUserId: adminUserId });

    cookieMock.store.clear();
    authenticate(memberUserId);
    expect(
      (
        await versionsRoute.POST!(jsonRequest({ snapshot: makeSnapshot({ name: "Member Update" }) }), params(sharedProgram.id))
      ).status,
    ).toBe(403);
  });

  it("allows a member to review, apply, and rollback shared-program sync", async () => {
    const ownerUserId = createUser("sync-owner@example.com");
    const memberUserId = createUser("sync-member@example.com");
    const sharedProgram = await createSharedProgram(ownerUserId);
    await membersRoute.POST!(jsonRequest({ userId: memberUserId, role: "member" }), params(sharedProgram.id));

    cookieMock.store.clear();
    authenticate(memberUserId);
    const reviewResponse = await syncReviewRoute.GET!(
      new Request(
        `http://localhost/api/shared-programs/${sharedProgram.id}/sync-review?targetVersionId=${sharedProgram.activeVersionId}`,
      ),
      params(sharedProgram.id),
    );
    const review = await reviewResponse.json();

    expect(reviewResponse.status).toBe(200);
    expect(review).toMatchObject({
      currentVersionId: null,
      targetVersionId: sharedProgram.activeVersionId,
      requiredExpectedMaxKeys: ["squat"],
    });

    const applyResponse = await syncRoute.POST!(
      jsonRequest({ targetVersionId: sharedProgram.activeVersionId, expectedMaxes: { squat: 315 } }),
      params(sharedProgram.id),
    );
    const applyResult = await applyResponse.json();

    expect(applyResponse.status).toBe(200);
    expect(applyResult).toMatchObject({ versionId: sharedProgram.activeVersionId, action: "apply" });

    cookieMock.store.clear();
    authenticate(ownerUserId);
    const secondVersion = await (
      await versionsRoute.POST!(
        jsonRequest({
          snapshot: makeSnapshot({
            name: "Second Version",
            days: [
              {
                key: "lower",
                name: "Lower",
                exercises: [makeExercise("squat", "Squat"), makeExercise("bench", "Bench")],
              },
            ],
          }),
        }),
        params(sharedProgram.id),
      )
    ).json();

    cookieMock.store.clear();
    authenticate(memberUserId);
    expect(
      (
        await syncRoute.POST!(
          jsonRequest({ targetVersionId: secondVersion.id, expectedMaxes: { bench: 225 } }),
          params(sharedProgram.id),
        )
      ).status,
    ).toBe(200);

    const rollbackResponse = await rollbackRoute.POST!(
      jsonRequest({ targetVersionId: sharedProgram.activeVersionId, expectedMaxes: {} }),
      params(sharedProgram.id),
    );
    const rollbackResult = await rollbackResponse.json();

    expect(rollbackResponse.status).toBe(200);
    expect(rollbackResult).toMatchObject({ versionId: sharedProgram.activeVersionId, action: "rollback" });
    expect(
      dbModule.db
        .prepare("SELECT action, version_id FROM shared_program_applied_versions WHERE user_id = ? ORDER BY id")
        .all(memberUserId),
    ).toEqual([
      { action: "apply", version_id: sharedProgram.activeVersionId },
      { action: "apply", version_id: secondVersion.id },
      { action: "rollback", version_id: sharedProgram.activeVersionId },
    ]);
  });

  it("prevents non-members from reading or applying shared programs", async () => {
    const ownerUserId = createUser("private-owner@example.com");
    const strangerUserId = createUser("private-stranger@example.com");
    const sharedProgram = await createSharedProgram(ownerUserId);

    cookieMock.store.clear();
    authenticate(strangerUserId);

    expect(
      (await sharedProgramRoute.GET!(new Request(`http://localhost/api/shared-programs/${sharedProgram.id}`), params(sharedProgram.id)))
        .status,
    ).toBe(403);
    expect(
      (
        await syncRoute.POST!(
          jsonRequest({ targetVersionId: sharedProgram.activeVersionId, expectedMaxes: { squat: 315 } }),
          params(sharedProgram.id),
        )
      ).status,
    ).toBe(403);
  });
});
