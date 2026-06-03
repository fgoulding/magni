import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SharedProgramSnapshot } from "@/features/shared-programs/types";

type DbModule = typeof import("@/lib/db");
type RepositoryModule = typeof import("@/features/shared-programs/repository");

let dbModule: DbModule;
let repository: RepositoryModule;

const defaultSnapshot: SharedProgramSnapshot = {
  schemaVersion: 1,
  name: "Shared Strength",
  description: "A synced program snapshot",
  numWeeks: 7,
  days: [
    {
      key: "lower",
      name: "Lower",
      exercises: [
        {
          key: "squat",
          name: "Squat",
          category: "main",
          progressionType: "sbs",
          weeks: [{ weekNumber: 1, intensityPct: 0.7, reps: 5, sets: 3, repOutTarget: 8 }],
        },
      ],
    },
  ],
};

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shared-program-repository-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  dbModule = await import("@/lib/db");
  repository = await import("@/features/shared-programs/repository");
});

beforeEach(() => {
  dbModule.db.exec(`
    DELETE FROM shared_program_applied_versions;
    DELETE FROM shared_program_expected_maxes;
    DELETE FROM shared_program_members;
    DELETE FROM shared_programs;
    DELETE FROM shared_program_versions;
    DELETE FROM users;
  `);
});

afterAll(() => {
  dbModule.db.close();
});

function createUser(email: string): number {
  const result = dbModule.db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run(email, "hash");

  return Number(result.lastInsertRowid);
}

function makeSnapshot(overrides: Partial<SharedProgramSnapshot> = {}): SharedProgramSnapshot {
  return {
    ...defaultSnapshot,
    ...overrides,
  };
}

function getMemberRole(sharedProgramId: number, userId: number): string | undefined {
  return (
    dbModule.db
      .prepare("SELECT role FROM shared_program_members WHERE shared_program_id = ? AND user_id = ?")
      .get(sharedProgramId, userId) as { role: string } | undefined
  )?.role;
}

describe("shared program repository", () => {
  it("allows an owner to create a shared program", () => {
    const ownerUserId = createUser("owner@example.com");

    const sharedProgram = repository.createSharedProgram({
      ownerUserId,
      name: "Owner Program",
      description: "Made by the owner",
      snapshot: makeSnapshot({ name: "Owner Program", description: "Made by the owner" }),
    });

    expect(sharedProgram).toMatchObject({
      ownerUserId,
      name: "Owner Program",
      description: "Made by the owner",
    });
    expect(sharedProgram.activeVersionId).toEqual(expect.any(Number));

    expect(
      dbModule.db
        .prepare("SELECT role FROM shared_program_members WHERE shared_program_id = ? AND user_id = ?")
        .get(sharedProgram.id, ownerUserId),
    ).toEqual({ role: "owner" });
    expect(repository.getLatestSharedProgramVersion(sharedProgram.id, ownerUserId)).toMatchObject({
      id: sharedProgram.activeVersionId,
      versionNumber: 1,
      snapshot: makeSnapshot({ name: "Owner Program", description: "Made by the owner" }),
    });
  });

  it("allows an owner to add member and admin roles", () => {
    const ownerUserId = createUser("owner@example.com");
    const memberUserId = createUser("member@example.com");
    const adminUserId = createUser("admin@example.com");
    const sharedProgram = repository.createSharedProgram({
      ownerUserId,
      name: "Owner Program",
      description: "",
      snapshot: makeSnapshot(),
    });

    repository.addSharedProgramMember({
      sharedProgramId: sharedProgram.id,
      actingUserId: ownerUserId,
      targetUserId: memberUserId,
      role: "member",
    });
    repository.addSharedProgramMember({
      sharedProgramId: sharedProgram.id,
      actingUserId: ownerUserId,
      targetUserId: adminUserId,
      role: "admin",
    });

    const rows = dbModule.db
      .prepare("SELECT user_id AS userId, role FROM shared_program_members WHERE shared_program_id = ? ORDER BY user_id")
      .all(sharedProgram.id);

    expect(rows).toEqual([
      { userId: ownerUserId, role: "owner" },
      { userId: memberUserId, role: "member" },
      { userId: adminUserId, role: "admin" },
    ]);
  });

  it("allows an owner to promote and demote existing admins and members", () => {
    const ownerUserId = createUser("owner@example.com");
    const collaboratorUserId = createUser("collaborator@example.com");
    const sharedProgram = repository.createSharedProgram({
      ownerUserId,
      name: "Owner Program",
      description: "",
      snapshot: makeSnapshot(),
    });

    repository.addSharedProgramMember({
      sharedProgramId: sharedProgram.id,
      actingUserId: ownerUserId,
      targetUserId: collaboratorUserId,
      role: "member",
    });
    repository.addSharedProgramMember({
      sharedProgramId: sharedProgram.id,
      actingUserId: ownerUserId,
      targetUserId: collaboratorUserId,
      role: "admin",
    });
    expect(getMemberRole(sharedProgram.id, collaboratorUserId)).toBe("admin");

    repository.addSharedProgramMember({
      sharedProgramId: sharedProgram.id,
      actingUserId: ownerUserId,
      targetUserId: collaboratorUserId,
      role: "member",
    });

    expect(getMemberRole(sharedProgram.id, collaboratorUserId)).toBe("member");
  });

  it("rejects runtime owner roles when adding members", () => {
    const ownerUserId = createUser("owner@example.com");
    const targetUserId = createUser("target@example.com");
    const sharedProgram = repository.createSharedProgram({
      ownerUserId,
      name: "Owner Program",
      description: "",
      snapshot: makeSnapshot(),
    });

    expect(() =>
      repository.addSharedProgramMember({
        sharedProgramId: sharedProgram.id,
        actingUserId: ownerUserId,
        targetUserId,
        role: "owner",
      } as unknown as Parameters<typeof repository.addSharedProgramMember>[0]),
    ).toThrow("Shared program member role must be member or admin");
    expect(getMemberRole(sharedProgram.id, targetUserId)).toBeUndefined();
  });

  it("keeps owner membership immutable", () => {
    const ownerUserId = createUser("owner@example.com");
    const sharedProgram = repository.createSharedProgram({
      ownerUserId,
      name: "Owner Program",
      description: "",
      snapshot: makeSnapshot(),
    });

    expect(() =>
      repository.addSharedProgramMember({
        sharedProgramId: sharedProgram.id,
        actingUserId: ownerUserId,
        targetUserId: ownerUserId,
        role: "member",
      }),
    ).toThrow("Shared program owner role cannot be changed");
    expect(getMemberRole(sharedProgram.id, ownerUserId)).toBe("owner");
  });

  it("prevents admins from adding or updating members", () => {
    const ownerUserId = createUser("owner@example.com");
    const adminUserId = createUser("admin@example.com");
    const memberUserId = createUser("member@example.com");
    const targetUserId = createUser("target@example.com");
    const sharedProgram = repository.createSharedProgram({
      ownerUserId,
      name: "Owner Program",
      description: "",
      snapshot: makeSnapshot(),
    });
    repository.addSharedProgramMember({
      sharedProgramId: sharedProgram.id,
      actingUserId: ownerUserId,
      targetUserId: adminUserId,
      role: "admin",
    });
    repository.addSharedProgramMember({
      sharedProgramId: sharedProgram.id,
      actingUserId: ownerUserId,
      targetUserId: memberUserId,
      role: "member",
    });

    expect(() =>
      repository.addSharedProgramMember({
        sharedProgramId: sharedProgram.id,
        actingUserId: adminUserId,
        targetUserId,
        role: "member",
      }),
    ).toThrow("requires owner access");
    expect(() =>
      repository.addSharedProgramMember({
        sharedProgramId: sharedProgram.id,
        actingUserId: adminUserId,
        targetUserId: memberUserId,
        role: "admin",
      }),
    ).toThrow("requires owner access");
    expect(getMemberRole(sharedProgram.id, targetUserId)).toBeUndefined();
    expect(getMemberRole(sharedProgram.id, memberUserId)).toBe("member");
  });

  it("prevents members and non-members from managing membership", () => {
    const ownerUserId = createUser("owner@example.com");
    const memberUserId = createUser("member@example.com");
    const strangerUserId = createUser("stranger@example.com");
    const targetUserId = createUser("target@example.com");
    const sharedProgram = repository.createSharedProgram({
      ownerUserId,
      name: "Owner Program",
      description: "",
      snapshot: makeSnapshot(),
    });
    repository.addSharedProgramMember({
      sharedProgramId: sharedProgram.id,
      actingUserId: ownerUserId,
      targetUserId: memberUserId,
      role: "member",
    });

    expect(() =>
      repository.addSharedProgramMember({
        sharedProgramId: sharedProgram.id,
        actingUserId: memberUserId,
        targetUserId,
        role: "member",
      }),
    ).toThrow("requires owner access");
    expect(() =>
      repository.addSharedProgramMember({
        sharedProgramId: sharedProgram.id,
        actingUserId: strangerUserId,
        targetUserId,
        role: "admin",
      }),
    ).toThrow("requires owner access");
    expect(getMemberRole(sharedProgram.id, targetUserId)).toBeUndefined();
  });

  it("allows an admin to publish a version", () => {
    const ownerUserId = createUser("owner@example.com");
    const adminUserId = createUser("admin@example.com");
    const sharedProgram = repository.createSharedProgram({
      ownerUserId,
      name: "Owner Program",
      description: "",
      snapshot: makeSnapshot(),
    });
    repository.addSharedProgramMember({
      sharedProgramId: sharedProgram.id,
      actingUserId: ownerUserId,
      targetUserId: adminUserId,
      role: "admin",
    });

    const version = repository.publishSharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      actingUserId: adminUserId,
      snapshot: makeSnapshot({ name: "Admin Update" }),
    });

    expect(version).toMatchObject({
      sharedProgramId: sharedProgram.id,
      versionNumber: 2,
      publishedByUserId: adminUserId,
      snapshot: makeSnapshot({ name: "Admin Update" }),
    });
  });

  it("prevents a member from publishing a version", () => {
    const ownerUserId = createUser("owner@example.com");
    const memberUserId = createUser("member@example.com");
    const sharedProgram = repository.createSharedProgram({
      ownerUserId,
      name: "Owner Program",
      description: "",
      snapshot: makeSnapshot(),
    });
    repository.addSharedProgramMember({
      sharedProgramId: sharedProgram.id,
      actingUserId: ownerUserId,
      targetUserId: memberUserId,
      role: "member",
    });

    expect(() =>
      repository.publishSharedProgramVersion({
        sharedProgramId: sharedProgram.id,
        actingUserId: memberUserId,
        snapshot: makeSnapshot({ name: "Member Update" }),
      }),
    ).toThrow("requires owner or admin access");
  });

  it("prevents a non-member from publishing a version", () => {
    const ownerUserId = createUser("owner@example.com");
    const strangerUserId = createUser("stranger@example.com");
    const sharedProgram = repository.createSharedProgram({
      ownerUserId,
      name: "Owner Program",
      description: "",
      snapshot: makeSnapshot(),
    });

    expect(() =>
      repository.publishSharedProgramVersion({
        sharedProgramId: sharedProgram.id,
        actingUserId: strangerUserId,
        snapshot: makeSnapshot({ name: "Stranger Update" }),
      }),
    ).toThrow("requires owner or admin access");
  });

  it("prevents a non-member from reading shared program details", () => {
    const ownerUserId = createUser("owner@example.com");
    const strangerUserId = createUser("stranger@example.com");
    const sharedProgram = repository.createSharedProgram({
      ownerUserId,
      name: "Owner Program",
      description: "Private details",
      snapshot: makeSnapshot(),
    });

    expect(() => repository.getSharedProgramForUser(sharedProgram.id, strangerUserId)).toThrow(
      "requires shared program membership",
    );
  });

  it("publishes immutable incrementing versions and updates active_version_id", () => {
    const ownerUserId = createUser("owner@example.com");
    const sharedProgram = repository.createSharedProgram({
      ownerUserId,
      name: "Owner Program",
      description: "",
      snapshot: makeSnapshot(),
    });
    const firstSnapshot = makeSnapshot({ name: "Version 1" });
    const secondSnapshot = makeSnapshot({ name: "Version 2" });

    const firstVersion = repository.publishSharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      actingUserId: ownerUserId,
      snapshot: firstSnapshot,
    });
    const secondVersion = repository.publishSharedProgramVersion({
      sharedProgramId: sharedProgram.id,
      actingUserId: ownerUserId,
      snapshot: secondSnapshot,
    });

    expect(firstVersion.versionNumber).toBe(2);
    expect(secondVersion.versionNumber).toBe(3);
    expect(repository.getLatestSharedProgramVersion(sharedProgram.id, ownerUserId)).toMatchObject({
      id: secondVersion.id,
      versionNumber: 3,
      snapshot: secondSnapshot,
    });
    expect(
      dbModule.db.prepare("SELECT active_version_id AS activeVersionId FROM shared_programs WHERE id = ?").get(sharedProgram.id),
    ).toEqual({ activeVersionId: secondVersion.id });
    expect(
      dbModule.db
        .prepare("SELECT snapshot_json AS snapshotJson FROM shared_program_versions WHERE id = ?")
        .get(firstVersion.id),
    ).toEqual({ snapshotJson: JSON.stringify(firstSnapshot) });
  });
});
