/**
 * Runs Vitest across packages and parses results for the diagnostic dashboard.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  DiagnosticRunResult,
  PackageTestResult,
  SingleTestResult,
  TestResultStatus,
} from "./types.js";

const PACKAGES_WITH_TESTS = [
  "core",
  "shared",
  "memory",
  "security",
  "adapters",
  "models",
  "skills",
  "voice",
  "cli",
];

export function runAllTests(rootDir: string): DiagnosticRunResult {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const packageResults: PackageTestResult[] = [];
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalDuration = 0;

  const outDir = join(rootDir, ".diagnostics");
  try {
    mkdirSync(outDir, { recursive: true });
  } catch {
    /* ignore */
  }

  for (const pkg of PACKAGES_WITH_TESTS) {
    const pkgPath = join(rootDir, "packages", pkg);
    if (!existsSync(join(pkgPath, "package.json"))) continue;

    const outputFile = join(outDir, `vitest-${pkg}-${runId}.json`);
    try {
      const { status } = spawnSync(
        "pnpm",
        ["exec", "vitest", "run", "--reporter=json", `--outputFile=${outputFile}`],
        {
          cwd: pkgPath,
          encoding: "utf-8",
          timeout: 120_000,
        },
      );
    } catch {
      /* spawn error */
    }

    const result = parseVitestOutput(outputFile, pkg);
    packageResults.push(result);
    totalPassed += result.passed;
    totalFailed += result.failed;
    totalSkipped += result.skipped;
    totalDuration += result.durationMs;

    try {
      if (existsSync(outputFile)) unlinkSync(outputFile);
    } catch {
      /* ignore cleanup */
    }
  }

  const completedAt = new Date().toISOString();
  return {
    runId,
    startedAt,
    completedAt,
    packageResults,
    summary: {
      totalPassed,
      totalFailed,
      totalSkipped,
      totalTests: totalPassed + totalFailed + totalSkipped,
      durationMs: totalDuration,
    },
  };
}

function parseVitestOutput(outputPath: string, packageName: string): PackageTestResult {
  const tests: SingleTestResult[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let durationMs = 0;

  if (!existsSync(outputPath)) {
    tests.push({
      name: "Vitest run",
      file: packageName,
      status: "error",
      error: "No output file produced (Vitest may not support --reporter=json in this package)",
    });
    return { package: packageName, passed, failed: 1, skipped, total: 1, durationMs: 0, tests };
  }

  try {
    const raw = readFileSync(outputPath, "utf-8");
    const data = JSON.parse(raw) as VitestJsonReport;
    if (data.testResults) {
      for (const file of data.testResults) {
        const filePath = file.name ?? "unknown";
        for (const test of file.assertionResults ?? []) {
          const status = mapStatus(test.status);
          if (status === "passed") passed++;
          else if (status === "failed") failed++;
          else skipped++;
          const tr: SingleTestResult = {
            name: test.fullName ?? test.title ?? "unknown",
            file: filePath,
            status,
          };
          if (test.duration != null) tr.durationMs = test.duration;
          const errMsg = test.failureMessages?.[0];
          if (errMsg != null) tr.error = errMsg;
          tests.push(tr);
        }
        durationMs += file.endTime && file.startTime ? file.endTime - file.startTime : 0;
      }
    }
  } catch {
    tests.push({
      name: "Vitest run",
      file: packageName,
      status: "error",
      error: "Could not parse Vitest output or tests did not run",
    });
    failed = 1;
  }

  return {
    package: packageName,
    passed,
    failed,
    skipped,
    total: passed + failed + skipped,
    durationMs,
    tests,
  };
}

function mapStatus(s: string | undefined): TestResultStatus {
  if (s === "passed") return "passed";
  if (s === "failed") return "failed";
  if (s === "skipped" || s === "pending") return "skipped";
  if (s === "todo") return "skipped";
  return "error";
}

type VitestJsonReport = {
  testResults?: Array<{
    name?: string;
    startTime?: number;
    endTime?: number;
    assertionResults?: Array<{
      fullName?: string;
      title?: string;
      status?: string;
      duration?: number;
      failureMessages?: string[];
    }>;
  }>;
};
