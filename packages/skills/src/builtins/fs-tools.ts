import { tool } from "ai";
import { z } from "zod";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { homedir } from "node:os";

const ALLOWED_ROOTS = [homedir(), process.cwd()];

function isSafePath(filePath: string): boolean {
  const resolved = resolve(filePath);
  return ALLOWED_ROOTS.some((root) => {
    const rel = relative(root, resolved);
    return !rel.startsWith("..") && !rel.startsWith("/");
  });
}

export const readFileTool = tool({
  description: "Read the contents of a file. Only files within the home directory or current working directory are accessible.",
  parameters: z.object({
    path: z.string().describe("Absolute or relative file path"),
    encoding: z.enum(["utf8", "base64"]).default("utf8"),
  }),
  execute: async ({ path: filePath, encoding }) => {
    if (!isSafePath(filePath)) {
      return { error: `Access denied: path '${filePath}' is outside allowed directories` };
    }
    try {
      const content = await readFile(filePath, encoding);
      return { content, path: filePath };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },
});

export const writeFileTool = tool({
  description: "Write content to a file. Creates parent directories if needed. Only writes within the home directory or current working directory.",
  parameters: z.object({
    path: z.string().describe("Absolute or relative file path"),
    content: z.string().describe("Content to write"),
    append: z.boolean().default(false).describe("Append to file instead of overwriting"),
  }),
  execute: async ({ path: filePath, content, append }) => {
    if (!isSafePath(filePath)) {
      return { error: `Access denied: path '${filePath}' is outside allowed directories` };
    }
    try {
      const { mkdirSync } = await import("node:fs");
      const { dirname } = await import("node:path");
      mkdirSync(dirname(filePath), { recursive: true });

      if (append) {
        const existing = await readFile(filePath, "utf8").catch(() => "");
        await writeFile(filePath, existing + content, "utf8");
      } else {
        await writeFile(filePath, content, "utf8");
      }

      return { success: true, path: filePath };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },
});

export const listDirectoryTool = tool({
  description: "List the contents of a directory.",
  parameters: z.object({
    path: z.string().describe("Directory path"),
    recursive: z.boolean().default(false).describe("List recursively"),
  }),
  execute: async ({ path: dirPath, recursive }) => {
    if (!isSafePath(dirPath)) {
      return { error: `Access denied: path '${dirPath}' is outside allowed directories` };
    }
    try {
      const entries = await readdir(dirPath, { withFileTypes: true, recursive });
      return {
        path: dirPath,
        entries: entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "directory" : "file",
          path: join(dirPath, e.name),
        })),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },
});
