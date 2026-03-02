import type { Command } from "commander";

export function registerStatusCommands(program: Command): void {
  program
    .command("status")
    .description("Show daemon health and system status")
    .action(async () => {
      const { default: chalk } = await import("chalk");
      const { PORTS } = await import("@adam/shared");

      console.warn(chalk.bold("\nAdam Status\n"));

      try {
        const res = await fetch(`http://localhost:${PORTS.DAEMON}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        const data = (await res.json()) as Record<string, unknown>;
        console.warn(chalk.green("Daemon:"), chalk.white("running"));
        console.warn(chalk.gray(JSON.stringify(data, null, 2)));
      } catch {
        console.warn(chalk.yellow("Daemon:"), chalk.gray("not running"));
      }

      try {
        const res = await fetch(`http://localhost:${PORTS.VOICE_SIDECAR}/ping`, {
          signal: AbortSignal.timeout(2000),
        });
        const data = (await res.json()) as { status: string; model_loaded: boolean };
        console.warn(
          chalk.green("LuxTTS sidecar:"),
          chalk.white(data.model_loaded ? "ready (model loaded)" : "running (model not yet loaded)"),
        );
      } catch {
        console.warn(chalk.gray("LuxTTS sidecar:"), chalk.gray("not running"));
      }

      console.warn("");
    });
}
