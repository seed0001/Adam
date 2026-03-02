import { z } from "zod";

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
  referenceAudioPath: z.string(),
  persona: z.string().default(""),
  params: VoiceSamplingParamsSchema.default({}),
  isDefault: z.boolean().default(false),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;

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
