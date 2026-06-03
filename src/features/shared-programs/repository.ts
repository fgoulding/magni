import { parseSharedProgramSnapshot, serializeSharedProgramSnapshot } from "@/features/shared-programs/snapshot";
import type { SharedProgramSnapshot } from "@/features/shared-programs/types";
import { db } from "@/lib/db";

export type SharedProgramRole = "owner" | "admin" | "member";

export type SharedProgram = Readonly<{
  id: number;
  ownerUserId: number;
  name: string;
  description: string;
  activeVersionId: number | null;
  createdAt: string;
}>;

export type SharedProgramForUser = SharedProgram &
  Readonly<{
    role: SharedProgramRole;
  }>;

export type SharedProgramVersion = Readonly<{
  id: number;
  sharedProgramId: number;
  versionNumber: number;
  publishedByUserId: number;
  snapshot: SharedProgramSnapshot;
  createdAt: string;
}>;

type SharedProgramRow = Readonly<{
  id: number;
  owner_user_id: number;
  name: string;
  description: string;
  active_version_id: number | null;
  created_at: string;
}>;

type SharedProgramForUserRow = SharedProgramRow &
  Readonly<{
    role: SharedProgramRole;
  }>;

type SharedProgramVersionRow = Readonly<{
  id: number;
  shared_program_id: number;
  version_number: number;
  published_by_user_id: number;
  snapshot_json: string;
  created_at: string;
}>;

export class SharedProgramPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharedProgramPermissionError";
  }
}

export function createSharedProgram({
  ownerUserId,
  name,
  description,
  snapshot,
}: {
  ownerUserId: number;
  name: string;
  description: string;
  snapshot: SharedProgramSnapshot;
}): SharedProgram {
  const create = db.transaction(() => {
    const snapshotJson = serializeSharedProgramSnapshot(snapshot);
    const sharedProgramId = Number(
      db.prepare("INSERT INTO shared_programs (owner_user_id, name, description) VALUES (?, ?, ?)")
        .run(ownerUserId, name, description).lastInsertRowid,
    );

    db.prepare(
      "INSERT INTO shared_program_members (shared_program_id, user_id, role) VALUES (?, ?, 'owner')",
    ).run(sharedProgramId, ownerUserId);

    const versionId = Number(
      db.prepare(
        `
          INSERT INTO shared_program_versions (
            shared_program_id,
            version_number,
            published_by_user_id,
            snapshot_json
          )
          VALUES (?, 1, ?, ?)
        `,
      ).run(sharedProgramId, ownerUserId, snapshotJson).lastInsertRowid,
    );

    db.prepare("UPDATE shared_programs SET active_version_id = ? WHERE id = ?").run(versionId, sharedProgramId);

    return getSharedProgramById(sharedProgramId);
  });

  return create();
}

export function addSharedProgramMember({
  sharedProgramId,
  actingUserId,
  targetUserId,
  role,
}: {
  sharedProgramId: number;
  actingUserId: number;
  targetUserId: number;
  role: Exclude<SharedProgramRole, "owner">;
}): Readonly<{ sharedProgramId: number; userId: number; role: SharedProgramRole; createdAt: string }> {
  assertAddableSharedProgramRole(role);
  assertSharedProgramOwner(sharedProgramId, actingUserId);

  const existingTargetRole = getSharedProgramRole(sharedProgramId, targetUserId);

  if (existingTargetRole === "owner") {
    throw new SharedProgramPermissionError("Shared program owner role cannot be changed");
  }

  db.prepare(
    `
      INSERT INTO shared_program_members (shared_program_id, user_id, role)
      VALUES (?, ?, ?)
      ON CONFLICT(shared_program_id, user_id) DO UPDATE SET role = excluded.role
    `,
  ).run(sharedProgramId, targetUserId, role);

  const row = db
    .prepare(
      `
        SELECT
          shared_program_id AS sharedProgramId,
          user_id AS userId,
          role,
          created_at AS createdAt
        FROM shared_program_members
        WHERE shared_program_id = ? AND user_id = ?
      `,
    )
    .get(sharedProgramId, targetUserId) as
    | { sharedProgramId: number; userId: number; role: SharedProgramRole; createdAt: string }
    | undefined;

  if (!row) {
    throw new Error("Failed to add shared program member");
  }

  return row;
}

export function getSharedProgramForUser(sharedProgramId: number, userId: number): SharedProgramForUser {
  assertSharedProgramMember(sharedProgramId, userId);

  const row = db
    .prepare(
      `
        SELECT
          sp.id,
          sp.owner_user_id,
          sp.name,
          sp.description,
          sp.active_version_id,
          sp.created_at,
          spm.role
        FROM shared_programs sp
        INNER JOIN shared_program_members spm ON spm.shared_program_id = sp.id
        WHERE sp.id = ? AND spm.user_id = ?
      `,
    )
    .get(sharedProgramId, userId) as SharedProgramForUserRow | undefined;

  if (!row) {
    throw new SharedProgramPermissionError("Shared program access requires shared program membership");
  }

  return {
    ...mapSharedProgramRow(row),
    role: row.role,
  };
}

export function publishSharedProgramVersion({
  sharedProgramId,
  actingUserId,
  snapshot,
}: {
  sharedProgramId: number;
  actingUserId: number;
  snapshot: SharedProgramSnapshot;
}): SharedProgramVersion {
  const publish = db.transaction(() => {
    assertSharedProgramAdmin(sharedProgramId, actingUserId);

    const snapshotJson = serializeSharedProgramSnapshot(snapshot);
    const nextVersion = db
      .prepare(
        "SELECT COALESCE(MAX(version_number), 0) + 1 AS versionNumber FROM shared_program_versions WHERE shared_program_id = ?",
      )
      .get(sharedProgramId) as { versionNumber: number };
    const versionId = Number(
      db.prepare(
        `
          INSERT INTO shared_program_versions (
            shared_program_id,
            version_number,
            published_by_user_id,
            snapshot_json
          )
          VALUES (?, ?, ?, ?)
        `,
      ).run(sharedProgramId, nextVersion.versionNumber, actingUserId, snapshotJson).lastInsertRowid,
    );

    db.prepare("UPDATE shared_programs SET active_version_id = ? WHERE id = ?").run(versionId, sharedProgramId);

    return getSharedProgramVersionById(versionId);
  });

  return publish();
}

export function getLatestSharedProgramVersion(
  sharedProgramId: number,
  userId: number,
): SharedProgramVersion | null {
  assertSharedProgramMember(sharedProgramId, userId);

  const row = db
    .prepare(
      `
        SELECT *
        FROM shared_program_versions
        WHERE shared_program_id = ?
        ORDER BY version_number DESC
        LIMIT 1
      `,
    )
    .get(sharedProgramId) as SharedProgramVersionRow | undefined;

  return row ? mapSharedProgramVersionRow(row) : null;
}

export function assertSharedProgramAdmin(sharedProgramId: number, userId: number): void {
  const role = getSharedProgramRole(sharedProgramId, userId);

  if (role !== "owner" && role !== "admin") {
    throw new SharedProgramPermissionError("Shared program access requires owner or admin access");
  }
}

export function assertSharedProgramMember(sharedProgramId: number, userId: number): void {
  const role = getSharedProgramRole(sharedProgramId, userId);

  if (!role) {
    throw new SharedProgramPermissionError("Shared program access requires shared program membership");
  }
}

function assertSharedProgramOwner(sharedProgramId: number, userId: number): void {
  const role = getSharedProgramRole(sharedProgramId, userId);

  if (role !== "owner") {
    throw new SharedProgramPermissionError("Shared program access requires owner access");
  }
}

function assertAddableSharedProgramRole(role: SharedProgramRole): asserts role is Exclude<SharedProgramRole, "owner"> {
  if (role !== "member" && role !== "admin") {
    throw new SharedProgramPermissionError("Shared program member role must be member or admin");
  }
}

function getSharedProgramById(sharedProgramId: number): SharedProgram {
  const row = db.prepare("SELECT * FROM shared_programs WHERE id = ?").get(sharedProgramId) as
    | SharedProgramRow
    | undefined;

  if (!row) {
    throw new Error(`Shared program not found: ${sharedProgramId}`);
  }

  return mapSharedProgramRow(row);
}

function getSharedProgramVersionById(versionId: number): SharedProgramVersion {
  const row = db.prepare("SELECT * FROM shared_program_versions WHERE id = ?").get(versionId) as
    | SharedProgramVersionRow
    | undefined;

  if (!row) {
    throw new Error(`Shared program version not found: ${versionId}`);
  }

  return mapSharedProgramVersionRow(row);
}

function getSharedProgramRole(sharedProgramId: number, userId: number): SharedProgramRole | undefined {
  const row = db
    .prepare("SELECT role FROM shared_program_members WHERE shared_program_id = ? AND user_id = ?")
    .get(sharedProgramId, userId) as { role: SharedProgramRole } | undefined;

  return row?.role;
}

function mapSharedProgramRow(row: SharedProgramRow): SharedProgram {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    description: row.description,
    activeVersionId: row.active_version_id,
    createdAt: row.created_at,
  };
}

function mapSharedProgramVersionRow(row: SharedProgramVersionRow): SharedProgramVersion {
  return {
    id: row.id,
    sharedProgramId: row.shared_program_id,
    versionNumber: row.version_number,
    publishedByUserId: row.published_by_user_id,
    snapshot: parseSharedProgramSnapshot(row.snapshot_json),
    createdAt: row.created_at,
  };
}
