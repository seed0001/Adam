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
import type { PersonalityStore } from "./personality.js";

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
  private readonly startedAt: Date = new Date();

  constructor(
    private router: ModelRouter,
    private queue: TaskQueue,
    private episodic: EpisodicStore,
    private tools: ToolRegistry,
    private config: AgentConfig,
    private profile: ProfileStore | null = null,
    private personality: PersonalityStore | null = null,
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

    // Fire-and-forget: extract user facts and update personality in the background
    void this.extractAndStoreProfileFacts(message.content, responseText, message.sessionId);
    void this.maybeUpdatePersonality(message.content, message.sessionId);

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
   * Builds the system prompt, layering in:
   *   1. Base system prompt (structural + default personality)
   *   2. Personality profile file — evolves through conversation
   *   3. User profile facts — what Adam knows about this specific person
   *
   * Called on every turn so live edits to personality.md are reflected immediately.
   */
  private buildEnrichedSystemPrompt(): string {
    let prompt = this.config.systemPrompt;

    // Layer 2: personality profile
    if (this.personality) {
      const personalityContent = this.personality.load();
      if (personalityContent) {
        prompt += `\n\n---\nPersonality profile (takes precedence over defaults above):\n\n${personalityContent.trim()}\n---`;
      }
    }

    // Layer 3: user profile facts
    // Facts injected here are actively shaping this response — reinforce them.
    // This is the CA's update rule: cells that participate in the pattern get stronger.
    if (this.profile) {
      const facts = this.profile.getAll();
      if (facts.length > 0) {
        const topFacts = facts
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 40);

        for (const f of topFacts) {
          this.profile.reinforce(f.key);
        }

        const factLines = topFacts
          .map((f) => `- ${f.key}: ${f.value} (confidence: ${f.confidence.toFixed(2)})`)
          .join("\n");
        prompt += `\n\nWhat you know about this user:\n${factLines}`;
      }
    }

    // Layer 4: live time context — computed fresh on every turn so it never drifts
    prompt += `\n\n${this.buildTimeContext()}`;

    return prompt;
  }

  /**
   * Returns an accurate time block computed at the moment of the call.
   * Called on every turn so a session open for hours stays correct.
   */
  private buildTimeContext(): string {
    const now = new Date();
    const date = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

    const hour = now.getHours();
    let timeOfDay: string;
    if (hour >= 5 && hour < 12) timeOfDay = "morning";
    else if (hour >= 12 && hour < 17) timeOfDay = "afternoon";
    else if (hour >= 17 && hour < 21) timeOfDay = "evening";
    else timeOfDay = "night";

    const uptimeMs = Date.now() - this.startedAt.getTime();
    const uptimeMinutes = Math.floor(uptimeMs / 60000);
    let sessionSpan: string;
    if (uptimeMinutes < 2) {
      sessionSpan = "session just started";
    } else if (uptimeMinutes < 60) {
      sessionSpan = `session running for ${uptimeMinutes} min`;
    } else {
      const h = Math.floor(uptimeMinutes / 60);
      const m = uptimeMinutes % 60;
      sessionSpan = m > 0
        ? `session running for ${h}h ${m}m`
        : `session running for ${h}h`;
    }

    return `Current time: ${date}, ${time} (${timeOfDay}). ${sessionSpan}.`;
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
        system: `You extract facts about the user from their messages to build a persistent profile.
Output ONLY a valid JSON array. Each element: {"key": string, "value": string, "category": "identity"|"preference"|"context"|"goal", "confidence": number (0.0–1.0)}.
Rules:
- Extract facts the user states about themselves (name, job, location, tools, OS, preferences, goals, habits)
- Also extract facts strongly implied by context (e.g. "my React app" implies they use React)
- Do NOT extract what the user is asking Adam to do — only facts about the user themselves
- Keep keys short and consistent: "name", "job", "os", "editor", "language", "location", "goal_*"
- Return [] if the message contains nothing about the user
Examples: [{"key":"os","value":"Windows","category":"context","confidence":0.9}]`,
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
        if (typeof c !== "number" || c < 0.6) continue;
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

  /**
   * Detects if the user said something that should reshape Adam's personality,
   * and if so, rewrites the personality profile file.
   * Fire-and-forget — never blocks a response.
   */
  private async maybeUpdatePersonality(userMessage: string, sessionId: string): Promise<void> {
    if (!this.personality) return;

    // Only trigger on messages that plausibly contain personality direction
    const triggers = [
      "be more", "be less", "stop being", "don't be", "you should", "i want you to",
      "talk to me", "speak to me", "your personality", "your tone", "your style",
      "more sarcastic", "less formal", "more direct", "be honest", "be blunt",
      "sound like", "act like", "you are", "from now on", "always", "never say",
      "don't say", "i prefer", "i hate when you", "i like when you",
    ];
    const lower = userMessage.toLowerCase();
    const hasTrigger = triggers.some((t) => lower.includes(t));
    if (!hasTrigger) return;

    try {
      const currentProfile = this.personality.loadOrSeed();

      const result = await this.router.generate({
        sessionId,
        tier: "fast",
        system: `You maintain an AI agent's personality profile document.

The profile is a markdown file that defines the agent's character, communication style, and behavior.
When the user expresses how they want the agent to behave, speak, or what traits it should have,
update the profile document to incorporate that preference.

Rules:
- Make surgical, minimal changes — only update what the user asked for
- Keep the same markdown structure and all unchanged sections intact
- Do NOT add things the user didn't ask for
- If the message is ambiguous or does not contain a clear personality preference, return exactly: NO_UPDATE
- Return the full updated profile document if changes are warranted, nothing else`,
        prompt: `Current personality profile:\n\n${currentProfile}\n\n---\nUser's message: "${userMessage}"\n\nShould the personality profile be updated? If yes, return the full updated document. If no, return: NO_UPDATE`,
      });

      if (result.isErr()) return;

      const response = result.value.trim();
      if (response === "NO_UPDATE" || response.startsWith("NO_UPDATE")) return;

      // Only save if the response looks like a personality document
      if (response.includes("#") || response.includes("##") || response.length > 100) {
        this.personality.save(response);
        logger.info("Personality profile updated from conversation");
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
