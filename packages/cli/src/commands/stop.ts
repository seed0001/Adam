import { existsSync, readFileSync, unlinkSync } from "node:fs";
import type { Command } from "commander";
import { getDaemonPidFile } from "./start.js";
import { PORTS } from "@adam/shared";

async function isDaemonRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORTS.DAEMON}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function registerStopCommand(program: Command): void {
  program
    .command("stop")
    .description("Stop the Adam daemon")
    .action(async () => {
      const { default: chalk } = await import("chalk");
      const { default: ora } = await import("ora");

      const pidFile = getDaemonPidFile();

      if (!existsSync(pidFile)) {
        if (!(await isDaemonRunning())) {
          console.log(chalk.gray("\n  Daemon is not running.\n"));
          return;
        }
        // Running but no PID file — can't kill it
        console.log(chalk.yellow("\n  Daemon is running but no PID file found."));
        console.log(chalk.gray("  Kill it manually or restart your terminal.\n"));
        return;
      }

      const rawPid = readFileSync(pidFile, "utf8").trim();
      const pid = parseInt(rawPid, 10);

      if (isNaN(pid)) {
        unlinkSync(pidFile);
        console.log(chalk.yellow("\n  Corrupt PID file removed.\n"));
        return;
      }

      const spinner = ora({
        text: chalk.gray("Stopping daemon…"),
        color: "cyan",
        indent: 2,
      }).start();

      try {
        process.kill(pid, "SIGTERM");
      } catch {
        unlinkSync(pidFile);
        spinner.warn(chalk.yellow(`Process ${pid} not found — cleaned up PID file.`));
        return;
      }

      // Wait for it to actually die (max 8s)
      const deadline = Date.now() + 8_000;
      let dead = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 300));
        try {
          process.kill(pid, 0); // throws if process is gone
        } catch {
          dead = true;
          break;
        }
      }

      if (existsSync(pidFile)) unlinkSync(pidFile);

      if (dead) {
        spinner.succeed(chalk.green("Daemon stopped.") + chalk.gray(`  (was PID ${pid})\n`));
      } else {
        spinner.warn(chalk.yellow(`Process ${pid} did not exit within 8s. PID file removed.\n`));
      }
    });
}
