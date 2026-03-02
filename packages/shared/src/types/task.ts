import { z } from "zod";

export const TaskComplexitySchema = z.enum(["trivial", "simple", "complex", "multi-step"]);
export type TaskComplexity = z.infer<typeof TaskComplexitySchema>;

export const TaskStatusSchema = z.enum([
  "pending",
  "planning",
  "running",
  "awaiting-dependency",
  "succeeded",
  "failed",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.enum(["low", "normal", "high", "critical"]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  sessionId: z.string().uuid(),
  description: z.string(),
  complexity: TaskComplexitySchema,
  priority: TaskPrioritySchema.default("normal"),
  status: TaskStatusSchema.default("pending"),
  dependsOn: z.array(z.string().uuid()).default([]),
  input: z.record(z.string(), z.unknown()).default({}),
  output: z.record(z.string(), z.unknown()).nullable().default(null),
  error: z.string().nullable().default(null),
  toolCalls: z.array(z.string()).default([]),
  modelTier: z.enum(["fast", "capable", "embedding"]).default("capable"),
  createdAt: z.coerce.date(),
  startedAt: z.coerce.date().nullable().default(null),
  finishedAt: z.coerce.date().nullable().default(null),
  retryCount: z.number().int().min(0).default(0),
  maxRetries: z.number().int().min(0).default(2),
});

export type Task = z.infer<typeof TaskSchema>;

export const TaskGraphSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  rootGoal: z.string(),
  tasks: z.array(TaskSchema),
  status: z.enum(["building", "running", "succeeded", "failed", "cancelled"]),
  createdAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable().default(null),
});

export type TaskGraph = z.infer<typeof TaskGraphSchema>;
