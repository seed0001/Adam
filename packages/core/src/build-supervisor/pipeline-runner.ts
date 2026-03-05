import { existsSync } from "node:fs";
import { join } from "node:path";
import { shellStream } from "@adam/skills";
import type { BuildEvent } from "./types.js";
import { ErrorClassifier } from "./error-classifier.js";

/**
 * Run a shell command, stream output, classify errors on failure.
 * Supervisor controls progression; this is the deterministic execution layer.
 */
export async function runShellCommand(
  command: string,
  options: {
    cwd: string;
    timeoutMs?: number;
    emit: (e: BuildEvent) => void;
  },
): Promise<{ success: boolean }> {
  const stderrChunks: string[] = [];
  const stdoutChunks: string[] = [];

  const { exitCode } = await shellStream(command, {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 120_000,
    callbacks: {
      onEvent: (event) => {
        if (event.type === "LOG_CHUNK") {
          options.emit(event);
          if (event.stream === "stderr") stderrChunks.push(event.chunk);
          else stdoutChunks.push(event.chunk);
        } else if (event.type === "ERROR_DETECTED") {
          options.emit(event);
        }
      },
      onExit: () => {},
    },
  });

  const success = exitCode === 0;
  if (!success) {
    const combined = [...stderrChunks, ...stdoutChunks].join("");
    const classifier = new ErrorClassifier();
    const errorEvents = classifier.classify(combined);
    for (const e of errorEvents) {
      options.emit(e);
    }
    if (errorEvents.length === 0) {
      options.emit({
        type: "ERROR_DETECTED",
        summary: `Command failed with exit code ${exitCode ?? "unknown"}`,
      });
    }
  }
  return { success };
}

export type PackageManager = "pnpm" | "npm" | "yarn";

export function detectPackageManager(repoPath: string): PackageManager {
  if (existsSync(join(repoPath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(repoPath, "pnpm-workspace.yaml"))) return "pnpm";
  if (existsSync(join(repoPath, "yarn.lock"))) return "yarn";
  return "npm";
}

export function getInstallCommand(pm: PackageManager): string {
  switch (pm) {
    case "pnpm":
      return "pnpm install";
    case "yarn":
      return "yarn install";
    default:
      return "npm install";
  }
}

export function getRunCommand(pm: PackageManager, script: string): string {
  switch (pm) {
    case "pnpm":
      return `pnpm run ${script}`;
    case "yarn":
      return `yarn ${script}`;
    default:
      return `npm run ${script}`;
  }
}

/** Branch names: alphanumeric, dash, underscore, slash. Prevents shell injection. */
const BRANCH_REGEX = /^[a-zA-Z0-9/_.-]+$/;

function sanitizeBranch(branch: string): string {
  if (!BRANCH_REGEX.test(branch)) {
    throw new Error(`Invalid branch name: ${branch}`);
  }
  return branch;
}

/**
 * Git checkout: try checkout first (branch exists), else create with -b.
 */
export async function runGitCheckout(
  branch: string,
  cwd: string,
  emit: (e: BuildEvent) => void,
): Promise<{ success: boolean }> {
  const safe = sanitizeBranch(branch);
  const checkoutExisting = await runShellCommand(`git checkout "${safe}"`, { cwd, emit });
  if (checkoutExisting.success) return { success: true };
  return runShellCommand(`git checkout -b "${safe}"`, { cwd, emit });
}
