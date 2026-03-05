import { z } from "zod";
import {
  type TaskComplexity,
  type RequestIntent,
  type AdamError,
  type Result,
  type ModelTier,
  ok,
  err,
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
  constructor(private router: ModelRouter) {}

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

    if (result.isErr()) return err(result.error);

    const { complexity, intent, requiresPlanning, suggestedTier } = result.value;
    logger.debug("Classification result", { complexity, intent, requiresPlanning });

    return ok({
      complexity,
      intent: intent ?? "general",
      requiresPlanning,
      tier: suggestedTier as ModelTier,
    });
  }
}
