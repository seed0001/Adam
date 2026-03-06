import type Database from "better-sqlite3";
import {
  type SkillCapability,
  type PermissionApproval,
  type AdamError,
  type Result,
  ok,
  err,
  adamError,
  trySync,
} from "@adam/shared";

export class PermissionRegistry {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS permission_approvals (
        skill_id   TEXT NOT NULL,
        capability TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        approved_by_user INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (skill_id, capability)
      );
    `);
  }

  approve(skillId: string, capability: SkillCapability): Result<void, AdamError> {
    return trySync(() => {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO permission_approvals
           (skill_id, capability, approved_at, approved_by_user)
           VALUES (?, ?, ?, 1)`,
        )
        .run(skillId, capability, new Date().toISOString());
    }, "permissions:approve-failed");
  }

  revoke(skillId: string, capability: SkillCapability): Result<void, AdamError> {
    return trySync(() => {
      this.db
        .prepare(
          `DELETE FROM permission_approvals WHERE skill_id = ? AND capability = ?`,
        )
        .run(skillId, capability);
    }, "permissions:revoke-failed");
  }

  isApproved(skillId: string, capability: SkillCapability): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM permission_approvals WHERE skill_id = ? AND capability = ?`,
      )
      .get(skillId, capability);
    return row !== undefined;
  }

  getApprovedCapabilities(skillId: string): SkillCapability[] {
    const rows = this.db
      .prepare(`SELECT capability FROM permission_approvals WHERE skill_id = ?`)
      .all(skillId) as Array<{ capability: string }>;
    return rows.map((r) => r.capability as SkillCapability);
  }

  checkAll(
    skillId: string,
    capabilities: SkillCapability[],
  ): Result<void, AdamError> {
    const missing = capabilities.filter((cap) => !this.isApproved(skillId, cap));
    if (missing.length > 0) {
      return err(
        adamError(
          "permissions:not-approved",
          `Skill '${skillId}' requires unapproved capabilities: ${missing.join(", ")}`,
        ),
      );
    }
    return ok(undefined);
  }

  listAll(): PermissionApproval[] {
    const rows = this.db
      .prepare(`SELECT skill_id, capability, approved_at, approved_by_user FROM permission_approvals`)
      .all() as Array<{
        skill_id: string;
        capability: string;
        approved_at: string;
        approved_by_user: number;
      }>;
    return rows.map((r) => ({
      skillId: r.skill_id,
      capability: r.capability,
      approvedAt: new Date(r.approved_at),
      approvedByUser: r.approved_by_user === 1,
    }));
  }
}
