import type { AdamConfig } from "@adam/shared";
import type { ModelPoolConfig, ProviderConfig } from "@adam/models";
import type { CredentialVault } from "@adam/security";

/**
 * Build model pool from config and vault.
 * Used by both daemon and build-supervisor worker.
 */
export async function buildModelPool(
  config: AdamConfig,
  vault: CredentialVault,
): Promise<ModelPoolConfig> {
  const fast: ProviderConfig[] = [];
  const capable: ProviderConfig[] = [];
  const coder: ProviderConfig[] = [];

  const cloudProviders = [
    "anthropic",
    "openai",
    "google",
    "groq",
    "xai",
    "mistral",
    "deepseek",
    "openrouter",
    "qwen",
  ] as const;

  for (const name of cloudProviders) {
    const providerCfg = config.providers[name];
    if (!providerCfg.enabled) continue;
    const keyResult = await vault.get(`provider:${name}:api-key`);
    const apiKey = keyResult.isOk() && keyResult.value ? keyResult.value : null;
    if (!apiKey) continue;
    const models = providerCfg.defaultModels;
    if (models.fast) fast.push({ type: "cloud", provider: name, model: models.fast, apiKey });
    if (models.capable) capable.push({ type: "cloud", provider: name, model: models.capable, apiKey });
  }

  if (config.providers.ollama.enabled) {
    const { models, baseUrl } = config.providers.ollama;
    const effectiveBaseUrl = baseUrl || "http://localhost:11434";

    // Auto-discovery: If use hasn't changed defaults, try to see if they're actually there.
    // Small local models are often missing from fresh installs.
    try {
      const response = await fetch(`${effectiveBaseUrl}/api/tags`);
      if (response.ok) {
        const data = (await response.json()) as { models: Array<{ name: string }> };
        const available = data.models.map(m => m.name);

        const register = (tier: string, configured: string | undefined, target: ProviderConfig[]) => {
          if (!configured) return;
          // If configured model exists, or if the user explicitly changed it from default, use it.
          // Otherwise, if default is missing, pick the first available.
          const isDefault = configured === "llama3.2:1b" || configured === "llama3.2";
          if (available.includes(configured) || (!isDefault && configured !== "")) {
            target.push({ type: "local", provider: "ollama", model: configured, baseUrl: effectiveBaseUrl });
          } else if (available.length > 0) {
            const fallback = available[0]!;
            target.push({ type: "local", provider: "ollama", model: fallback, baseUrl: effectiveBaseUrl });
          }
        };

        register("fast", models.fast, fast);
        register("capable", models.capable, capable);
        if (models.coder) {
          register("coder", models.coder, coder);
        }
      } else {
        throw new Error(`Ollama status: ${response.status}`);
      }
    } catch (e) {
      // Fallback to static config if discovery fails
      fast.push({ type: "local", provider: "ollama", model: models.fast, baseUrl });
      capable.push({ type: "local", provider: "ollama", model: models.capable, baseUrl });
      if (models.coder) {
        coder.push({ type: "local", provider: "ollama", model: models.coder, baseUrl });
      }
    }
  }
  if (config.providers.lmstudio.enabled) {
    const { models, baseUrl } = config.providers.lmstudio;
    fast.push({ type: "local", provider: "lmstudio", model: models.fast, baseUrl });
    capable.push({ type: "local", provider: "lmstudio", model: models.capable, baseUrl });
  }
  if (config.providers.vllm.enabled) {
    const { models, baseUrl } = config.providers.vllm;
    fast.push({ type: "local", provider: "vllm", model: models.fast, baseUrl });
    capable.push({ type: "local", provider: "vllm", model: models.capable, baseUrl });
  }
  if (config.providers.huggingface.enabled) {
    const hfKeyResult = await vault.get("provider:huggingface:api-key");
    const hfKey = hfKeyResult.isOk() && hfKeyResult.value ? hfKeyResult.value : undefined;
    if (config.providers.huggingface.inferenceApiModel) {
      capable.push({
        type: "huggingface",
        mode: "inference-api",
        model: config.providers.huggingface.inferenceApiModel,
        ...(hfKey !== undefined ? { apiKey: hfKey } : {}),
      });
    }
  }

  return {
    fast,
    capable,
    coder,
    embedding: [
      {
        type: "huggingface",
        mode: "transformers",
        model: config.providers.huggingface.embeddingModel,
      },
    ],
  };
}
