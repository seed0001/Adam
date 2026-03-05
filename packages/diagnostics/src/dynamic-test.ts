/**
 * Dynamic test definitions — compile and run user-defined tests against pipeline functions.
 * Tests are defined as JSON and executed in a sandboxed context.
 */

import type { DynamicTestDefinition, DynamicTestResult, TestResultStatus } from "./types.js";

export type DynamicTestStore = {
  tests: DynamicTestDefinition[];
};

const DEFAULT_STORE: DynamicTestStore = { tests: [] };

let store: DynamicTestStore = { ...DEFAULT_STORE };

export function getDynamicTests(): DynamicTestDefinition[] {
  return [...store.tests];
}

export function addDynamicTest(test: DynamicTestDefinition): void {
  store.tests.push(test);
}

export function removeDynamicTest(id: string): void {
  store.tests = store.tests.filter((t) => t.id !== id);
}

export function clearDynamicTests(): void {
  store.tests = [];
}

export function setDynamicTests(tests: DynamicTestDefinition[]): void {
  store.tests = [...tests];
}

/**
 * Run a single dynamic test. Returns result without throwing.
 * Actual execution depends on target — for now we return a placeholder
 * since we cannot safely invoke arbitrary pipeline functions without full daemon context.
 */
export async function runDynamicTest(
  _test: DynamicTestDefinition,
  _context?: { workspace?: string },
): Promise<DynamicTestResult> {
  const start = Date.now();
  const timeoutMs = _test.timeoutMs ?? 5000;

  return new Promise((resolve) => {
    const t = setTimeout(() => {
      resolve({
        testId: _test.id,
        testName: _test.name,
        status: "timeout",
        durationMs: Date.now() - start,
        error: `Test exceeded ${timeoutMs}ms`,
      });
    }, timeoutMs);

    (async () => {
      try {
        // Dynamic tests require daemon context (router, tools, etc.)
        // The daemon will implement actual execution via its own runner
        resolve({
          testId: _test.id,
          testName: _test.name,
          status: "skipped",
          durationMs: Date.now() - start,
          error: "Dynamic test execution requires daemon context — use POST /api/diagnostics/run with testIds",
        });
      } finally {
        clearTimeout(t);
      }
    })();
  });
}

export async function runAllDynamicTests(
  tests: DynamicTestDefinition[],
  context?: { workspace?: string },
): Promise<DynamicTestResult[]> {
  const results: DynamicTestResult[] = [];
  for (const t of tests) {
    results.push(await runDynamicTest(t, context));
  }
  return results;
}
