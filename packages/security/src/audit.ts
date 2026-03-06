import type Database from "better-sqlite3";
import {
  type AuditEntry,
  type AuditAction,
  type AdamError,
  type Result,
  trySync,
  generateId,
} from "@adam/shared";

export type AuditEntryInput = Omit<AuditEntry, "id" | "timestamp">;

/**
 * Append-only audit log.
 * Every action (tool call, file write, shell command, message send)
 * is written BEFORE execution. Reversible actions store undo metadata.
 */
export class AuditLog {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id          TEXT PRIMARY KEY,
        session_id  TEXT,
        task_id     TEXT,
        skill_id    TEXT,
        action      TEXT NOT NULL,
        target      TEXT NOT NULL,
        params      TEXT NOT NULL DEFAULT '{}',
        outcome     TEXT NOT NULL,
        error_msg   TEXT,
        undo_data   TEXT,
        timestamp   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_log_session ON audit_log(session_id);
      CREATE INDEX IF NOT EXISTS audit_log_timestamp ON audit_log(timestamp);
    `);
  }

  record(entry: AuditEntryInput): Result<string, AdamError> {
    return trySync(() => {
      const id = generateId();
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO audit_log
           (id, session_id, task_id, skill_id, action, target, params, outcome, error_msg, undo_data, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          entry.sessionId ?? null,
          entry.taskId ?? null,
          entry.skillId ?? null,
          entry.action,
          entry.target,
          JSON.stringify(entry.params ?? {}),
          entry.outcome,
          entry.errorMessage ?? null,
          entry.undoData ? JSON.stringify(entry.undoData) : null,
          now,
        );
      return id;
    }, "audit:record-failed");
  }

  query(opts: {
    sessionId?: string;
    action?: AuditAction;
    outcome?: AuditEntry["outcome"];
    since?: Date;
    limit?: number;
  }): AuditEntry[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.sessionId) {
      conditions.push("session_id = ?");
      params.push(opts.sessionId);
    }
    if (opts.action) {
      conditions.push("action = ?");
      params.push(opts.action);
    }
    if (opts.outcome) {
      conditions.push("outcome = ?");
      params.push(opts.outcome);
    }
    if (opts.since) {
      conditions.push("timestamp >= ?");
      params.push(opts.since.toISOString());
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = opts.limit ? `LIMIT ${opts.limit}` : "";

    const rows = this.db
      .prepare(`SELECT * FROM audit_log ${where} ORDER BY timestamp DESC ${limit}`)
      .all(...params) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: r["id"] as string,
      sessionId: (r["session_id"] as string | null) ?? null,
      taskId: (r["task_id"] as string | null) ?? null,
      skillId: (r["skill_id"] as string | null) ?? null,
      action: r["action"] as AuditAction,
      target: r["target"] as string,
      params: JSON.parse((r["params"] as string) || "{}") as Record<string, unknown>,
      outcome: r["outcome"] as AuditEntry["outcome"],
      errorMessage: (r["error_msg"] as string | null) ?? null,
      undoData: r["undo_data"]
        ? (JSON.parse(r["undo_data"] as string) as Record<string, unknown>)
        : null,
      timestamp: new Date(r["timestamp"] as string),
    }));
  }
}
