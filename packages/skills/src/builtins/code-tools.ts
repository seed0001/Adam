import { tool } from "ai";
import { z } from "zod";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import type { ModelTier, Result, AdamError } from "@adam/shared";
import type { CoreTool } from "ai";

/**
 * Minimal interface that the code tools need from the model router.
 * Avoids importing @adam/models (circular dependency risk).
 * ModelRouter satisfies this interface structurally.
 */
export interface CoderRouter {
  generate(opts: {
    sessionId: string;
    tier: ModelTier;
    system?: string;
    prompt: string;
    maxTokens?: number;
  }): Promise<Result<string, AdamError>>;
}

// ── Code Tools ────────────────────────────────────────────────────────────────
//
// These tools implement the "division of labor" architecture:
//
//   Cloud model (Grok / GPT-4o) = senior engineer
//     – decides WHAT to build and WHY
//     – describes intent in plain language
//     – reviews diffs and directs next steps
//
//   Local coder model (DeepSeek Coder V2, Qwen2.5-Coder) = fast junior with root access
//     – receives structured instructions
//     – implements without reasoning about goals
//     – never decides architecture
//     – returns concrete output (file contents, diffs)
//
// The cloud model NEVER touches the filesystem directly through these tools.
// The local coder model NEVER sees the user's conversation or decides what to build.

/**
 * Resolve a path: if absolute, use as-is. If relative, resolve against workspace.
 * This is what prevents "where did Adam put that file?" — all relative paths
 * anchor to the configured workspace directory.
 */
function resolvePath(p: string, workspace: string): string {
  return isAbsolute(p) ? p : join(workspace, p);
}

export function createCodeTools(router: CoderRouter, sessionId: string, workspace: string): Map<string, CoreTool> {
  return new Map<string, CoreTool>([
    ["code_write_file", codeWriteFileTool(router, sessionId, workspace)],
    ["code_edit_file",  codeEditFileTool(router, sessionId, workspace)],
    ["code_scaffold",   codeScaffoldTool(router, sessionId, workspace)],
    ["code_review",     codeReviewTool(router, sessionId, workspace)],
  ]);
}

// ── code_write_file ───────────────────────────────────────────────────────────
// Cloud model describes what the file should do.
// Local coder writes it.

function codeWriteFileTool(router: CoderRouter, sessionId: string, workspace: string): CoreTool {
  return tool({
    description:
      "Write a new file by describing its purpose and requirements. " +
      "You (the planner) specify WHAT the file should do. " +
      "The local code model generates the actual implementation. " +
      "Use this when you need to create a file you've planned but should not implement yourself. " +
      "Relative paths are resolved against the workspace directory.",
    parameters: z.object({
      path: z.string().describe("File path to create. Relative paths resolve against the workspace directory."),
      description: z.string().describe(
        "What this file should do, its interface, key behaviors, and any constraints. " +
        "Be specific about function signatures, exports, and edge cases."
      ),
      language: z.string().optional().describe("Programming language (auto-detected from path if omitted)"),
      context: z.string().optional().describe(
        "Relevant surrounding code, imports, or conventions to match (e.g. paste the package.json or an adjacent file)"
      ),
    }),
    execute: async ({ path, description, language, context }) => {
      const resolvedPath = resolvePath(path, workspace);
      const lang = language ?? inferLanguage(path);
      const contextBlock = context
        ? `\n\nContext from the codebase:\n\`\`\`\n${context.slice(0, 2000)}\n\`\`\``
        : "";

      const result = await router.generate({
        sessionId,
        tier: "coder",
        system: coderSystemPrompt(),
        prompt:
          `Write the complete contents of a ${lang} file.\n\n` +
          `File path: ${resolvedPath}\n\n` +
          `Requirements:\n${description}` +
          contextBlock +
          `\n\nReturn ONLY the file contents. No explanation, no markdown fences, no preamble.`,
      });

      if (result.isErr()) {
        return { success: false, error: result.error.message };
      }

      const content = stripCodeFences(result.value);
      ensureDir(resolvedPath);
      writeFileSync(resolvedPath, content, "utf-8");
      const lines = content.split("\n").length;

      return {
        success: true,
        path: resolvedPath,
        lines_written: lines,
        preview: content.slice(0, 300),
      };
    },
  });
}

// ── code_edit_file ────────────────────────────────────────────────────────────
// Cloud model describes what to change.
// Local coder reads the file, applies the change, returns the diff.

function codeEditFileTool(router: CoderRouter, sessionId: string, workspace: string): CoreTool {
  return tool({
    description:
      "Edit an existing file by describing the change you want made. " +
      "You (the planner) specify WHAT to change and WHY. " +
      "The local code model reads the current file, applies your described change, and writes it back. " +
      "Returns a before/after summary so you can review what changed.",
    parameters: z.object({
      path: z.string().describe("Path to the file to edit"),
      instruction: z.string().describe(
        "Precise description of what to change. Describe the target location and the intended outcome. " +
        "E.g. 'Add error handling to the fetchUser function — if the API returns 404, throw a UserNotFoundError'"
      ),
    }),
    execute: async ({ path, instruction }) => {
      const resolvedPath = resolvePath(path, workspace);
      if (!existsSync(resolvedPath)) {
        return { success: false, error: `File not found: ${resolvedPath}` };
      }

      const original = readFileSync(resolvedPath, "utf-8");
      const lang = inferLanguage(path);

      const result = await router.generate({
        sessionId,
        tier: "coder",
        system: coderSystemPrompt(),
        prompt:
          `Edit the following ${lang} file based on the instruction.\n\n` +
          `File path: ${resolvedPath}\n\n` +
          `Instruction: ${instruction}\n\n` +
          `Current file contents:\n\`\`\`${lang}\n${original}\n\`\`\`\n\n` +
          `Return ONLY the complete updated file contents. No explanation, no markdown fences.`,
      });

      if (result.isErr()) {
        return { success: false, error: result.error.message };
      }

      const updated = stripCodeFences(result.value);
      writeFileSync(resolvedPath, updated, "utf-8");

      const beforeLines = original.split("\n").length;
      const afterLines = updated.split("\n").length;
      const diffSummary = buildDiffSummary(original, updated);

      return {
        success: true,
        path: resolvedPath,
        before_lines: beforeLines,
        after_lines: afterLines,
        delta: afterLines - beforeLines,
        diff_summary: diffSummary,
        preview_after: updated.slice(0, 400),
      };
    },
  });
}

// ── code_scaffold ─────────────────────────────────────────────────────────────
// Cloud model provides a project spec.
// Local coder generates the file tree, one file at a time.

function codeScaffoldTool(router: CoderRouter, sessionId: string, workspace: string): CoreTool {
  return tool({
    description:
      "Scaffold a new project or directory structure from a specification. " +
      "You (the planner) describe what the project should be — tech stack, purpose, file structure, key files. " +
      "The local code model generates each file. " +
      "Returns a list of created files.",
    parameters: z.object({
      directory: z.string().describe("Root directory to scaffold into. Relative paths resolve against the workspace directory."),
      spec: z.string().describe(
        "Complete project specification: purpose, tech stack, architecture, list of files with descriptions. " +
        "Be explicit about the file tree — the coder will generate exactly what you list."
      ),
      file_list: z.array(z.object({
        path: z.string().describe("File path relative to the directory"),
        description: z.string().describe("What this file contains"),
      })).describe("Explicit list of files to create"),
    }),
    execute: async ({ directory, spec, file_list }) => {
      const resolvedDir = resolvePath(directory, workspace);
      if (!existsSync(resolvedDir)) mkdirSync(resolvedDir, { recursive: true });

      const created: string[] = [];
      const errors: string[] = [];

      for (const file of file_list) {
        const fullPath = join(resolvedDir, file.path);
        const lang = inferLanguage(file.path);

        const result = await router.generate({
          sessionId,
          tier: "coder",
          system: coderSystemPrompt(),
          prompt:
            `Project spec:\n${spec}\n\n` +
            `Write the complete ${lang} file at: ${file.path}\n\n` +
            `This file's role: ${file.description}\n\n` +
            `Return ONLY the file contents. No explanation, no markdown fences.`,
        });

        if (result.isErr()) {
          errors.push(`${file.path}: ${result.error.message}`);
          continue;
        }

        const content = stripCodeFences(result.value);
        ensureDir(fullPath);
        writeFileSync(fullPath, content, "utf-8");
        created.push(file.path);
      }

      return {
        success: errors.length === 0,
        directory: resolvedDir,
        created,
        errors,
        total: file_list.length,
      };
    },
  });
}

// ── code_review ───────────────────────────────────────────────────────────────
// Local coder reads and evaluates a file, returns structured assessment.

function codeReviewTool(router: CoderRouter, sessionId: string, workspace: string): CoreTool {
  return tool({
    description:
      "Have the local code model review a file and answer a specific question about it. " +
      "Useful for checking if the generated code looks correct before proceeding, " +
      "or for asking targeted questions like 'does this handle null inputs?' or 'are imports correct?'",
    parameters: z.object({
      path: z.string().describe("Path to the file to review"),
      question: z.string().describe("Specific question to answer about the code"),
    }),
    execute: async ({ path, question }) => {
      const resolvedPath = resolvePath(path, workspace);
      if (!existsSync(resolvedPath)) {
        return { success: false, error: `File not found: ${resolvedPath}` };
      }

      const content = readFileSync(resolvedPath, "utf-8");
      const lang = inferLanguage(path);

      const result = await router.generate({
        sessionId,
        tier: "coder",
        system:
          "You are a precise code reviewer. Answer the question about the code directly and concisely. " +
          "Flag any bugs, edge cases, or missing logic relevant to the question. Be direct.",
        prompt:
          `File: ${resolvedPath}\n\n` +
          `\`\`\`${lang}\n${content.slice(0, 4000)}\n\`\`\`\n\n` +
          `Question: ${question}`,
      });

      if (result.isErr()) {
        return { success: false, error: result.error.message };
      }

      return {
        success: true,
        path,
        assessment: result.value,
      };
    },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function coderSystemPrompt(): string {
  return (
    "You are a code implementation engine. " +
    "You receive precise instructions from a senior engineer and execute them exactly. " +
    "You do not reason about goals, suggest architecture changes, or add unrequested features. " +
    "You output code only — no explanation, no commentary, no markdown fences unless explicitly asked. " +
    "Match the style and conventions of any existing code shown to you."
  );
}

function inferLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", rs: "rust", go: "go", java: "java", cs: "csharp",
    cpp: "cpp", c: "c", rb: "ruby", php: "php", swift: "swift",
    kt: "kotlin", sh: "bash", yaml: "yaml", yml: "yaml",
    json: "json", md: "markdown", css: "css", html: "html",
    sql: "sql", toml: "toml",
  };
  return map[ext] ?? ext ?? "text";
}

function stripCodeFences(text: string): string {
  // Remove opening fence with optional language tag
  let s = text.trim();
  s = s.replace(/^```[a-zA-Z]*\n?/, "");
  s = s.replace(/\n?```$/, "");
  return s.trimEnd();
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function buildDiffSummary(before: string, after: string): string {
  const bLines = before.split("\n");
  const aLines = after.split("\n");
  const added = aLines.filter((l) => !bLines.includes(l)).length;
  const removed = bLines.filter((l) => !aLines.includes(l)).length;
  return `+${added} lines added, -${removed} lines removed`;
}
