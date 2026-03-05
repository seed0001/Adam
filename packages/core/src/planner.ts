import { z } from "zod";
import {
  type TaskGraph,
  type Task,
  type RequestIntent,
  type AdamError,
  type Result,
  ok,
  err,
  adamError,
  generateId,
  createLogger,
} from "@adam/shared";
import type { ModelRouter } from "@adam/models";

const logger = createLogger("core:planner");

const TaskNodeSchema = z.object({
  id: z.string(),
  description: z.string(),
  dependsOn: z.array(z.string()).default([]),
  modelTier: z.enum(["fast", "capable"]).default("capable"),
  tools: z.array(z.string()).default([]),
});

const PlanSchema = z.object({
  tasks: z.array(TaskNodeSchema),
  reasoning: z.string(),
});

function buildPlannerSystem(availableTools: string[]): string {
  const toolList = availableTools.length > 0
    ? availableTools.sort().join(", ")
    : "none";
  return `You are a task planner for an autonomous AI agent.
Given a goal, decompose it into a directed acyclic graph (DAG) of atomic tasks.

AVAILABLE TOOLS (use ONLY these exact names in the tools array):
${toolList}

Rules:
- Each task must be atomic and independently executable
- Use dependsOn to declare which task IDs must complete before this task starts
- Assign modelTier: "fast" for simple lookups, "capable" for reasoning/generation
- For each task, list ONLY tools from the available list above. Never invent tool names.
- For music/song creation: use create_suno_song (not music-composition-tool or similar)
- Keep the graph minimal — don't over-decompose simple goals
- IDs should be short slugs like "fetch-data", "summarize", "send-reply"

Return JSON only.`;
}

/**
 * Hierarchical Planner — decomposes complex goals into a typed TaskGraph (DAG).
 * This is the core of what makes Adam smarter than OpenClaw's flat heartbeat loop.
 */
export class Planner {
  constructor(
    private router: ModelRouter,
    private availableTools: string[] = [],
  ) {}

  async plan(goal: string, sessionId: string, intent?: RequestIntent): Promise<Result<TaskGraph, AdamError>> {
    logger.info("Planning task graph", { goalLength: goal.length, intent });

    const system = buildPlannerSystem(this.availableTools);

    let prompt = `Goal: ${goal}`;
    if (intent === "brainstorming") {
      prompt += "\n\nIntent: BRAINSTORMING — plan for ideation only. No implementation tasks. Tasks should explore options, not build.";
    } else if (intent === "research") {
      prompt += "\n\nIntent: RESEARCH — plan for information gathering and synthesis. Focus on fetch, summarize, compare.";
    } else if (intent === "skill-development") {
      prompt += "\n\nIntent: SKILL DEVELOPMENT — plan for designing a skill spec. Focus on triggers, inputs, constraints — not execution.";
    }

    const result = await this.router.generateObject({
      sessionId,
      tier: "capable",
      system,
      prompt,
      schema: PlanSchema,
      schemaName: "TaskPlan",
    });

    if (result.isErr()) return err(result.error);

    const { tasks: rawTasks } = result.value;
    const now = new Date();
    const graphId = generateId();

    const validTools = new Set(this.availableTools);
    const tasks: Task[] = rawTasks.map((t) => {
      const requestedTools = t.tools ?? [];
      const toolCalls = requestedTools.filter((name) => validTools.has(name));
      const invalid = requestedTools.filter((name) => !validTools.has(name));
      if (invalid.length > 0) {
        logger.warn("Planner requested invalid tools, filtering out", { invalid, taskId: t.id });
      }
      return {
      id: t.id,
      parentId: null,
      sessionId,
      description: t.description,
      complexity: "simple" as const,
      priority: "normal" as const,
      status: "pending" as const,
      dependsOn: t.dependsOn ?? [],
      input: {},
      output: null,
      error: null,
      toolCalls,
      modelTier: (t.modelTier ?? "capable") as "fast" | "capable" | "embedding",
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      retryCount: 0,
      maxRetries: 2,
    };
    });

    const validationResult = this.validateDAG(tasks);
    if (validationResult.isErr()) return err(validationResult.error);

    const graph: TaskGraph = {
      id: graphId,
      sessionId,
      rootGoal: goal,
      tasks,
      status: "building",
      createdAt: now,
      finishedAt: null,
    };

    logger.info("Task graph built", { taskCount: tasks.length });
    return ok(graph);
  }

  private validateDAG(tasks: Task[]): Result<void, AdamError> {
    const ids = new Set(tasks.map((t) => t.id));

    for (const task of tasks) {
      for (const dep of task.dependsOn) {
        if (!ids.has(dep)) {
          return err(
            adamError(
              "planner:invalid-dag",
              `Task '${task.id}' depends on unknown task '${dep}'`,
            ),
          );
        }
      }
    }

    if (this.hasCycle(tasks)) {
      return err(adamError("planner:cycle-detected", "Task graph contains a cycle"));
    }

    return ok(undefined);
  }

  private hasCycle(tasks: Task[]): boolean {
    const adj = new Map<string, string[]>(tasks.map((t) => [t.id, t.dependsOn]));
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (id: string): boolean => {
      visited.add(id);
      inStack.add(id);
      for (const dep of adj.get(id) ?? []) {
        if (!visited.has(dep) && dfs(dep)) return true;
        if (inStack.has(dep)) return true;
      }
      inStack.delete(id);
      return false;
    };

    for (const task of tasks) {
      if (!visited.has(task.id) && dfs(task.id)) return true;
    }

    return false;
  }
}
