/**
 * BuildSupervisor types — event schema, job status, stages.
 * See docs/BUILD_SUPERVISOR.md for design.
 */

export type BuildEvent =
  | { type: "JOB_STARTED"; branch: string }
  | { type: "STAGE_START"; stage: string }
  | { type: "STAGE_END"; stage: string; durationMs: number }
  | { type: "TOOL_CALL"; tool: string; summary: string }
  | { type: "LOG_CHUNK"; stream: "stdout" | "stderr"; chunk: string }
  | { type: "ERROR_DETECTED"; summary: string; file?: string; line?: number }
  | { type: "PATCH_APPLIED"; summary: string; files: string[] }
  | { type: "RETRY_SCHEDULED"; attempt: number }
  | { type: "AWAITING_REVIEW"; diffSummary: string }
  | { type: "JOB_COMPLETED"; success: boolean }
  | { type: "JOB_FAILED"; reason: string }
  | { type: "JOB_CANCELLED" };

export const JOB_STATUSES = [
  "pending",
  "running",
  "cancelling",
  "awaiting_review",
  "completed",
  "cancelled",
  "failed",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const BUILD_STAGES = [
  "checkout",
  "analyze",
  "dependency_install",
  "patch",
  "lint",
  "build",
  "test",
  "coverage",
  "review",
] as const;

export type BuildStage = (typeof BUILD_STAGES)[number];

export type Job = {
  id: string;
  branch: string;
  goal: string | null;
  status: JobStatus;
  currentStage: string | null;
  retries: number;
  lastUpdate: string;
  requiresApproval: boolean;
  createdAt: string;
  completedAt: string | null;
};

export const STAGE_MAX_RETRIES: Record<BuildStage, number> = {
  checkout: 2,
  analyze: 3,
  dependency_install: 2,
  patch: 5,
  lint: 3,
  build: 3,
  test: 3,
  coverage: 2,
  review: 1,
};
