import { tool } from "ai";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\//,
  /mkfs/,
  /dd\s+if=/,
  /:\(\)\{.*\}/,
  /fork\s+bomb/i,
  /curl.*\|\s*(bash|sh|zsh)/,
  /wget.*\|\s*(bash|sh|zsh)/,
];

export const shellTool = tool({
  description:
    "Execute a shell command and return stdout/stderr. Use with caution — only for safe, read-oriented commands unless explicitly required.",
  parameters: z.object({
    command: z.string().describe("Shell command to execute"),
    cwd: z.string().optional().describe("Working directory"),
    timeoutMs: z.number().int().min(100).max(30_000).default(10_000),
  }),
  execute: async ({ command, cwd, timeoutMs }) => {
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return { error: `Command blocked by safety filter: matches pattern ${pattern.source}` };
      }
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      });
      return { stdout: stdout.slice(0, 50_000), stderr: stderr.slice(0, 5_000), exitCode: 0 };
    } catch (e) {
      const error = e as { stdout?: string; stderr?: string; code?: number; message: string };
      return {
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? error.message,
        exitCode: error.code ?? 1,
        error: error.message,
      };
    }
  },
});
