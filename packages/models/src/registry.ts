import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createXai } from "@ai-sdk/xai";
import { createOllama } from "ollama-ai-provider";
import { ollamaFetch } from "./ollama-fetch.js";
import { qwenFetch } from "./qwen-fetch.js";
import type { EmbeddingModel } from "ai";
// Use a broad type to stay compatible across AI SDK provider versions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LanguageModel = any;
import {
  type ModelTier,
  type ProviderType,
  type HuggingFaceMode,
  type AdamError,
  type Result,
  ok,
  err,
  adamError,
} from "@adam/shared";

export type ProviderConfig =
  | { type: "cloud"; provider: CloudProvider; model: string; apiKey: string }
  | { type: "local"; provider: LocalProvider; model: string; baseUrl?: string }
  | {
      type: "huggingface";
      mode: HuggingFaceMode;
      model: string;
      apiKey?: string;
      baseUrl?: string;
    };

export type CloudProvider =
  | "anthropic"
  | "openai"
  | "google"
  | "groq"
  | "mistral"
  | "deepseek"
  | "openrouter"
  | "xai"
  | "qwen";

export type LocalProvider = "ollama" | "lmstudio" | "vllm" | "openai-compatible";

export type ModelPoolConfig = {
  fast: ProviderConfig[];
  capable: ProviderConfig[];
  /**
   * Dedicated code-editing tier.
   * Routes to a specialized local coder model (e.g. deepseek-coder-v2, qwen2.5-coder).
   * If empty, falls back to the capable pool — so this is always safe to leave unset.
   */
  coder: ProviderConfig[];
  embedding: ProviderConfig[];
};

/**
 * ProviderRegistry is the single place in Adam that knows which model
 * is actually being called. Everything else speaks only LanguageModel.
 */
export class ProviderRegistry {
  constructor(private pool: ModelPoolConfig) {}

  /** Returns the current pool — reflects what was actually loaded and vault-verified at build time. */
  getPool(): ModelPoolConfig {
    return this.pool;
  }

  resolveLanguageModel(tier: ModelTier): Result<LanguageModel, AdamError> {
    let configs: ProviderConfig[];

    if (tier === "embedding") {
      configs = this.pool.capable;
    } else if (tier === "coder") {
      // Use dedicated coder pool if configured; fall back to capable so this
      // always resolves even when no local coder model is installed.
      configs = this.pool.coder.length > 0 ? this.pool.coder : this.pool.capable;
    } else {
      configs = this.pool[tier];
    }

    for (const config of configs) {
      const result = this.buildLanguageModel(config);
      if (result.isOk()) return result;
    }

    return err(adamError("registry:no-model", `No model available for tier '${tier}'`));
  }

  resolveEmbeddingModel(): Result<EmbeddingModel<string>, AdamError> {
    const configs = this.pool.embedding;
    for (const config of configs) {
      const result = this.buildEmbeddingModel(config);
      if (result.isOk()) return result;
    }
    return err(adamError("registry:no-embedding-model", "No embedding model configured"));
  }

  private buildLanguageModel(config: ProviderConfig): Result<LanguageModel, AdamError> {
    try {
      if (config.type === "cloud") {
        return ok(this.buildCloudModel(config));
      }
      if (config.type === "local") {
        return ok(this.buildLocalModel(config));
      }
      if (config.type === "huggingface") {
        return ok(this.buildHuggingFaceModel(config));
      }
      return err(adamError("registry:unknown-provider-type", "Unknown provider type"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(adamError("registry:build-failed", `Failed to build model: ${msg}`, e));
    }
  }

  private buildCloudModel(
    config: Extract<ProviderConfig, { type: "cloud" }>,
  ): LanguageModel {
    switch (config.provider) {
      case "anthropic":
        return createAnthropic({ apiKey: config.apiKey })(config.model);
      case "openai":
        return createOpenAI({ apiKey: config.apiKey })(config.model);
      case "google":
        return createGoogleGenerativeAI({ apiKey: config.apiKey })(config.model);
      case "groq":
        return createGroq({ apiKey: config.apiKey })(config.model);
      case "mistral":
        return createMistral({ apiKey: config.apiKey })(config.model);
      case "deepseek":
        return createDeepSeek({ apiKey: config.apiKey })(config.model);
      case "openrouter":
        return createOpenRouter({ apiKey: config.apiKey })(config.model);
      case "xai":
        return createXai({ apiKey: config.apiKey })(config.model);
      case "qwen":
        return createOpenAI({
          baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
          apiKey: config.apiKey,
          fetch: qwenFetch,
        })(config.model);
    }
  }

  private buildLocalModel(
    config: Extract<ProviderConfig, { type: "local" }>,
  ): LanguageModel {
    switch (config.provider) {
      case "ollama": {
        const baseURL = config.baseUrl
          ? `${config.baseUrl.replace(/\/$/, "")}/api`
          : "http://127.0.0.1:11434/api";
        const ollama = createOllama({ baseURL, fetch: ollamaFetch });
        return ollama(config.model);
      }
      case "lmstudio":
      case "vllm":
      case "openai-compatible": {
        const baseURL = config.baseUrl ?? "http://localhost:1234/v1";
        return createOpenAI({ baseURL, apiKey: "local" })(config.model);
      }
    }
  }

  private buildHuggingFaceModel(
    config: Extract<ProviderConfig, { type: "huggingface" }>,
  ): LanguageModel {
    switch (config.mode) {
      case "inference-api": {
        const baseURL = "https://api-inference.huggingface.co/v1";
        return createOpenAI({ baseURL, apiKey: config.apiKey ?? "" })(config.model);
      }
      case "tgi": {
        const baseURL = config.baseUrl ?? "http://localhost:8080/v1";
        return createOpenAI({ baseURL, apiKey: "tgi" })(config.model);
      }
      case "transformers":
        throw new Error(
          "HuggingFace Transformers.js does not expose a LanguageModel interface. Use resolveEmbeddingModel() or the TransformersEmbedder directly.",
        );
    }
  }

  private buildEmbeddingModel(
    _config: ProviderConfig,
  ): Result<EmbeddingModel<string>, AdamError> {
    return err(
      adamError(
        "registry:embedding-not-implemented",
        "Embedding model resolution implemented in TransformersEmbedder",
      ),
    );
  }
}
