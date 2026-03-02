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
import type { ProviderRegistry } from "./registry.js";

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
  ) {}

  /** Returns a resolved language model for direct use in tool calling. */
  getModel(tier: ModelTier): Result<AnyLanguageModel, AdamError> {
    if (this.isBudgetExhausted() && this.budget.fallbackToLocalOnExhaustion) {
      logger.warn("Budget exhausted, falling back to local model");
      return this.registry.resolveLanguageModel("fast");
    }
    return this.registry.resolveLanguageModel(tier);
  }

  async generate(opts: GenerateOptions): Promise<Result<string, AdamError>> {
    const modelResult = this.getModel(opts.tier);
    if (modelResult.isErr()) return modelResult;

    try {
      const start = Date.now();
      const callParams: Parameters<typeof generateText>[0] = {
        model: modelResult.value,
        prompt: opts.prompt,
      };
      if (opts.system !== undefined) callParams.system = opts.system;
      if (opts.maxTokens !== undefined) callParams.maxTokens = opts.maxTokens;

      const result = await generateText(callParams);

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
      const msg = e instanceof Error ? e.message : String(e);
      return err(adamError("router:generate-failed", msg, e));
    }
  }

  async generateWithTools(opts: GenerateWithToolsOptions): Promise<Result<string, AdamError>> {
    const modelResult = this.getModel(opts.tier);
    if (modelResult.isErr()) return modelResult;

    try {
      const start = Date.now();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params: any = {
        model: modelResult.value,
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
      const msg = e instanceof Error ? e.message : String(e);
      return err(adamError("router:generate-failed", msg, e));
    }
  }

  async generateObject<T>(opts: GenerateObjectOptions<T>): Promise<Result<T, AdamError>> {
    const modelResult = this.getModel(opts.tier);
    if (modelResult.isErr()) return modelResult;

    try {
      const start = Date.now();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const goParams: any = {
        model: modelResult.value,
        prompt: opts.prompt,
        schema: opts.schema,
      };
      if (opts.system !== undefined) goParams.system = opts.system;
      if (opts.schemaName !== undefined) goParams.schemaName = opts.schemaName;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
      const result = await (generateObject as any)(goParams) as Awaited<ReturnType<typeof generateObject>>;

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

      return ok(result.object as T);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(adamError("router:generate-object-failed", msg, e));
    }
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
