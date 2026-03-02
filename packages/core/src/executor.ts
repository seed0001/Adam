import { generateText, type CoreTool } from "ai";
import {
  type Task,
  type AdamError,
  type Result,
  ok,
  err,
  adamError,
  createLogger,
} from "@adam/shared";
import type { ModelRouter } from "@adam/models";
import type { TaskQueue } from "./queue.js";

const logger = createLogger("core:executor");

export type ToolRegistry = Map<string, CoreTool>;

/**
 * Executes individual tasks from the queue.
 * Runs leaf tasks in parallel where the DAG permits.
 */
export class Executor {
  constructor(
    private router: ModelRouter,
    private queue: TaskQueue,
    private tools: ToolRegistry,
  ) {}

  async executeTask(task: Task): Promise<Result<Record<string, unknown>, AdamError>> {
    logger.info("Executing task", { taskId: task.id, description: task.description });

    const markResult = this.queue.markRunning(task.id);
    if (markResult.isErr()) return err(markResult.error);

    const availableTools = this.resolveTools(task.toolCalls);

    try {
      const modelResult = this.router.getModel(task.modelTier);
      if (modelResult.isErr()) throw new Error(modelResult.error.message);

      const result = await generateText({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        model: modelResult.value,
        system: `You are an autonomous task executor. Complete the following task and return the result.\nTask: ${task.description}\nInput context: ${JSON.stringify(task.input)}`,
        prompt: task.description,
        tools: Object.fromEntries(availableTools),
        maxSteps: 10,
      });

      const output: Record<string, unknown> = {
        text: result.text,
        toolCallCount: result.toolCalls.length,
        steps: result.steps.length,
      };

      this.queue.markSucceeded(task.id, output);
      logger.info("Task succeeded", { taskId: task.id });
      return ok(output);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.queue.markFailed(task.id, msg);
      logger.error("Task failed", { taskId: task.id, error: msg });
      return err(adamError("executor:task-failed", msg, e));
    }
  }

  async executeReadyTasks(graphId: string): Promise<void> {
    const readyTasks = this.queue.getReadyTasks(graphId);
    if (readyTasks.length === 0) return;

    logger.info(`Executing ${readyTasks.length} ready task(s)`, { graphId });

    await Promise.all(readyTasks.map((task) => this.executeTask(task)));
  }

  private resolveTools(toolNames: string[]): Map<string, CoreTool> {
    const resolved = new Map<string, CoreTool>();
    for (const name of toolNames) {
      const tool = this.tools.get(name);
      if (tool) resolved.set(name, tool);
      else logger.warn(`Tool '${name}' not found in registry`);
    }
    return resolved;
  }
}
