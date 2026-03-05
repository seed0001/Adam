/**
 * Image generation for chat backgrounds.
 * Supports xAI (Grok) and OpenAI (DALL-E 3).
 * Uses OpenAI-compatible /v1/images/generations API.
 */

import type { AdamConfig } from "@adam/shared";
import { createLogger } from "@adam/shared";

const logger = createLogger("image-generator");

export type ImageGenResult = { base64: string; provider: string } | { error: string };

async function generateViaApi(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  extraBody: Record<string, unknown> = {},
): Promise<string | null> {
  const body: Record<string, unknown> = {
    model,
    prompt: prompt.slice(0, 1000),
    response_format: "b64_json",
    n: 1,
    ...extraBody,
  };

  const res = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Image API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  return data.data?.[0]?.b64_json ?? null;
}

/**
 * Generate an image from a text prompt.
 * Tries xAI (grok-imagine-image) first if configured, then OpenAI (dall-e-3).
 */
export async function generateChatBackground(
  prompt: string,
  config: AdamConfig,
  getApiKey: (provider: string) => Promise<string | null>,
): Promise<ImageGenResult> {
  const trimmed = prompt?.trim() ?? "";
  if (trimmed.length < 3) {
    return { error: "Prompt too short (min 3 characters)" };
  }

  // Try xAI first
  if (config.providers.xai?.enabled) {
    const apiKey = await getApiKey("xai");
    if (apiKey) {
      try {
        const base64 = await generateViaApi(
          "https://api.x.ai/v1",
          apiKey,
          "grok-imagine-image",
          trimmed,
          { aspect_ratio: "16:9" },
        );
        if (base64) {
          logger.info("Generated chat background via xAI");
          return { base64, provider: "xai" };
        }
      } catch (e) {
        logger.warn("xAI image generation failed", { error: String(e) });
      }
    }
  }

  // Fall back to OpenAI
  if (config.providers.openai?.enabled) {
    const apiKey = await getApiKey("openai");
    if (apiKey) {
      try {
        const base64 = await generateViaApi(
          "https://api.openai.com/v1",
          apiKey,
          "dall-e-3",
          trimmed,
          { size: "1792x1024" },
        );
        if (base64) {
          logger.info("Generated chat background via OpenAI");
          return { base64, provider: "openai" };
        }
      } catch (e) {
        logger.warn("OpenAI image generation failed", { error: String(e) });
      }
    }
  }

  return {
    error: "No image provider available. Enable xAI or OpenAI with an API key.",
  };
}
