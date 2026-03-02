import { z } from "zod";

export const AuditActionSchema = z.enum([
  "tool:call",
  "fs:read",
  "fs:write",
  "shell:exec",
  "net:fetch",
  "browser:navigate",
  "message:send",
  "memory:write",
  "voice:synthesize",
  "skill:install",
  "skill:approve",
  "credential:store",
  "credential:retrieve",
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditEntrySchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid().nullable().default(null),
  taskId: z.string().uuid().nullable().default(null),
  skillId: z.string().nullable().default(null),
  action: AuditActionSchema,
  target: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
  outcome: z.enum(["success", "failure", "blocked"]),
  errorMessage: z.string().nullable().default(null),
  undoData: z.record(z.string(), z.unknown()).nullable().default(null),
  timestamp: z.coerce.date(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const PermissionApprovalSchema = z.object({
  skillId: z.string(),
  capability: z.string(),
  approvedAt: z.coerce.date(),
  approvedByUser: z.boolean(),
});
export type PermissionApproval = z.infer<typeof PermissionApprovalSchema>;
