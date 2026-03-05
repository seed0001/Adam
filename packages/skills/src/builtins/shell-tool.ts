import { tool } from "ai";
import { z } from "zod";
import { exec, spawn } from "node:child_process";
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

export type ShellStreamEvent =
  | { type: "LOG_CHUNK"; stream: "stdout" | "stderr"; chunk: string }
  | { type: "ERROR_DETECTED"; summary: string; file?: string; line?: number };

export async function shellStream(
  command: string,
  options: {
    cwd?: string;
    timeoutMs?: number;
    callbacks?: {
      onEvent?: (event: ShellStreamEvent) => void;
      onExit?: (payload: { exitCode: number | null }) => void;
    };
  },
): Promise<{ exitCode: number | null }> {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      options.callbacks?.onEvent?.({
        type: "ERROR_DETECTED",
        summary: `Command blocked by safety filter: matches pattern ${pattern.source}`,
      });
      options.callbacks?.onExit?.({ exitCode: 1 });
      return { exitCode: 1 };
    }
  }

  return await new Promise<{ exitCode: number | null }>((resolve) => {
    const child = spawn(command, {
      cwd: options.cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let finished = false;
    const finish = (exitCode: number | null) => {
      if (finished) return;
      finished = true;
      options.callbacks?.onExit?.({ exitCode });
      resolve({ exitCode });
    };

    const timeout = setTimeout(() => {
      if (!finished) {
        child.kill("SIGTERM");
        options.callbacks?.onEvent?.({
          type: "ERROR_DETECTED",
          summary: `Command timed out after ${options.timeoutMs ?? 120_000}ms`,
        });
      }
    }, options.timeoutMs ?? 120_000);

    child.stdout?.on("data", (buf: Buffer) => {
      options.callbacks?.onEvent?.({
        type: "LOG_CHUNK",
        stream: "stdout",
        chunk: buf.toString(),
      });
    });

    child.stderr?.on("data", (buf: Buffer) => {
      options.callbacks?.onEvent?.({
        type: "LOG_CHUNK",
        stream: "stderr",
        chunk: buf.toString(),
      });
    });

    child.on("error", (err) => {
      options.callbacks?.onEvent?.({
        type: "ERROR_DETECTED",
        summary: err.message,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      finish(code);
    });
  });
}

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
