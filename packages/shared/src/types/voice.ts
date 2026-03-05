import { z } from "zod";

export type VoiceProvider = "edge" | "lux" | "xtts";

export type EdgeVoiceConfig = { voiceId: string; rate?: string; pitch?: string };
export type LuxVoiceConfig = {
  referenceAudioPath: string;
  params?: {
    rms?: number;
    tShift?: number;
    numSteps?: number;
    speed?: number;
    returnSmooth?: boolean;
    refDuration?: number;
  };
};
export type XTTSVoiceConfig = { referenceAudioPath: string; language?: string; speakerId?: string };

export type VoiceOption = {
  id: string;
  name: string;
  locale?: string;
  gender?: string;
  provider: VoiceProvider;
};

export const VoiceSamplingParamsSchema = z.object({
  rms: z.number().min(0).max(1).default(0.01),
  tShift: z.number().min(0).max(1).default(0.9),
  numSteps: z.number().int().min(1).max(20).default(4),
  speed: z.number().min(0.5).max(2.0).default(1.0),
  returnSmooth: z.boolean().default(false),
  refDuration: z.number().int().min(1).max(1000).default(5),
});
export type VoiceSamplingParams = z.infer<typeof VoiceSamplingParamsSchema>;

export const VoiceProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().default(""),
  provider: z.enum(["edge", "lux", "xtts"]).default("lux"),
  providerConfig: z.record(z.unknown()).default({}),
  persona: z.string().default(""),
  isDefault: z.boolean().default(false),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type VoiceProfile = {
  id: string;
  name: string;
  description: string;
  provider: VoiceProvider;
  providerConfig: EdgeVoiceConfig | LuxVoiceConfig | XTTSVoiceConfig;
  persona: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export const SynthesisRequestSchema = z.object({
  text: z.string().min(1).max(10_000),
  voiceProfileId: z.string().uuid(),
  outputPath: z.string().optional(),
});
export type SynthesisRequest = z.infer<typeof SynthesisRequestSchema>;

export const SynthesisResultSchema = z.object({
  audioPath: z.string(),
  durationMs: z.number(),
  sampleRate: z.number(),
  generatedAt: z.coerce.date(),
});
export type SynthesisResult = z.infer<typeof SynthesisResultSchema>;
