import type { VoiceProfile, SynthesisResult, VoiceOption, AdamError, Result } from "@adam/shared";

/**
 * Voice provider interface. Each provider (Edge, Lux, XTTS) implements this.
 */
export interface IVoiceProvider {
  readonly id: "edge" | "lux" | "xtts";
  readonly name: string;

  /** Synthesize speech from text using the given profile. */
  synthesize(
    text: string,
    profile: VoiceProfile,
    outputPath?: string,
  ): Promise<Result<SynthesisResult, AdamError>>;

  /** List available voices (built-in for Edge; custom profiles for Lux/XTTS). */
  listVoices?(): Promise<VoiceOption[]>;

  /** Whether this provider is available (e.g. sidecar running). */
  isAvailable?(): Promise<boolean>;
}
