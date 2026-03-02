import { existsSync, readFileSync } from "node:fs";
import type { Command } from "commander";
import { getDaemonPidFile } from "./start.js";
import { PORTS, ADAM_VERSION } from "@adam/shared";

type HealthData = {
  status: string;
  version: string;
  uptime: number;
  agentName: string;
  profileFacts: number;
};

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function registerStatusCommands(program: Command): void {
  program
    .command("status")
    .description("Show daemon health and system status")
    .action(async () => {
      const { default: chalk } = await import("chalk");

      console.log("");
      console.log(`  ${chalk.bold.cyan("Adam")}  ${chalk.gray(`v${ADAM_VERSION}`)}`);
      console.log(`  ${chalk.gray("─".repeat(42))}`);

      // ── PID file check ──────────────────────────────────────────────────────
      const pidFile = getDaemonPidFile();
      let daemonPid: number | null = null;

      if (existsSync(pidFile)) {
        const raw = readFileSync(pidFile, "utf8").trim();
        const pid = parseInt(raw, 10);
        if (!isNaN(pid) && isProcessAlive(pid)) {
          daemonPid = pid;
        }
      }

      // ── Health endpoint ─────────────────────────────────────────────────────
      let health: HealthData | null = null;
      try {
        const res = await fetch(`http://127.0.0.1:${PORTS.DAEMON}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        health = (await res.json()) as HealthData;
      } catch {
        /* not running */
      }

      if (health) {
        const uptimeMin = Math.floor(health.uptime / 60);
        const uptimeSec = health.uptime % 60;
        const uptimeStr = uptimeMin > 0 ? `${uptimeMin}m ${uptimeSec}s` : `${uptimeSec}s`;

        console.log(
          `\n  ${chalk.green("●")} Daemon      ${chalk.white("running")}` +
            (daemonPid ? chalk.gray(`  ·  PID ${daemonPid}`) : ""),
        );
        console.log(`    ${chalk.gray("Agent:")}      ${chalk.cyan(health.agentName)}`);
        console.log(`    ${chalk.gray("Uptime:")}     ${uptimeStr}`);
        console.log(`    ${chalk.gray("Memories:")}   ${health.profileFacts} profile facts`);
        console.log(
          `    ${chalk.gray("Dashboard:")}  ` + chalk.cyan(`http://localhost:${PORTS.DAEMON}`),
        );
      } else {
        console.log(
          `\n  ${chalk.gray("○")} Daemon      ${chalk.gray("not running")}`,
        );
        console.log(
          `    ${chalk.gray("Run:")} ${chalk.white("adam start")} ${chalk.gray("to start the daemon")}`,
        );
      }

      // ── LuxTTS sidecar ──────────────────────────────────────────────────────
      let ttsOnline = false;
      try {
        const res = await fetch(`http://127.0.0.1:${PORTS.VOICE_SIDECAR}/ping`, {
          signal: AbortSignal.timeout(1500),
        });
        const data = (await res.json()) as { status: string; model_loaded: boolean };
        ttsOnline = true;
        console.log(
          `\n  ${chalk.green("●")} LuxTTS      ${chalk.white(data.model_loaded ? "ready" : "starting")}`,
        );
      } catch {
        /* not running */
      }

      if (!ttsOnline) {
        console.log(`\n  ${chalk.gray("○")} LuxTTS      ${chalk.gray("not running")}`);
      }

      console.log("");
    });
}
