import {
  type InboundMessage,
  type OutboundMessage,
  type TaskGraph,
  type AdamError,
  type Result,
  ok,
  err,
  adamError,
  createLogger,
} from "@adam/shared";
import type { ModelRouter } from "@adam/models";
import type { EpisodicStore } from "@adam/memory";
import { IntentClassifier } from "./classifier.js";
import { Planner } from "./planner.js";
import { Executor, type ToolRegistry } from "./executor.js";
import type { TaskQueue } from "./queue.js";

const logger = createLogger("core:agent");

export type AgentConfig = {
  systemPrompt: string;
  name?: string;
};

/**
 * The Agent — the central reasoning loop.
 *
 * Replaces OpenClaw's flat heartbeat with a proper
 * Classify → Plan → Execute → Observe loop.
 */
export class Agent {
  private classifier: IntentClassifier;
  private planner: Planner;
  private executor: Executor;

  constructor(
    private router: ModelRouter,
    private queue: TaskQueue,
    private episodic: EpisodicStore,
    private tools: ToolRegistry,
    private config: AgentConfig,
  ) {
    this.classifier = new IntentClassifier(router);
    this.planner = new Planner(router);
    this.executor = new Executor(router, queue, tools);
  }

  async process(message: InboundMessage): Promise<Result<OutboundMessage, AdamError>> {
    logger.info("Processing message", { source: message.source, sessionId: message.sessionId });

    this.episodic.insert({
      sessionId: message.sessionId,
      role: "user",
      content: message.content,
      source: message.source,
      taskId: undefined,
      importance: 0.6,
    });

    const classifyResult = await this.classifier.classify(message.content, message.sessionId);
    if (classifyResult.isErr()) return err(classifyResult.error);

    const { requiresPlanning, tier } = classifyResult.value;
    const modelTier = tier === "embedding" ? ("capable" as const) : tier;

    let responseText: string;

    if (requiresPlanning) {
      const graphResult = await this.planAndExecute(message);
      if (graphResult.isErr()) return err(graphResult.error);
      responseText = graphResult.value;
    } else {
      const directResult = await this.directResponse(message, modelTier);
      if (directResult.isErr()) return err(directResult.error);
      responseText = directResult.value;
    }

    this.episodic.insert({
      sessionId: message.sessionId,
      role: "assistant",
      content: responseText,
      source: "internal",
      taskId: undefined,
      importance: 0.5,
    });

    const outbound: OutboundMessage = {
      sessionId: message.sessionId,
      channelId: message.channelId,
      source: message.source,
      content: responseText,
      voiceProfileId: null,
      replyToId: message.id,
      metadata: {},
    };

    return ok(outbound);
  }

  private async directResponse(
    message: InboundMessage,
    tier: "fast" | "capable",
  ): Promise<Result<string, AdamError>> {
    const recentHistory = this.episodic.getBySession(message.sessionId, 20);
    const historyText = recentHistory
      .reverse()
      .map((e) => `${e.role}: ${e.content}`)
      .join("\n");

    const toolsObject = Object.fromEntries(this.tools);
    const hasTools = Object.keys(toolsObject).length > 0;

    // Always pass tools so the model can decide autonomously whether to use them.
    // Falls back to plain generate if the tool registry is empty.
    if (hasTools) {
      return this.router.generateWithTools({
        sessionId: message.sessionId,
        tier,
        system: this.config.systemPrompt,
        prompt: historyText
          ? `Conversation so far:\n${historyText}\n\nUser: ${message.content}`
          : message.content,
        tools: toolsObject,
        maxSteps: 5,
      });
    }

    return this.router.generate({
      sessionId: message.sessionId,
      tier,
      system: this.config.systemPrompt,
      prompt: historyText
        ? `Conversation so far:\n${historyText}\n\nUser: ${message.content}`
        : message.content,
    });
  }

  private async planAndExecute(
    message: InboundMessage,
  ): Promise<Result<string, AdamError>> {
    const graphResult = await this.planner.plan(message.content, message.sessionId);
    if (graphResult.isErr()) return err(graphResult.error);

    const graph: TaskGraph = { ...graphResult.value, status: "running" };
    const enqueueResult = this.queue.enqueueGraph(graph);
    if (enqueueResult.isErr()) return err(enqueueResult.error);

    let iterations = 0;
    const maxIterations = 50;

    while (!this.queue.isGraphComplete(graph.id) && iterations < maxIterations) {
      await this.executor.executeReadyTasks(graph.id);
      iterations++;
      await sleep(100);
    }

    if (iterations >= maxIterations) {
      return err(
        adamError("agent:plan-timeout", "Task graph did not complete within iteration limit"),
      );
    }

    return this.router.generate({
      sessionId: message.sessionId,
      tier: "capable",
      system: this.config.systemPrompt,
      prompt: `All planned tasks have been completed. Provide a final summary response to the user's original request: "${message.content}"`,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
