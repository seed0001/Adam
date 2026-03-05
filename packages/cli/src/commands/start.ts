import { existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import type { Command } from "commander";
import { ADAM_HOME_DIR, PORTS } from "@adam/shared";

export function getDaemonPidFile(): string {
  return join(homedir(), ADAM_HOME_DIR, "daemon.pid");
}

function findDaemonScript(): string | null {
  const __dir = dirname(fileURLToPath(import.meta.url));

  // monorepo dev: packages/cli/dist/ → ../../.. → workspace root → apps/daemon/dist
  const mono = join(__dir, "..", "..", "..", "apps", "daemon", "dist", "index.js");
  if (existsSync(mono)) return mono;

  // npm install: daemon bundled alongside CLI as dist/daemon.js
  const bundled = join(__dir, "daemon.js");
  if (existsSync(bundled)) return bundled;

  return null;
}

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

export function registerStartCommand(program: Command): void {
  program
    .command("start")
    .description("Start the Adam daemon in the background")
    .option("-f, --foreground", "Run in the foreground (attached, for debugging)")
    .action(async (opts: { foreground?: boolean }) => {
      const { default: chalk } = await import("chalk");
      const { default: ora } = await import("ora");

      if (await isDaemonRunning()) {
        console.log(chalk.green("\n  Adam daemon is already running."));
        console.log(chalk.gray(`  Dashboard → `) + chalk.cyan(`http://localhost:${PORTS.DAEMON}\n`));
        return;
      }

      const daemonPath = findDaemonScript();
      if (!daemonPath) {
        console.error(chalk.red("\n  Cannot find daemon binary."));
        console.error(chalk.gray("  Run: ") + chalk.white("pnpm build") + chalk.gray(" first.\n"));
        process.exit(1);
      }

      const adamHome = join(homedir(), ADAM_HOME_DIR);
      const logsDir = join(adamHome, "logs");
      mkdirSync(logsDir, { recursive: true });
      const logFile = join(logsDir, "daemon.log");

      if (opts.foreground) {
        const { spawnSync } = await import("node:child_process");
        spawnSync(process.execPath, [daemonPath], { stdio: "inherit" });
        return;
      }

      const spinner = ora({
        text: chalk.gray("Starting daemon…"),
        color: "cyan",
        indent: 2,
      }).start();

      const logFd = openSync(logFile, "a");
      const child = spawn(process.execPath, [daemonPath], {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: { ...process.env },
      });
      child.unref();

      writeFileSync(getDaemonPidFile(), String(child.pid));

      // Poll health endpoint — 15s timeout
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 600));
        if (await isDaemonRunning()) {
          spinner.succeed(
            chalk.green("Daemon started") +
              chalk.gray(`  ·  PID ${child.pid}`),
          );
          console.log(
            chalk.gray("\n  Dashboard  → ") + chalk.cyan(`http://localhost:${PORTS.DAEMON}`),
          );
          console.log(chalk.gray("  Logs       → ") + chalk.gray(logFile) + "\n");
          return;
        }
      }

      spinner.fail(chalk.red("Daemon did not start within 15s."));
      console.error(chalk.gray("  Check logs: ") + chalk.white(logFile) + "\n");
      process.exit(1);
    });
}
