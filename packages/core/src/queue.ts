import type Database from "better-sqlite3";
import {
  type Task,
  type TaskGraph,
  type TaskStatus,
  type AdamError,
  type Result,
  ok,
  trySync,
  generateId,
  createLogger,
} from "@adam/shared";

const logger = createLogger("core:queue");

/**
 * Persistent task queue backed by SQLite.
 * Survives daemon restarts — in-progress tasks are re-queued on startup.
 */
export class TaskQueue {
  constructor(private db: Database.Database) {
    this.migrate();
    this.recoverInterruptedTasks();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_graphs (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL,
        root_goal   TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'building',
        created_at  TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id          TEXT PRIMARY KEY,
        graph_id    TEXT NOT NULL,
        parent_id   TEXT,
        session_id  TEXT NOT NULL,
        description TEXT NOT NULL,
        complexity  TEXT NOT NULL DEFAULT 'simple',
        priority    TEXT NOT NULL DEFAULT 'normal',
        status      TEXT NOT NULL DEFAULT 'pending',
        depends_on  TEXT NOT NULL DEFAULT '[]',
        input       TEXT NOT NULL DEFAULT '{}',
        output      TEXT,
        error       TEXT,
        tool_calls  TEXT NOT NULL DEFAULT '[]',
        model_tier  TEXT NOT NULL DEFAULT 'capable',
        created_at  TEXT NOT NULL,
        started_at  TEXT,
        finished_at TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 2,
        FOREIGN KEY (graph_id) REFERENCES task_graphs(id)
      );

      CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS tasks_session ON tasks(session_id);
    `);
  }

  private recoverInterruptedTasks(): void {
    const count = this.db
      .prepare(`UPDATE tasks SET status = 'pending', started_at = NULL WHERE status = 'running'`)
      .run().changes;

    if (count > 0) {
      logger.warn(`Recovered ${count} interrupted task(s) from previous run`);
    }
  }

  enqueueGraph(graph: TaskGraph): Result<void, AdamError> {
    return trySync(() => {
      const insertGraph = this.db.prepare(`
        INSERT OR REPLACE INTO task_graphs (id, session_id, root_goal, status, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      const insertTask = this.db.prepare(`
        INSERT OR REPLACE INTO tasks
        (id, graph_id, parent_id, session_id, description, complexity, priority, status,
         depends_on, input, output, error, tool_calls, model_tier, created_at, retry_count, max_retries)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const enqueue = this.db.transaction(() => {
        insertGraph.run(
          graph.id,
          graph.sessionId,
          graph.rootGoal,
          "running",
          graph.createdAt.toISOString(),
        );

        for (const task of graph.tasks) {
          insertTask.run(
            task.id,
            graph.id,
            task.parentId,
            task.sessionId,
            task.description,
            task.complexity,
            task.priority,
            task.status,
            JSON.stringify(task.dependsOn),
            JSON.stringify(task.input),
            null,
            null,
            JSON.stringify(task.toolCalls),
            task.modelTier,
            task.createdAt.toISOString(),
            0,
            task.maxRetries,
          );
        }
      });

      enqueue();
    }, "queue:enqueue-failed");
  }

  getReadyTasks(graphId?: string): Task[] {
    const where = graphId
      ? `t.status = 'pending' AND t.graph_id = '${graphId}'`
      : `t.status = 'pending'`;

    const rows = this.db
      .prepare(
        `SELECT t.* FROM tasks t
         WHERE ${where}
         AND NOT EXISTS (
           SELECT 1 FROM tasks dep
           WHERE dep.id IN (SELECT value FROM json_each(t.depends_on))
           AND dep.status != 'succeeded'
         )
         ORDER BY CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`,
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map(rowToTask);
  }

  markRunning(taskId: string): Result<void, AdamError> {
    return trySync(() => {
      this.db
        .prepare(`UPDATE tasks SET status = 'running', started_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), taskId);
    }, "queue:mark-running-failed");
  }

  markSucceeded(taskId: string, output: Record<string, unknown>): Result<void, AdamError> {
    return trySync(() => {
      this.db
        .prepare(
          `UPDATE tasks SET status = 'succeeded', output = ?, finished_at = ? WHERE id = ?`,
        )
        .run(JSON.stringify(output), new Date().toISOString(), taskId);
    }, "queue:mark-succeeded-failed");
  }

  markFailed(taskId: string, error: string): Result<void, AdamError> {
    return trySync(() => {
      const task = this.db
        .prepare(`SELECT retry_count, max_retries FROM tasks WHERE id = ?`)
        .get(taskId) as { retry_count: number; max_retries: number } | undefined;

      if (task && task.retry_count < task.max_retries) {
        this.db
          .prepare(
            `UPDATE tasks SET status = 'pending', retry_count = retry_count + 1, error = ? WHERE id = ?`,
          )
          .run(error, taskId);
      } else {
        this.db
          .prepare(
            `UPDATE tasks SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`,
          )
          .run(error, new Date().toISOString(), taskId);
      }
    }, "queue:mark-failed-failed");
  }

  isGraphComplete(graphId: string): boolean {
    const pending = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM tasks WHERE graph_id = ? AND status NOT IN ('succeeded', 'cancelled')`,
      )
      .get(graphId) as { count: number };
    return pending.count === 0;
  }
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row["id"] as string,
    parentId: (row["parent_id"] as string | null) ?? null,
    sessionId: row["session_id"] as string,
    description: row["description"] as string,
    complexity: (row["complexity"] as Task["complexity"]) ?? "simple",
    priority: (row["priority"] as Task["priority"]) ?? "normal",
    status: (row["status"] as TaskStatus) ?? "pending",
    dependsOn: JSON.parse((row["depends_on"] as string) || "[]") as string[],
    input: JSON.parse((row["input"] as string) || "{}") as Record<string, unknown>,
    output: row["output"] ? (JSON.parse(row["output"] as string) as Record<string, unknown>) : null,
    error: (row["error"] as string | null) ?? null,
    toolCalls: JSON.parse((row["tool_calls"] as string) || "[]") as string[],
    modelTier: (row["model_tier"] as Task["modelTier"]) ?? "capable",
    createdAt: new Date(row["created_at"] as string),
    startedAt: row["started_at"] ? new Date(row["started_at"] as string) : null,
    finishedAt: row["finished_at"] ? new Date(row["finished_at"] as string) : null,
    retryCount: (row["retry_count"] as number) ?? 0,
    maxRetries: (row["max_retries"] as number) ?? 2,
  };
}
