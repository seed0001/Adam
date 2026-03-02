import { z } from "zod";

export const ModelTierSchema = z.enum(["fast", "capable", "coder", "embedding"]);
export type ModelTier = z.infer<typeof ModelTierSchema>;

export const ProviderTypeSchema = z.enum(["cloud", "local", "huggingface"]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const HuggingFaceModeSchema = z.enum(["inference-api", "tgi", "transformers"]);
export type HuggingFaceMode = z.infer<typeof HuggingFaceModeSchema>;

export const ModelUsageSchema = z.object({
  sessionId: z.string().uuid(),
  taskId: z.string().uuid().nullable().default(null),
  provider: z.string(),
  model: z.string(),
  tier: ModelTierSchema,
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  estimatedCostUsd: z.number().min(0),
  durationMs: z.number().int().min(0),
  timestamp: z.coerce.date(),
});
export type ModelUsage = z.infer<typeof ModelUsageSchema>;

export const BudgetConfigSchema = z.object({
  dailyLimitUsd: z.number().min(0).nullable().default(null),
  monthlyLimitUsd: z.number().min(0).nullable().default(null),
  alertThresholdPercent: z.number().min(0).max(100).default(80),
  fallbackToLocalOnExhaustion: z.boolean().default(true),
});
export type BudgetConfig = z.infer<typeof BudgetConfigSchema>;
