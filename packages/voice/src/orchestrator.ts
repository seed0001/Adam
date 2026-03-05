import type { VoiceProfile, SynthesisResult, VoiceOption, AdamError, Result } from "@adam/shared";
import { err, adamError } from "@adam/shared";
import type { IVoiceProvider } from "./providers/types.js";
import { EdgeTTSProvider } from "./providers/edge.js";
import { LuxTTSProvider } from "./providers/lux.js";
import { XTTSProvider } from "./providers/xtts.js";

/**
 * VoiceOrchestrator routes synthesis requests to the correct provider
 * based on the voice profile's provider field.
 */
export class VoiceOrchestrator {
  private providers: Map<string, IVoiceProvider> = new Map();

  constructor(sidecarDir?: string) {
    this.providers.set("edge", new EdgeTTSProvider());
    this.providers.set("lux", new LuxTTSProvider(sidecarDir));
    this.providers.set("xtts", new XTTSProvider());
  }

  async synthesize(
    text: string,
    profile: VoiceProfile,
    outputPath?: string,
  ): Promise<Result<SynthesisResult, AdamError>> {
    const provider = this.providers.get(profile.provider);
    if (!provider) {
      return err(adamError("voice:unknown-provider", `Unknown provider: ${profile.provider}`));
    }
    return provider.synthesize(text, profile, outputPath);
  }

  /** List built-in voices from Edge TTS. */
  async listEdgeVoices(): Promise<VoiceOption[]> {
    const provider = this.providers.get("edge");
    if (!provider?.listVoices) return [];
    return provider.listVoices();
  }

  getProvider(id: "edge" | "lux" | "xtts"): IVoiceProvider | undefined {
    return this.providers.get(id);
  }
}
