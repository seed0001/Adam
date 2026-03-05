import type { VoiceProfile, SynthesisResult, AdamError, Result } from "@adam/shared";
import { err, adamError } from "@adam/shared";
import type { IVoiceProvider } from "./types.js";

/**
 * XTTS (Coqui) provider — voice cloning from reference audio.
 * Requires Python sidecar (similar to Lux). Stub for now; implement when sidecar is ready.
 */
export class XTTSProvider implements IVoiceProvider {
  readonly id = "xtts" as const;
  readonly name = "XTTS (Coqui)";

  async synthesize(
    _text: string,
    profile: VoiceProfile,
    _outputPath?: string,
  ): Promise<Result<SynthesisResult, AdamError>> {
    if (profile.provider !== "xtts") {
      return err(adamError("voice:provider-mismatch", "Profile is not an XTTS profile"));
    }
    return err(
      adamError(
        "voice:xtts-not-implemented",
        "XTTS sidecar not yet implemented. Use Edge TTS or Lux TTS for now.",
      ),
    );
  }

  async isAvailable(): Promise<boolean> {
    return false;
  }
}
