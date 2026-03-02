import { z } from "zod";

export const SkillCapabilitySchema = z.enum([
  "fs:read",
  "fs:write",
  "net:fetch",
  "shell:exec",
  "browser",
  "messaging",
  "memory:read",
  "memory:write",
  "voice",
]);
export type SkillCapability = z.infer<typeof SkillCapabilitySchema>;

export const SkillManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string().optional(),
  capabilities: z.array(SkillCapabilitySchema),
  entrypoint: z.string(),
  timeoutMs: z.number().int().positive().default(30_000),
  memoryLimitMb: z.number().int().positive().default(256),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      parameters: z.record(z.string(), z.unknown()),
    }),
  ),
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

export const SkillInstallStatusSchema = z.enum([
  "installed",
  "pending-approval",
  "disabled",
  "failed",
]);
export type SkillInstallStatus = z.infer<typeof SkillInstallStatusSchema>;
