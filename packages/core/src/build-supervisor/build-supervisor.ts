import type Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@adam/shared";
import type { BuildEvent } from "./types.js";
import { JobRegistry } from "./job-registry.js";
import type { BuildStage } from "./types.js";
import { BUILD_STAGES, STAGE_MAX_RETRIES } from "./types.js";
import {
  runShellCommand,
  runGitCheckout,
  detectPackageManager,
  getInstallCommand,
  getRunCommand,
} from "./pipeline-runner.js";

const logger = createLogger("core:build-supervisor");

import type { ModelRouter } from "@adam/models";
import { createCodeTools } from "@adam/skills";
import { z } from "zod";

const PatchPlanSchema = z.object({
  changes: z.array(
    z.object({
      path: z.string(),
      action: z.enum(["create", "edit"]),
      instruction: z.string(),
    }),
  ),
});
type PatchPlan = z.infer<typeof PatchPlanSchema>;

const ENGINEERING_SYSTEM_PROMPT = `You are an engineering pipeline. You produce structured plans and implementations.
No personality. No memory. No conversation. Only deterministic output.
You receive a goal. You output a plan or implement a change.`;

export type BuildSupervisorConfig = {
  repoPath: string;
  branch: string;
  /** User goal for analyze/patch stages. When absent, those stages are skipped. */
  goal?: string | null;
  /** Model router for LLM stages (analyze: capable, patch: coder). When absent, analyze/patch are skipped. */
  router?: ModelRouter;
};

export type BuildSupervisorCallbacks = {
  onEvent?: (jobId: string, event: BuildEvent) => void;
};

/**
 * Engineering pipeline engine. Runs long jobs, emits events, checks cancellation.
 * See docs/BUILD_SUPERVISOR.md.
 */
export class BuildSupervisor {
  private registry: JobRegistry;

  constructor(
    db: Database.Database,
    private config: BuildSupervisorConfig,
    private callbacks: BuildSupervisorCallbacks = {},
  ) {
    this.registry = new JobRegistry(db);
  }

  /**
   * Create and start a job. Returns immediately with job ID.
   */
  async startJob(requiresApproval = true): Promise<string> {
    const result = this.registry.create(this.config.branch, requiresApproval);
    if (result.isErr()) throw new Error(result.error.message);
    const jobId = result.value;

    // Run in background — do not await
    void this.runJob(jobId);
    return jobId;
  }

  /**
   * Run an existing job (e.g. when worker process picks it up).
   * Call this from the worker with a job ID created by the daemon.
   */
  async runExistingJob(jobId: string): Promise<void> {
    const job = this.registry.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (job.status !== "pending")
      throw new Error(`Job ${jobId} is not pending (status: ${job.status})`);
    // Use job's branch and goal for this run
    this.config = { ...this.config, branch: job.branch, goal: job.goal };
    await this.runJob(jobId);
  }

  /** Plan produced by analyze stage, consumed by patch stage. */
  private plan: PatchPlan | null = null;

  /**
   * Main job loop. Runs stages in order, checks cancellation between stages.
   */
  private async runJob(jobId: string): Promise<void> {
    this.plan = null;
    const emit = (event: BuildEvent) => {
      this.registry.appendEvent(jobId, event);
      this.callbacks.onEvent?.(jobId, event);
    };

    emit({ type: "JOB_STARTED", branch: this.config.branch });
    this.registry.updateStatus(jobId, "running");

    for (const stage of BUILD_STAGES) {
      if (this.registry.isCancelling(jobId)) {
        emit({ type: "JOB_CANCELLED" });
        this.registry.updateStatus(jobId, "cancelled");
        return;
      }

      const stageStart = Date.now();
      this.registry.updateStage(jobId, stage);
      emit({ type: "STAGE_START", stage });

      const maxRetries = STAGE_MAX_RETRIES[stage];
      let attempt = 0;
      let succeeded = false;

      while (attempt <= maxRetries && !succeeded) {
        if (attempt > 0) {
          emit({ type: "RETRY_SCHEDULED", attempt });
          this.registry.incrementRetries(jobId);
        }

        const result = await this.runStage(jobId, stage, emit, (p) => this.plan = p);
        if (result === "cancelled") return;
        if (result === "success") {
          succeeded = true;
          break;
        }
        attempt++;
      }

      const durationMs = Date.now() - stageStart;
      emit({ type: "STAGE_END", stage, durationMs });

      if (!succeeded) {
        emit({ type: "JOB_FAILED", reason: `Stage ${stage} exceeded max retries (${maxRetries})` });
        this.registry.updateStatus(jobId, "failed");
        return;
      }

      // Skip remaining stages for now if we hit "review" — placeholder
      if (stage === "review") {
        emit({ type: "AWAITING_REVIEW", diffSummary: "Ready for approval" });
        this.registry.updateStatus(jobId, "awaiting_review");
        return;
      }
    }

    emit({ type: "JOB_COMPLETED", success: true });
    this.registry.updateStatus(jobId, "completed");
  }

  private async runStage(
    jobId: string,
    stage: BuildStage,
    emit: (e: BuildEvent) => void,
    setPlan: (p: PatchPlan | null) => void,
  ): Promise<"success" | "failure" | "cancelled"> {
    const cwd = this.config.repoPath;

    switch (stage) {
      case "checkout": {
        emit({ type: "TOOL_CALL", tool: "git", summary: `Checkout branch ${this.config.branch}` });
        const result = await runGitCheckout(this.config.branch, cwd, emit);
        return result.success ? "success" : "failure";
      }
      case "dependency_install": {
        const pm = detectPackageManager(cwd);
        const cmd = getInstallCommand(pm);
        emit({ type: "TOOL_CALL", tool: "shell", summary: cmd });
        const result = await runShellCommand(cmd, { cwd, timeoutMs: 120_000, emit });
        return result.success ? "success" : "failure";
      }
      case "analyze":
        return this.runAnalyzeStage(jobId, emit, setPlan);
      case "patch":
        return this.runPatchStage(jobId, emit);
      case "lint": {
        if (!this.hasScript(cwd, "lint")) {
          emit({ type: "TOOL_CALL", tool: "shell", summary: "lint (no script, skip)" });
          return "success";
        }
        const pm = detectPackageManager(cwd);
        const cmd = getRunCommand(pm, "lint");
        emit({ type: "TOOL_CALL", tool: "shell", summary: cmd });
        const result = await runShellCommand(cmd, { cwd, timeoutMs: 60_000, emit });
        return result.success ? "success" : "failure";
      }
      case "build": {
        if (!this.hasScript(cwd, "build")) {
          emit({ type: "TOOL_CALL", tool: "shell", summary: "build (no script, skip)" });
          return "success";
        }
        const pm = detectPackageManager(cwd);
        const cmd = getRunCommand(pm, "build");
        emit({ type: "TOOL_CALL", tool: "shell", summary: cmd });
        const result = await runShellCommand(cmd, { cwd, timeoutMs: 120_000, emit });
        return result.success ? "success" : "failure";
      }
      case "test": {
        if (!this.hasScript(cwd, "test")) {
          emit({ type: "TOOL_CALL", tool: "shell", summary: "test (no script, skip)" });
          return "success";
        }
        const pm = detectPackageManager(cwd);
        const cmd = getRunCommand(pm, "test");
        emit({ type: "TOOL_CALL", tool: "shell", summary: cmd });
        const result = await runShellCommand(cmd, { cwd, timeoutMs: 120_000, emit });
        return result.success ? "success" : "failure";
      }
      case "coverage":
        // Phase 1: skip.
        emit({ type: "TOOL_CALL", tool: "shell", summary: "coverage (skipped)" });
        return "success";
      case "review":
        // Phase 1: emit placeholder. Phase 2: git diff, real summary.
        emit({ type: "TOOL_CALL", tool: "git", summary: "diff (placeholder)" });
        return "success";
      default:
        return "success";
    }
  }

  private async runAnalyzeStage(
    jobId: string,
    emit: (e: BuildEvent) => void,
    setPlan: (p: PatchPlan | null) => void,
  ): Promise<"success" | "failure" | "cancelled"> {
    if (!this.config.goal || !this.config.router) {
      emit({ type: "TOOL_CALL", tool: "llm", summary: "Analyze (skipped: no goal or router)" });
      return "success";
    }
    emit({ type: "TOOL_CALL", tool: "llm", summary: "Analyze goal and produce plan" });
    const result = await this.config.router.generateObject({
      sessionId: jobId,
      tier: "capable",
      system: ENGINEERING_SYSTEM_PROMPT,
      prompt: `Goal: ${this.config.goal}\n\nProduce a plan of file changes. For each change, specify path (relative to repo root), action (create or edit), and instruction (what to do). Output JSON with a "changes" array.`,
      schema: PatchPlanSchema,
      schemaName: "PatchPlan",
    });
    if (result.isErr()) {
      emit({ type: "ERROR_DETECTED", summary: result.error.message });
      return "failure";
    }
    setPlan(result.value);
    return "success";
  }

  private async runPatchStage(jobId: string, emit: (e: BuildEvent) => void): Promise<"success" | "failure" | "cancelled"> {
    if (!this.plan || !this.config.router) {
      emit({ type: "TOOL_CALL", tool: "llm", summary: "Patch (skipped: no plan or router)" });
      return "success";
    }
    const tools = createCodeTools(this.config.router, jobId, this.config.repoPath);
    for (const change of this.plan.changes) {
      emit({ type: "TOOL_CALL", tool: change.action === "create" ? "code_write_file" : "code_edit_file", summary: change.path });
      const tool = change.action === "create" ? tools.get("code_write_file") : tools.get("code_edit_file");
      if (!tool?.execute) {
        emit({ type: "ERROR_DETECTED", summary: `Tool not found: ${change.action}` });
        return "failure";
      }
      const args = change.action === "create"
        ? { path: change.path, description: change.instruction }
        : { path: change.path, instruction: change.instruction };
      const result = await (tool.execute as (a: unknown) => Promise<unknown>)(args);
      const out = result as { success?: boolean; error?: string };
      if (!out.success) {
        emit({ type: "ERROR_DETECTED", summary: out.error ?? "Patch failed" });
        return "failure";
      }
      emit({ type: "PATCH_APPLIED", summary: change.path, files: [change.path] });
    }
    return "success";
  }

  private hasScript(cwd: string, script: string): boolean {
    try {
      const pkgPath = join(cwd, "package.json");
      if (!existsSync(pkgPath)) return false;
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      return Boolean(pkg.scripts?.[script]);
    } catch {
      return false;
    }
  }

  requestCancel(jobId: string): void {
    this.registry.requestCancel(jobId);
  }
}
