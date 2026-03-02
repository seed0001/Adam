import { z } from "zod";
import { BudgetConfigSchema } from "./types/model.js";

// ── Provider configs ─────────────────────────────────────────────────────────

export const CloudProviderConfigSchema = z.object({
  enabled: z.boolean().default(false),
  apiKey: z.string().optional(),
  defaultModels: z
    .object({
      fast: z.string().optional(),
      capable: z.string().optional(),
    })
    .default({}),
});
export type CloudProviderConfig = z.infer<typeof CloudProviderConfigSchema>;

export const OllamaConfigSchema = z.object({
  enabled: z.boolean().default(false),
  baseUrl: z.string().url().default("http://localhost:11434"),
  models: z
    .object({
      fast: z.string().default("llama3.2:1b"),
      capable: z.string().default("llama3.2"),
      /**
       * Dedicated code-editing model — routes to the "coder" tier.
       * Recommended: deepseek-coder-v2, qwen2.5-coder, codellama
       * If not set, code tools fall back to the capable model.
       */
      coder: z.string().optional(),
    })
    .default({}),
});
export type OllamaConfig = z.infer<typeof OllamaConfigSchema>;

export const OpenAICompatibleConfigSchema = z.object({
  enabled: z.boolean().default(false),
  baseUrl: z.string().url().default("http://localhost:1234/v1"),
  models: z
    .object({
      fast: z.string().default("local-model"),
      capable: z.string().default("local-model"),
    })
    .default({}),
});
export type OpenAICompatibleConfig = z.infer<typeof OpenAICompatibleConfigSchema>;

export const HuggingFaceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  apiKey: z.string().optional(),
  inferenceApiModel: z.string().optional(),
  tgiBaseUrl: z.string().url().optional(),
  embeddingModel: z
    .string()
    .default("Xenova/all-MiniLM-L6-v2"),
});
export type HuggingFaceConfig = z.infer<typeof HuggingFaceConfigSchema>;

export const ProvidersConfigSchema = z.object({
  anthropic: CloudProviderConfigSchema.default({}),
  openai: CloudProviderConfigSchema.default({}),
  google: CloudProviderConfigSchema.default({}),
  groq: CloudProviderConfigSchema.default({}),
  mistral: CloudProviderConfigSchema.default({}),
  deepseek: CloudProviderConfigSchema.default({}),
  openrouter: CloudProviderConfigSchema.default({}),
  xai: CloudProviderConfigSchema.default({}),
  ollama: OllamaConfigSchema.default({}),
  lmstudio: OpenAICompatibleConfigSchema.default({}),
  vllm: OpenAICompatibleConfigSchema.default({}),
  huggingface: HuggingFaceConfigSchema.default({}),
});
export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;

// ── Adapter configs ───────────────────────────────────────────────────────────

export const TelegramAdapterConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().optional(),
});

export const DiscordAdapterConfigSchema = z.object({
  enabled: z.boolean().default(false),
  clientId: z.string().optional(),

  // Access control
  channelWhitelist: z.array(z.string()).default([]),      // empty = all channels
  userBlacklist: z.array(z.string()).default([]),         // user IDs to always ignore
  adminUsers: z.array(z.string()).default([]),            // can run /adam-config, !adam commands

  // Behavior
  mentionOnly: z.boolean().default(true),                // server msgs: require @mention
  respondInThreads: z.boolean().default(false),          // auto-create threads for responses
  rateLimitPerUserPerMinute: z.number().int().min(0).default(0), // 0 = unlimited

  // Customization
  systemPromptOverride: z.string().optional(),           // Discord-specific personality
  maxMessageLength: z.number().int().min(500).max(4000).default(2000),
});
export type DiscordAdapterConfig = z.infer<typeof DiscordAdapterConfigSchema>;

export const CliAdapterConfigSchema = z.object({
  enabled: z.boolean().default(true),
});

export const AdaptersConfigSchema = z.object({
  cli: CliAdapterConfigSchema.default({}),
  telegram: TelegramAdapterConfigSchema.default({}),
  discord: DiscordAdapterConfigSchema.default({}),
});
export type AdaptersConfig = z.infer<typeof AdaptersConfigSchema>;

// ── Voice config ──────────────────────────────────────────────────────────────

export const VoiceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  autoStartSidecar: z.boolean().default(true),
  outputDir: z.string().optional(),
});
export type VoiceConfig = z.infer<typeof VoiceConfigSchema>;

// ── Memory config ─────────────────────────────────────────────────────────────

export const MemoryConfigSchema = z.object({
  /**
   * Half-life of auto-extracted profile facts in days.
   * After this many days without being referenced in a prompt, a fact's
   * confidence is halved. Facts below `decayMinConfidence` are pruned.
   */
  decayHalfLifeDays: z.number().min(1).max(365).default(30),
  /**
   * Confidence floor — facts that decay below this value are deleted.
   * Range: 0.01 – 0.99
   */
  decayMinConfidence: z.number().min(0.01).max(0.99).default(0.25),
  /**
   * Episodic sessions older than this many days are eligible for consolidation
   * into long-term profile facts by the background consolidator.
   */
  consolidateAfterDays: z.number().min(1).max(90).default(14),
});
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

// ── Daemon config ─────────────────────────────────────────────────────────────

export const DaemonConfigSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(18800),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  systemPrompt: z.string().optional(),
  agentName: z.string().default("Adam"),
});
export type DaemonConfig = z.infer<typeof DaemonConfigSchema>;

// ── Root config ───────────────────────────────────────────────────────────────

export const AdamConfigSchema = z.object({
  /** Semver of the config schema — used for migrations. */
  version: z.string().default("1"),
  providers: ProvidersConfigSchema.default({}),
  adapters: AdaptersConfigSchema.default({}),
  memory: MemoryConfigSchema.default({}),
  budget: BudgetConfigSchema.default({}),
  voice: VoiceConfigSchema.default({}),
  daemon: DaemonConfigSchema.default({}),
});
export type AdamConfig = z.infer<typeof AdamConfigSchema>;

/** The default config — a fully-local, zero-API-key setup via Ollama. */
export const DEFAULT_CONFIG: AdamConfig = AdamConfigSchema.parse({
  providers: {
    ollama: { enabled: true },
  },
});
