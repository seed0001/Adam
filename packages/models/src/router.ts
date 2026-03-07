import { generateText, generateObject, type CoreTool } from "ai";
import type { z } from "zod";
import {
  type ModelTier,
  type ModelUsage,
  type BudgetConfig,
  type AdamError,
  type Result,
  ok,
  err,
  adamError,
  createLogger,
} from "@adam/shared";
import type { ProviderRegistry, ModelPoolConfig } from "./registry.js";

const logger = createLogger("models:router");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLanguageModel = any;

export type GenerateOptions = {
  sessionId: string;
  taskId?: string;
  tier: ModelTier;
  system?: string;
  prompt: string;
  maxTokens?: number;
};

export type GenerateWithToolsOptions = {
  sessionId: string;
  taskId?: string;
  tier: ModelTier;
  system?: string;
  prompt: string;
  tools: Record<string, CoreTool>;
  maxSteps?: number;
  maxTokens?: number;
};

export type GenerateObjectOptions<T> = {
  sessionId: string;
  taskId?: string;
  tier: ModelTier;
  system?: string;
  prompt: string;
  schema: z.ZodType<T>;
  schemaName?: string;
};

/**
 * Cost-aware model router.
 * Tracks spend, enforces budget caps, and falls back to local
 * when cloud budgets are exhausted.
 */
export class ModelRouter {
  private usageLog: ModelUsage[] = [];

  constructor(
    private registry: ProviderRegistry,
    private budget: BudgetConfig,
    private onUsage?: (usage: ModelUsage) => void,
  ) { }

  /**
   * Swaps in a freshly-built registry without restarting the process.
   * Call this after rebuilding the model pool from updated config.
   */
  replaceRegistry(registry: ProviderRegistry): void {
    this.registry = registry;
  }

  /** Returns the underlying pool — use this to report what's actually loaded. */
  getPool(): ModelPoolConfig {
    return this.registry.getPool();
  }

  /** Returns a resolved language model for direct use in tool calling. */
  getModel(tier: ModelTier): Result<AnyLanguageModel, AdamError> {
    const models = this.getModels(tier);
    if (models.length > 0) return ok(models[0]);
    return err(adamError("router:no-model", `No model available for tier '${tier}'`));
  }

  /** Returns all potential models for a tier (used for failover). */
  getModels(tier: ModelTier): AnyLanguageModel[] {
    if (this.isBudgetExhausted() && this.budget.fallbackToLocalOnExhaustion) {
      logger.warn("Budget exhausted, falling back to local model");
      return this.registry.resolveLanguageModels("fast");
    }
    return this.registry.resolveLanguageModels(tier);
  }

  async generate(opts: GenerateOptions): Promise<Result<string, AdamError>> {
    const models = this.getModels(opts.tier);
    if (models.length === 0) return err(adamError("router:no-model", `No model available for tier '${opts.tier}'`));

    let lastError: unknown;
    for (const model of models) {
      try {
        const start = Date.now();
        const callParams: Parameters<typeof generateText>[0] = {
          model,
          prompt: opts.prompt,
        };
        if (opts.system !== undefined) callParams.system = opts.system;
        if (opts.maxTokens !== undefined) callParams.maxTokens = opts.maxTokens;

        logger.info(`Attempting generation with model: ${model.modelId} (${opts.tier})`);
        const result = await generateText(callParams);

        this.recordUsage({
          sessionId: opts.sessionId,
          taskId: opts.taskId ?? null,
          provider: "configured",
          model: model.modelId ?? "configured",
          tier: opts.tier,
          inputTokens: result.usage.promptTokens,
          outputTokens: result.usage.completionTokens,
          estimatedCostUsd: 0,
          durationMs: Date.now() - start,
          timestamp: new Date(),
        });

        return ok(result.text);
      } catch (e) {
        lastError = e;
        logger.warn("Model call failed, falling back to next provider", {
          tier: opts.tier,
          model: model.modelId ?? 'unknown',
          error: e instanceof Error ? e.message : String(e)
        });
      }
    }

    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    return err(adamError("router:generate-failed", `All models in tier '${opts.tier}' failed. Last error: ${msg}`, lastError));
  }

  async generateWithTools(opts: GenerateWithToolsOptions): Promise<Result<string, AdamError>> {
    const models = this.getModels(opts.tier);
    if (models.length === 0) return err(adamError("router:no-model", `No model available for tier '${opts.tier}'`));

    let lastError: unknown;
    for (const model of models) {
      try {
        const start = Date.now();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const params: any = {
          model,
          prompt: opts.prompt,
          tools: opts.tools,
          maxSteps: opts.maxSteps ?? 5,
        };
        if (opts.system !== undefined) params.system = opts.system;
        if (opts.maxTokens !== undefined) params.maxTokens = opts.maxTokens;

        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const result = await generateText(params) as Awaited<ReturnType<typeof generateText>>;

        this.recordUsage({
          sessionId: opts.sessionId,
          taskId: opts.taskId ?? null,
          provider: "configured",
          model: "configured",
          tier: opts.tier,
          inputTokens: result.usage.promptTokens,
          outputTokens: result.usage.completionTokens,
          estimatedCostUsd: 0,
          durationMs: Date.now() - start,
          timestamp: new Date(),
        });

        return ok(result.text);
      } catch (e) {
        lastError = e;
        logger.warn("Model call (with tools) failed, falling back to next provider", {
          tier: opts.tier,
          error: e instanceof Error ? e.message : String(e)
        });
      }
    }

    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    return err(adamError("router:generate-failed", `All models in tier '${opts.tier}' failed. Last error: ${msg}`, lastError));
  }

  async generateObject<T>(opts: GenerateObjectOptions<T>): Promise<Result<T, AdamError>> {
    const models = this.getModels(opts.tier);
    if (models.length === 0) return err(adamError("router:no-model", `No model available for tier '${opts.tier}'`));

    let lastError: unknown;
    for (const model of models) {
      try {
        const start = Date.now();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const goParams: any = {
          model,
          prompt: opts.prompt,
          schema: opts.schema,
        };
        if (opts.system !== undefined) goParams.system = opts.system;
        if (opts.schemaName !== undefined) goParams.schemaName = opts.schemaName;

        logger.info(`Attempting structured generation with model: ${model.modelId} (${opts.tier})`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
        const result = await (generateObject as any)(goParams) as Awaited<ReturnType<typeof generateObject>>;

        this.recordUsage({
          sessionId: opts.sessionId,
          taskId: opts.taskId ?? null,
          provider: "configured",
          model: model.modelId ?? "configured",
          tier: opts.tier,
          inputTokens: result.usage.promptTokens,
          outputTokens: result.usage.completionTokens,
          estimatedCostUsd: 0,
          durationMs: Date.now() - start,
          timestamp: new Date(),
        });

        return ok(result.object as T);
      } catch (e) {
        lastError = e;
        logger.warn("Model call (object) failed, falling back to next provider", {
          tier: opts.tier,
          model: model.modelId ?? 'unknown',
          error: e instanceof Error ? e.message : String(e)
        });
      }
    }

    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    return err(adamError("router:generate-object-failed", `All models in tier '${opts.tier}' failed. Last error: ${msg}`, lastError));
  }

  getDailySpend(): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.usageLog
      .filter((u) => u.timestamp >= today)
      .reduce((sum, u) => sum + u.estimatedCostUsd, 0);
  }

  getMonthlySpend(): number {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return this.usageLog
      .filter((u) => u.timestamp >= monthStart)
      .reduce((sum, u) => sum + u.estimatedCostUsd, 0);
  }

  isBudgetExhausted(): boolean {
    if (this.budget.dailyLimitUsd !== null && this.getDailySpend() >= this.budget.dailyLimitUsd) {
      return true;
    }
    if (
      this.budget.monthlyLimitUsd !== null &&
      this.getMonthlySpend() >= this.budget.monthlyLimitUsd
    ) {
      return true;
    }
    return false;
  }

  private recordUsage(usage: ModelUsage): void {
    this.usageLog.push(usage);
    this.onUsage?.(usage);

    if (this.budget.dailyLimitUsd !== null) {
      const pct = (this.getDailySpend() / this.budget.dailyLimitUsd) * 100;
      if (pct >= this.budget.alertThresholdPercent) {
        logger.warn(`Daily budget ${pct.toFixed(0)}% used ($${this.getDailySpend().toFixed(4)})`);
      }
    }
  }
}
