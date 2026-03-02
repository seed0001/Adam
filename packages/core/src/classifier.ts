import { z } from "zod";
import {
  type TaskComplexity,
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
  reasoning: z.string(),
  suggestedTier: z.enum(["fast", "capable"]),
  requiresPlanning: z.boolean(),
});

const CLASSIFICATION_SYSTEM = `You are a task complexity classifier for an AI agent.
Classify the user's request into one of:
- trivial: single lookup, factual question, simple acknowledgement
- simple: single clear action, no dependencies
- complex: multi-step but linear, requires tool use
- multi-step: requires planning, has dependencies between subtasks, needs a task graph

Return JSON only. Be concise in reasoning (1 sentence).`;

export type ClassificationResult = {
  complexity: TaskComplexity;
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

    const { complexity, requiresPlanning, suggestedTier } = result.value;
    logger.debug("Classification result", { complexity, requiresPlanning });

    return ok({ complexity, requiresPlanning, tier: suggestedTier as ModelTier });
  }
}
