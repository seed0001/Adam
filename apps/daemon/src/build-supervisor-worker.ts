#!/usr/bin/env node
/**
 * BuildSupervisor worker — runs as a child process spawned by the daemon.
 * Receives job ID via argv, runs the job, exits when done.
 * See docs/BUILD_SUPERVISOR.md.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { getRawDatabase } from "@adam/memory";
import { ProviderRegistry, ModelRouter } from "@adam/models";
import { BuildSupervisor } from "@adam/core";
import { loadConfig, ADAM_HOME_DIR } from "@adam/shared";
import { vault } from "@adam/security";
import { buildModelPool } from "./model-pool.js";

const jobId = process.argv[2];
if (!jobId) {
  process.stderr.write("Usage: build-supervisor-worker <jobId>\n");
  process.exit(1);
}

const dataDir = join(homedir(), ADAM_HOME_DIR, "data");
const db = getRawDatabase(dataDir);

async function main() {
  const job = db.prepare("SELECT branch, goal FROM jobs WHERE id = ?").get(jobId) as {
    branch: string;
    goal: string | null;
  } | undefined;
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  let router: ModelRouter | undefined;
  const configResult = loadConfig();
  if (configResult.isOk()) {
    const pool = await buildModelPool(configResult.value, vault);
    if (pool.capable.length > 0 || pool.coder.length > 0) {
      const registry = new ProviderRegistry(pool);
      router = new ModelRouter(registry, configResult.value.budget);
    }
  }

  const supervisor = new BuildSupervisor(
    db,
    {
      repoPath: process.cwd(),
      branch: job.branch,
      goal: job.goal,
      router,
    },
    {
      onEvent: (_id, event) => {
        process.stdout.write(JSON.stringify(event) + "\n");
      },
    },
  );

  await supervisor.runExistingJob(jobId);
}

main().catch((e) => {
  process.stderr.write(String(e) + "\n");
  process.exit(1);
});
