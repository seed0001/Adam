import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EdgeTTS } from "edge-tts-universal";
import type { VoiceProfile, SynthesisResult, VoiceOption, AdamError, Result } from "@adam/shared";
import { ok, err, adamError } from "@adam/shared";
import type { EdgeVoiceConfig } from "@adam/shared";
import type { IVoiceProvider } from "./types.js";

const OUTPUT_DIR = join(tmpdir(), "adam-voice");

export class EdgeTTSProvider implements IVoiceProvider {
  readonly id = "edge" as const;
  readonly name = "Edge TTS";

  async synthesize(
    text: string,
    profile: VoiceProfile,
    outputPath?: string,
  ): Promise<Result<SynthesisResult, AdamError>> {
    if (profile.provider !== "edge") {
      return err(adamError("voice:provider-mismatch", "Profile is not an Edge TTS profile"));
    }

    const config = profile.providerConfig as EdgeVoiceConfig;
    const path = outputPath ?? join(OUTPUT_DIR, `edge-${Date.now()}.mp3`);

    try {
      const tts = new EdgeTTS(text, config.voiceId, {
        rate: config.rate ?? "+0%",
        pitch: config.pitch ?? "+0Hz",
      });
      const result = await tts.synthesize();
      const buffer = Buffer.from(await result.audio.arrayBuffer());
      await writeFile(path, buffer);

      // Estimate duration from subtitle boundaries if available.
      // EdgeTTS reports offset and duration in 100-nanosecond units → divide by 10000 to get ms.
      let durationMs = 0;
      const subs = result.subtitle;
      if (subs && subs.length > 0) {
        const last = subs[subs.length - 1];
        durationMs = last ? Math.round((last.offset + last.duration) / 10000) : 0;
      } else {
        durationMs = Math.round((buffer.length / 32000) * 1000); // rough MP3 estimate
      }

      return ok({
        audioPath: path,
        durationMs,
        sampleRate: 24000,
        generatedAt: new Date(),
        mimeType: "audio/mpeg",
      });

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(adamError("voice:edge-synthesis-failed", msg, e));
    }
  }

  async listVoices(): Promise<VoiceOption[]> {
    try {
      const { listVoicesUniversal } = await import("edge-tts-universal");
      const voices = await listVoicesUniversal();
      return voices.map((v: { ShortName: string; FriendlyName?: string; Locale?: string; Gender?: string }) => {
        const opt: VoiceOption = {
          id: v.ShortName,
          name: v.FriendlyName ?? v.ShortName,
          provider: "edge",
        };
        if (v.Locale != null) opt.locale = v.Locale;
        if (v.Gender != null) opt.gender = v.Gender;
        return opt;
      });
    } catch {
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
