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
import type { EpisodicStore, ProfileStore } from "@adam/memory";
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
    private profile: ProfileStore | null = null,
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

    // Fire-and-forget: extract user facts in the background without blocking
    void this.extractAndStoreProfileFacts(message.content, responseText, message.sessionId);

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
    // Current session — full recent history
    const currentHistory = this.episodic
      .getBySession(message.sessionId, 20)
      .reverse();

    // Cross-session — recent turns from past sessions (user/assistant only, no tool noise)
    const pastHistory = this.episodic
      .getRecentAcrossSessions(20, 14)
      .filter(
        (e) =>
          e.sessionId !== message.sessionId &&
          (e.role === "user" || e.role === "assistant"),
      )
      .slice(0, 10)
      .reverse();

    let contextBlock = "";

    if (pastHistory.length > 0) {
      const pastLines = pastHistory.map((e) => `${e.role}: ${e.content}`).join("\n");
      contextBlock += `Previous sessions:\n${pastLines}\n\n`;
    }

    if (currentHistory.length > 0) {
      const currentLines = currentHistory.map((e) => `${e.role}: ${e.content}`).join("\n");
      contextBlock += `This session:\n${currentLines}\n\n`;
    }

    const system = this.buildEnrichedSystemPrompt();
    const prompt = contextBlock
      ? `${contextBlock}User: ${message.content}`
      : message.content;

    const toolsObject = Object.fromEntries(this.tools);
    const hasTools = Object.keys(toolsObject).length > 0;

    if (hasTools) {
      return this.router.generateWithTools({
        sessionId: message.sessionId,
        tier,
        system,
        prompt,
        tools: toolsObject,
        maxSteps: 5,
      });
    }

    return this.router.generate({
      sessionId: message.sessionId,
      tier,
      system,
      prompt,
    });
  }

  /**
   * Builds the system prompt, injecting profile facts if available.
   * Called on every turn so new facts are reflected immediately.
   */
  private buildEnrichedSystemPrompt(): string {
    if (!this.profile) return this.config.systemPrompt;

    const facts = this.profile.getAll();
    if (facts.length === 0) return this.config.systemPrompt;

    const factLines = facts
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 40)
      .map((f) => `- ${f.key}: ${f.value}`)
      .join("\n");

    return `${this.config.systemPrompt}\n\nWhat you know about this user:\n${factLines}`;
  }

  /**
   * Runs after every exchange to silently extract user facts and store them
   * in the profile.  Fire-and-forget — never blocks a response.
   */
  private async extractAndStoreProfileFacts(
    userMessage: string,
    _agentResponse: string,
    sessionId: string,
  ): Promise<void> {
    if (!this.profile) return;

    try {
      const result = await this.router.generate({
        sessionId,
        tier: "fast",
        system: `You extract factual information about the user from their messages.
Output ONLY a valid JSON array. Each element: {"key": string, "value": string, "category": "identity"|"preference"|"context"|"goal", "confidence": number (0–1)}.
Only extract clear, specific facts from the user's message. Do not infer or fabricate. Do not extract facts about the assistant. Return [] if nothing factual is present.
Examples of valid extractions: name, job title, city, preferred tools, programming language, OS, goals.`,
        prompt: `User's message: "${userMessage}"\n\nExtract facts about the user.`,
      });

      if (result.isErr()) return;

      const jsonMatch = result.value.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return;

      const raw = JSON.parse(jsonMatch[0]) as unknown;
      if (!Array.isArray(raw)) return;

      for (const item of raw) {
        if (typeof item !== "object" || item === null) continue;
        const r = item as Record<string, unknown>;
        const k = r["key"];
        const v = r["value"];
        const c = r["confidence"];
        const cat = r["category"];
        if (typeof k !== "string" || typeof v !== "string") continue;
        if (typeof c !== "number" || c < 0.75) continue;
        this.profile.set(k, v, {
          category: typeof cat === "string" ? cat : "general",
          confidence: c,
          source: "auto-extracted",
        });
      }
    } catch {
      // best-effort — never throw
    }
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
