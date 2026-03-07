import { z } from "zod";
import {
  type TaskComplexity,
  type RequestIntent,
  type AdamError,
  type Result,
  type ModelTier,
  ok,
  err,
  adamError,
  createLogger,
} from "@adam/shared";
import type { ModelRouter } from "@adam/models";

const logger = createLogger("core:classifier");

const ClassificationSchema = z.object({
  complexity: z.enum(["trivial", "simple", "complex", "multi-step"]),
  intent: z.enum(["brainstorming", "build", "research", "skill-development", "general"]),
  reasoning: z.string(),
  suggestedTier: z.enum(["fast", "capable"]),
  requiresPlanning: z.boolean(),
});

const CLASSIFICATION_SYSTEM = `You are a task classifier for an AI agent. Classify BOTH complexity AND intent.

COMPLEXITY (how much planning is needed):
- trivial: single lookup, factual question, simple acknowledgement
- simple: single clear action, no dependencies
- complex: multi-step but linear, requires tool use
- multi-step: requires planning, has dependencies between subtasks, needs a task graph

INTENT (what the user wants from this exchange — adapt your response style):
- brainstorming: user wants to explore ideas, generate options, think out loud. Focus on ideation — do NOT jump to implementation. No code, no tools unless explicitly asked.
- build: user wants to create or implement something. Ready for tools, code, execution.
- research: user wants to learn, gather information, explore. Focus on finding and synthesizing information.
- skill-development: user wants to design or adapt a new capability/skill for the agent. Focus on the skill spec, triggers, constraints — not execution.
- general: conversational, unclear, or mixed. Respond normally.

Return JSON only. Be concise in reasoning (1 sentence).`;

export type ClassificationResult = {
  complexity: TaskComplexity;
  intent: RequestIntent;
  requiresPlanning: boolean;
  tier: ModelTier;
};

/**
 * Intent Classifier — uses a fast/cheap model to decide complexity
 * before spending on a planner call.
 */
export class IntentClassifier {
  constructor(private router: ModelRouter) { }

  async classify(
    input: string,
    sessionId: string,
  ): Promise<Result<ClassificationResult, AdamError>> {
    logger.debug("Classifying intent", { inputLength: input.length });

    const result = await this.router.generateObject({
      sessionId,
      tier: "fast",
      system: CLASSIFICATION_SYSTEM,
      prompt: input,
      schema: ClassificationSchema,
      schemaName: "TaskClassification",
    });

    if (result.isOk()) {
      const { complexity, intent, requiresPlanning, suggestedTier } = result.value;
      logger.debug("Classification result (structured)", { complexity, intent, requiresPlanning });
      return ok({
        complexity,
        intent: intent ?? "general",
        requiresPlanning,
        tier: suggestedTier as ModelTier,
      });
    }

    // Fallback: the model likely doesn't support JSON mode or Tool calling (common for local models)
    logger.warn("Classification failed structured output, attempting text fallback", { error: result.error.message });

    const fallbackResult = await this.router.generate({
      sessionId,
      tier: "fast",
      system: CLASSIFICATION_SYSTEM + "\n\nIMPORTANT: Output ONLY the raw JSON object, no other text or explanation.",
      prompt: input,
    });

    if (fallbackResult.isErr()) return err(fallbackResult.error);

    try {
      const jsonMatch = fallbackResult.value.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON object found in response");

      const parsed = ClassificationSchema.parse(JSON.parse(jsonMatch[0]));
      logger.debug("Classification result (parsed fallback)", { complexity: parsed.complexity, intent: parsed.intent });

      return ok({
        complexity: parsed.complexity,
        intent: (parsed.intent as RequestIntent) ?? "general",
        requiresPlanning: parsed.requiresPlanning,
        tier: (parsed.suggestedTier as ModelTier) ?? "fast",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("Failed to parse classification fallback", { error: msg, raw: fallbackResult.value });
      return err(adamError("core:classifier-failed", `Classification failed: ${msg}`, e));
    }
  }
}
