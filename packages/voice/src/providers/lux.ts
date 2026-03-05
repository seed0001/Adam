import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { VoiceProfile, SynthesisResult, AdamError, Result } from "@adam/shared";
import { err, adamError } from "@adam/shared";
import type { LuxVoiceConfig } from "@adam/shared";
import type { IVoiceProvider } from "./types.js";
import { VoiceClient } from "../sidecar-client.js";

const SIDECAR_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../sidecar");

export class LuxTTSProvider implements IVoiceProvider {
  readonly id = "lux" as const;
  readonly name = "Lux TTS";

  private client: VoiceClient | null = null;
  private sidecarDir: string;

  constructor(sidecarDir?: string) {
    this.sidecarDir = sidecarDir ?? SIDECAR_DIR;
  }

  async synthesize(
    text: string,
    profile: VoiceProfile,
    outputPath?: string,
  ): Promise<Result<SynthesisResult, AdamError>> {
    if (profile.provider !== "lux") {
      return err(adamError("voice:provider-mismatch", "Profile is not a Lux TTS profile"));
    }

    const config = profile.providerConfig as LuxVoiceConfig;

    // Adapt to legacy VoiceProfile shape expected by VoiceClient
    const legacyProfile = {
      id: profile.id,
      name: profile.name,
      description: profile.description,
      referenceAudioPath: config.referenceAudioPath,
      persona: profile.persona,
      params: config.params ?? {},
      isDefault: profile.isDefault,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };

    const client = this.getClient();
    const startResult = await client.start();
    if (startResult.isErr()) return err(startResult.error);

    return client.synthesize(
      { text, voiceProfileId: profile.id, outputPath },
      legacyProfile,
    );
  }

  async isAvailable(): Promise<boolean> {
    const client = this.getClient();
    const result = await client.start();
    return result.isOk();
  }

  private getClient(): VoiceClient {
    if (!this.client) this.client = new VoiceClient(this.sidecarDir);
    return this.client;
  }
}
