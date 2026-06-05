import { db } from "@/lib/db";

/**
 * Clear one exercise's superset membership, mirroring the change to the program
 * definition so it sticks across syncs. Shared by the unlink and delete routes —
 * both need to dissolve a lone survivor when a superset drops to one member.
 */
export function clearSupersetMembership(
  memberId: number,
  sharedKey: string | null,
  programDefinitionId: number | null,
): void {
  db.prepare("UPDATE exercises SET superset_group = NULL WHERE id = ?").run(memberId);
  if (programDefinitionId && sharedKey) {
    db.prepare(
      `
        UPDATE program_definition_exercises
        SET superset_group = NULL
        WHERE stable_key = ?
          AND program_definition_day_id IN (
            SELECT id FROM program_definition_days WHERE program_definition_id = ?
          )
      `,
    ).run(sharedKey, programDefinitionId);
  }
}
