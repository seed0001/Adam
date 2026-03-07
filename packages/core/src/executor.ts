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
import { agentEventBus } from "./agent-events.js";

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
  ) { }

  async executeTask(task: Task): Promise<Result<Record<string, unknown>, AdamError>> {
    logger.info("Executing task", { taskId: task.id, description: task.description });

    agentEventBus.emitEvent({
      sessionId: task.sessionId,
      type: "status",
      message: `Executing task: ${task.description}`,
      data: { taskId: task.id },
      timestamp: new Date(),
    });

    const markResult = this.queue.markRunning(task.id);
    if (markResult.isErr()) return err(markResult.error);

    const resolvedTools = this.resolveTools(task.toolCalls);
    if (resolvedTools.isErr()) {
      this.queue.markFailed(task.id, resolvedTools.error.message);
      return err(resolvedTools.error);
    }
    const availableTools = resolvedTools.value;

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
        onStepFinish: (step) => {
          if (step.text) {
            agentEventBus.emitEvent({
              sessionId: task.sessionId,
              type: "thought",
              message: step.text,
              timestamp: new Date(),
            });
          }
          if (step.toolCalls.length > 0) {
            for (const call of step.toolCalls) {
              agentEventBus.emitEvent({
                sessionId: task.sessionId,
                type: "tool-call",
                message: `Calling tool: ${call.toolName}`,
                data: { taskId: task.id, toolName: call.toolName, args: call.args },
                timestamp: new Date(),
              });
            }
          }
          if (step.toolResults.length > 0) {
            for (const res of step.toolResults as any[]) {
              agentEventBus.emitEvent({
                sessionId: task.sessionId,
                type: "tool-result",
                message: `Tool ${res.toolName} result received.`,
                data: { taskId: task.id, toolName: res.toolName, result: res.result },
                timestamp: new Date(),
              });
            }
          }
        },
      });

      const output: Record<string, unknown> = {
        text: result.text,
        toolCallCount: result.toolCalls.length,
        steps: result.steps.length,
      };

      this.queue.markSucceeded(task.id, output);
      logger.info("Task succeeded", { taskId: task.id });

      agentEventBus.emitEvent({
        sessionId: task.sessionId,
        type: "tool-result",
        message: `Task ${task.id} succeeded.`,
        data: { taskId: task.id, output },
        timestamp: new Date(),
      });

      return ok(output);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const errorContext: Record<string, unknown> = {
        stack: e instanceof Error ? e.stack : undefined,
        type: e instanceof Error ? e.constructor.name : "unknown",
      };
      this.queue.markFailed(task.id, msg, errorContext);
      logger.error("Task failed", { taskId: task.id, error: msg, context: errorContext });
      return err(adamError("executor:task-failed", msg, e));
    }
  }

  async executeReadyTasks(graphId: string): Promise<void> {
    const readyTasks = this.queue.getReadyTasks(graphId);
    if (readyTasks.length === 0) return;

    logger.info(`Executing ${readyTasks.length} ready task(s)`, { graphId });

    await Promise.all(readyTasks.map((task) => this.executeTask(task)));
  }

  private resolveTools(toolNames: string[]): Result<Map<string, CoreTool>, AdamError> {
    const resolved = new Map<string, CoreTool>();
    for (const name of toolNames) {
      const tool = this.tools.get(name);
      if (tool) {
        resolved.set(name, tool);
      } else {
        return err(
          adamError(
            "executor:tool-restricted",
            `Tool '${name}' is restricted or not found in registry`,
          ),
        );
      }
    }
    return ok(resolved);
  }
}
