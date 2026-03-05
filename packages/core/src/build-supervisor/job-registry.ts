import type Database from "better-sqlite3";
import { type AdamError, type Result, trySync, generateId, createLogger } from "@adam/shared";
import type { Job, JobStatus, BuildEvent } from "./types.js";

const logger = createLogger("core:job-registry");

/**
 * Persistent job state for BuildSupervisor.
 * Append-only job_logs; no giant TEXT blobs.
 * See docs/BUILD_SUPERVISOR.md.
 */
export class JobRegistry {
  constructor(private db: Database.Database) {
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id                TEXT PRIMARY KEY,
        branch            TEXT NOT NULL,
        goal              TEXT,
        status            TEXT NOT NULL,
        current_stage     TEXT,
        retries           INTEGER NOT NULL DEFAULT 0,
        last_update       TEXT NOT NULL,
        requires_approval INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL,
        completed_at      TEXT
      );

      CREATE TABLE IF NOT EXISTS job_logs (
        job_id     TEXT NOT NULL,
        seq        INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (job_id, seq),
        FOREIGN KEY (job_id) REFERENCES jobs(id)
      );

      CREATE INDEX IF NOT EXISTS job_logs_job_id ON job_logs(job_id);
    `);
    this.addGoalColumn();
  }

  private addGoalColumn(): void {
    try {
      this.db.exec("ALTER TABLE jobs ADD COLUMN goal TEXT");
    } catch {
      /* column already exists */
    }
  }

  create(branch: string, requiresApproval = true, goal?: string): Result<string, AdamError> {
    return trySync(() => {
      const id = generateId();
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO jobs (id, branch, goal, status, current_stage, retries, last_update, requires_approval, created_at, completed_at)
           VALUES (?, ?, ?, 'pending', NULL, 0, ?, ?, ?, NULL)`,
        )
        .run(id, branch, goal ?? null, now, requiresApproval ? 1 : 0, now);
      logger.info("Job created", { jobId: id, branch });
      return id;
    }, "job-registry:create-failed");
  }

  get(jobId: string): Job | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Record<
      string,
      unknown
    > | null;
    if (!row) return null;
    return this.rowToJob(row);
  }

  getActiveJobForRepo(repoPath: string): Job | null {
    // For now we use branch as a proxy; later we might add repo_path column
    const row = this.db
      .prepare(
        `SELECT * FROM jobs WHERE status IN ('pending', 'running', 'cancelling') ORDER BY created_at DESC LIMIT 1`,
      )
      .get() as Record<string, unknown> | null;
    if (!row) return null;
    return this.rowToJob(row);
  }

  updateStatus(jobId: string, status: JobStatus): Result<void, AdamError> {
    return trySync(() => {
      const now = new Date().toISOString();
      const completedAt = ["completed", "cancelled", "failed"].includes(status) ? now : null;
      this.db
        .prepare(
          `UPDATE jobs SET status = ?, last_update = ?, completed_at = COALESCE(completed_at, ?) WHERE id = ?`,
        )
        .run(status, now, completedAt, jobId);
    }, "job-registry:update-status-failed");
  }

  updateStage(jobId: string, stage: string | null): Result<void, AdamError> {
    return trySync(() => {
      const now = new Date().toISOString();
      this.db.prepare("UPDATE jobs SET current_stage = ?, last_update = ? WHERE id = ?").run(
        stage,
        now,
        jobId,
      );
    }, "job-registry:update-stage-failed");
  }

  incrementRetries(jobId: string): Result<void, AdamError> {
    return trySync(() => {
      const now = new Date().toISOString();
      this.db.prepare("UPDATE jobs SET retries = retries + 1, last_update = ? WHERE id = ?").run(
        now,
        jobId,
      );
    }, "job-registry:increment-retries-failed");
  }

  appendEvent(jobId: string, event: BuildEvent): Result<void, AdamError> {
    return trySync(() => {
      const seq = this.getNextSeq(jobId);
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO job_logs (job_id, seq, event_json, created_at) VALUES (?, ?, ?, ?)`,
        )
        .run(jobId, seq, JSON.stringify(event), now);
    }, "job-registry:append-event-failed");
  }

  getEvents(jobId: string, fromSeq = 0): BuildEvent[] {
    const rows = this.db
      .prepare("SELECT event_json FROM job_logs WHERE job_id = ? AND seq >= ? ORDER BY seq ASC")
      .all(jobId, fromSeq) as Array<{ event_json: string }>;
    return rows.map((r) => JSON.parse(r.event_json) as BuildEvent);
  }

  isCancelling(jobId: string): boolean {
    const row = this.db.prepare("SELECT status FROM jobs WHERE id = ?").get(jobId) as {
      status: string;
    } | null;
    return row?.status === "cancelling";
  }

  requestCancel(jobId: string): Result<void, AdamError> {
    return trySync(() => {
      const now = new Date().toISOString();
      this.db.prepare("UPDATE jobs SET status = 'cancelling', last_update = ? WHERE id = ?").run(
        now,
        jobId,
      );
    }, "job-registry:request-cancel-failed");
  }

  private getNextSeq(jobId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq), -1) + 1 as next FROM job_logs WHERE job_id = ?")
      .get(jobId) as { next: number };
    return row.next;
  }

  private rowToJob(row: Record<string, unknown>): Job {
    return {
      id: row["id"] as string,
      branch: row["branch"] as string,
      goal: (row["goal"] as string | null) ?? null,
      status: row["status"] as JobStatus,
      currentStage: (row["current_stage"] as string | null) ?? null,
      retries: (row["retries"] as number) ?? 0,
      lastUpdate: row["last_update"] as string,
      requiresApproval: (row["requires_approval"] as number) === 1,
      createdAt: row["created_at"] as string,
      completedAt: (row["completed_at"] as string | null) ?? null,
    };
  }
}
