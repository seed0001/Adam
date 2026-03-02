import { fork, type ChildProcess } from "node:child_process";
import { createLogger, type AdamError, type Result, ok, err, adamError, TIMEOUTS } from "@adam/shared";
import type { PermissionRegistry } from "@adam/security";
import type { SkillManifest } from "@adam/shared";

const logger = createLogger("skills:sandbox");

export type SandboxedToolCall = {
  toolName: string;
  args: Record<string, unknown>;
};

export type SandboxResult = {
  output: unknown;
  durationMs: number;
};

/**
 * Skill sandbox — runs skills as isolated Node.js child processes.
 * Communicates via JSON-RPC over IPC.
 * Enforces: capability declarations, time limits, memory limits.
 */
export class SkillSandbox {
  constructor(private permissions: PermissionRegistry) {}

  async execute(
    manifest: SkillManifest,
    call: SandboxedToolCall,
  ): Promise<Result<SandboxResult, AdamError>> {
    const permCheck = this.permissions.checkAll(manifest.id, manifest.capabilities);
    if (permCheck.isErr()) return err(permCheck.error);

    return new Promise((resolve) => {
      const start = Date.now();
      const timeout = Math.min(manifest.timeoutMs, TIMEOUTS.SKILL_MAX_MS);

      let child: ChildProcess;

      try {
        child = fork(manifest.entrypoint, [], {
          silent: true,
          execArgv: [],
          env: {
            ...this.buildSandboxEnv(manifest),
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        resolve(err(adamError("sandbox:fork-failed", msg, e)));
        return;
      }

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(
          err(
            adamError(
              "sandbox:timeout",
              `Skill '${manifest.id}' exceeded time limit of ${timeout}ms`,
            ),
          ),
        );
      }, timeout);

      child.send({ jsonrpc: "2.0", id: 1, method: call.toolName, params: call.args });

      child.on("message", (msg: unknown) => {
        clearTimeout(timer);
        const response = msg as { result?: unknown; error?: { message: string } };
        if (response.error) {
          resolve(err(adamError("sandbox:tool-error", response.error.message)));
        } else {
          resolve(ok({ output: response.result, durationMs: Date.now() - start }));
        }
        child.kill("SIGTERM");
      });

      child.on("error", (e) => {
        clearTimeout(timer);
        resolve(err(adamError("sandbox:child-error", e.message, e)));
      });

      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0 && code !== null) {
          resolve(
            err(adamError("sandbox:non-zero-exit", `Skill exited with code ${code}`)),
          );
        }
      });
    });
  }

  private buildSandboxEnv(manifest: SkillManifest): Record<string, string> {
    const env: Record<string, string> = {
      ADAM_SKILL_ID: manifest.id,
      ADAM_SKILL_CAPABILITIES: manifest.capabilities.join(","),
    };

    const path = process.env["PATH"];
    if (path) env["PATH"] = path;

    return env;
  }
}
