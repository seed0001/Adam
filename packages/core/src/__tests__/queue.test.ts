import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { TaskQueue } from "../queue.js";
import type { Task, TaskGraph } from "@adam/shared";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeQueue(): TaskQueue {
  return new TaskQueue(new Database(":memory:"));
}

let _taskIdx = 0;
let _graphIdx = 0;

// Stable UUIDs for tests — just increment a counter
function uuid(n: number): string {
  return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const id = uuid(++_taskIdx);
  const sessionId = uuid(++_taskIdx);
  return {
    id,
    parentId: null,
    sessionId,
    description: "Do something",
    complexity: "simple",
    priority: "normal",
    status: "pending",
    dependsOn: [],
    input: {},
    output: null,
    error: null,
    errorContext: null,
    toolCalls: [],
    modelTier: "capable",
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
    retryCount: 0,
    maxRetries: 2,
    ...overrides,
  };
}

function makeGraph(tasks: Task[], overrides: Partial<TaskGraph> = {}): TaskGraph {
  const id = uuid(++_graphIdx * 1000);
  const sessionId = uuid(++_graphIdx * 1000 + 1);
  return {
    id,
    sessionId,
    rootGoal: "test goal",
    tasks,
    status: "running",
    createdAt: new Date(),
    finishedAt: null,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _taskIdx = 0;
  _graphIdx = 0;
});

describe("TaskQueue", () => {
  describe("enqueueGraph", () => {
    it("succeeds and makes tasks immediately retrievable", () => {
      const q = makeQueue();
      const task = makeTask();
      const graph = makeGraph([task]);
      expect(q.enqueueGraph(graph).isOk()).toBe(true);
      expect(q.getReadyTasks()).toHaveLength(1);
    });

    it("does not return tasks whose dependencies have not succeeded yet", () => {
      const q = makeQueue();
      const t1 = makeTask();
      const t2 = makeTask({ id: uuid(999), dependsOn: [t1.id] });
      q.enqueueGraph(makeGraph([t1, t2]));
      // t1 is ready, t2 is blocked
      const ready = q.getReadyTasks();
      expect(ready.map((t) => t.id)).toContain(t1.id);
      expect(ready.map((t) => t.id)).not.toContain(t2.id);
    });

    it("unblocks a dependent task once its dependency succeeds", () => {
      const q = makeQueue();
      const t1 = makeTask();
      const t2 = makeTask({ id: uuid(998), dependsOn: [t1.id] });
      q.enqueueGraph(makeGraph([t1, t2]));

      q.markRunning(t1.id);
      q.markSucceeded(t1.id, { result: "done" });

      const ready = q.getReadyTasks();
      expect(ready.map((t) => t.id)).toContain(t2.id);
    });
  });

  describe("getReadyTasks ordering", () => {
    it("orders by priority: critical < high < normal < low", () => {
      const q = makeQueue();
      const low = makeTask({ priority: "low" });
      const normal = makeTask({ priority: "normal" });
      const high = makeTask({ priority: "high" });
      const critical = makeTask({ priority: "critical" });
      q.enqueueGraph(makeGraph([low, normal, high, critical]));

      const ids = q.getReadyTasks().map((t) => t.priority);
      const expectedOrder = ["critical", "high", "normal", "low"];
      expect(ids).toEqual(expectedOrder);
    });
  });

  describe("markRunning", () => {
    it("sets the task status to running", () => {
      const q = makeQueue();
      const task = makeTask();
      q.enqueueGraph(makeGraph([task]));
      expect(q.markRunning(task.id).isOk()).toBe(true);
      // Running tasks don't appear in getReadyTasks
      expect(q.getReadyTasks().map((t) => t.id)).not.toContain(task.id);
    });
  });

  describe("markFailed / retry logic", () => {
    it("resets status to pending and increments retry_count below maxRetries", () => {
      const q = makeQueue();
      const task = makeTask({ maxRetries: 2 });
      q.enqueueGraph(makeGraph([task]));

      q.markRunning(task.id);
      q.markFailed(task.id, "timeout");

      // Should be back in pending (retry 1 of 2)
      const ready = q.getReadyTasks();
      expect(ready.map((t) => t.id)).toContain(task.id);
    });

    it("marks as permanently failed after exhausting maxRetries", () => {
      const q = makeQueue();
      const task = makeTask({ maxRetries: 1 });
      q.enqueueGraph(makeGraph([task]));

      // Fail twice (maxRetries = 1 → only one retry allowed)
      q.markRunning(task.id);
      q.markFailed(task.id, "error 1");
      q.markRunning(task.id);
      q.markFailed(task.id, "error 2");

      // No longer pending
      expect(q.getReadyTasks().map((t) => t.id)).not.toContain(task.id);
    });
  });

  describe("markSucceeded", () => {
    it("stores output and removes the task from the ready list", () => {
      const q = makeQueue();
      const task = makeTask();
      q.enqueueGraph(makeGraph([task]));
      q.markRunning(task.id);
      q.markSucceeded(task.id, { answer: 42 });
      expect(q.getReadyTasks().map((t) => t.id)).not.toContain(task.id);
    });
  });

  describe("isGraphComplete", () => {
    it("returns false while any task is still pending", () => {
      const q = makeQueue();
      const task = makeTask();
      const graph = makeGraph([task]);
      q.enqueueGraph(graph);
      expect(q.isGraphComplete(graph.id)).toBe(false);
    });

    it("returns true when all tasks have succeeded", () => {
      const q = makeQueue();
      const task = makeTask();
      const graph = makeGraph([task]);
      q.enqueueGraph(graph);
      q.markRunning(task.id);
      q.markSucceeded(task.id, {});
      expect(q.isGraphComplete(graph.id)).toBe(true);
    });

    it("returns true when tasks are a mix of succeeded and cancelled", () => {
      const q = makeQueue();
      const t1 = makeTask();
      const t2 = makeTask();
      const graph = makeGraph([t1, t2]);
      q.enqueueGraph(graph);

      q.markRunning(t1.id);
      q.markSucceeded(t1.id, {});

      // Cancel t2 by direct SQL (no public cancel API exists yet)
      const db = (q as unknown as { db: Database.Database }).db;
      db.prepare("UPDATE tasks SET status = 'cancelled' WHERE id = ?").run(t2.id);

      expect(q.isGraphComplete(graph.id)).toBe(true);
    });

    it("returns false when a task has permanently failed", () => {
      const q = makeQueue();
      const t1 = makeTask({ maxRetries: 0 });
      const t2 = makeTask();
      const graph = makeGraph([t1, t2]);
      q.enqueueGraph(graph);
      q.markRunning(t1.id);
      q.markFailed(t1.id, "fatal");

      expect(q.isGraphComplete(graph.id)).toBe(false);
    });
  });

  describe("recoverInterruptedTasks", () => {
    it("resets running tasks back to pending on a new queue instance over the same DB", () => {
      const db = new Database(":memory:");
      const q1 = new TaskQueue(db);
      const task = makeTask();
      q1.enqueueGraph(makeGraph([task]));
      q1.markRunning(task.id);

      // Simulate daemon restart by constructing a new queue over the same DB
      const q2 = new TaskQueue(db);
      expect(q2.getReadyTasks().map((t) => t.id)).toContain(task.id);
    });
  });
});
