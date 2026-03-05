import { createLogger } from "@adam/shared";
import type { BuildEvent } from "./types.js";

const logger = createLogger("core:error-classifier");

/**
 * Parse tool output and extract structured ERROR_DETECTED events.
 * TypeScript, Jest/Vitest, ESLint — deterministic extraction for stable retries.
 * See docs/BUILD_SUPERVISOR.md.
 */
export class ErrorClassifier {
  /**
   * Parse text (e.g. stderr from tsc, jest, eslint) and emit ERROR_DETECTED events.
   */
  classify(text: string): BuildEvent[] {
    const events: BuildEvent[] = [];

    // TypeScript: "src/foo.ts(12,5): error TS2345: ..."
    const tsRe = /([^(]+)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)/g;
    let m: RegExpExecArray | null;
    while ((m = tsRe.exec(text)) !== null) {
      const file = m[1]?.trim();
      const line = parseInt(m[2] ?? "0", 10);
      const code = m[4] ?? "TS";
      const msg = (m[5] ?? "").trim();
      events.push({
        type: "ERROR_DETECTED",
        summary: `${code}: ${msg}`,
        ...(file ? { file } : {}),
        line,
      });
    }

    // Jest/Vitest: "  at Object.<anonymous> (src/foo.ts:12:5)"
    const jestAtRe = /at\s+(?:Object\.<anonymous>|.*?)\s*\(([^:]+):(\d+):(\d+)\)/g;
    while ((m = jestAtRe.exec(text)) !== null) {
      const file = (m[1] ?? "").trim();
      const line = parseInt(m[2] ?? "0", 10);
      // Avoid duplicates if we already got this from TS
      if (!events.some((e) => e.type === "ERROR_DETECTED" && e.file === file && e.line === line)) {
        events.push({
          type: "ERROR_DETECTED",
          summary: `Test failure at ${file}:${line}`,
          ...(file ? { file } : {}),
          line,
        });
      }
    }

    // ESLint: " 12:5  error  'x' is assigned but never used  @typescript-eslint/no-unused-vars"
    const eslintRe = /^\s*(\d+):(\d+)\s+error\s+(.+?)(?:\s+[\w/-]+)?$/gm;
    while ((m = eslintRe.exec(text)) !== null) {
      const line = parseInt(m[1] ?? "0", 10);
      const msg = (m[3] ?? "").trim();
      // ESLint output often includes file path on previous line; we don't have it here
      events.push({
        type: "ERROR_DETECTED",
        summary: `ESLint: ${msg}`,
        line,
      });
    }

    // Generic: "Error: ..." or "error: ..." when nothing else matched
    if (events.length === 0) {
      const genericRe = /(?:Error|error):\s*(.+)/g;
      while ((m = genericRe.exec(text)) !== null) {
        const summary = (m[1] ?? "").trim().slice(0, 200);
        events.push({
          type: "ERROR_DETECTED",
          summary,
        });
      }
    }

    if (events.length > 0) {
      logger.debug("ErrorClassifier extracted events", { count: events.length });
    }
    return events;
  }
}
