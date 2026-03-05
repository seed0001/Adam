/**
 * Analyzes the Adam codebase — discovers modules, exports, imports.
 * Uses regex-based parsing (no heavy AST deps) for fast, lightweight analysis.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { CodebaseAnalysis, ModuleExport, ModuleInfo } from "./types.js";

const EXCLUDE_DIRS = new Set(["node_modules", "dist", ".git", "coverage", "__tests__"]);
const SOURCE_EXT = /\.(ts|tsx|js|jsx)$/;

const EXPORT_PATTERNS = [
  { kind: "function" as const, re: /^\s*export\s+function\s+(\w+)/gm },
  { kind: "function" as const, re: /^\s*export\s+async\s+function\s+(\w+)/gm },
  { kind: "class" as const, re: /^\s*export\s+class\s+(\w+)/gm },
  { kind: "const" as const, re: /^\s*export\s+const\s+(\w+)/gm },
  { kind: "type" as const, re: /^\s*export\s+type\s+(\w+)/gm },
  { kind: "interface" as const, re: /^\s*export\s+interface\s+(\w+)/gm },
];

const IMPORT_RE = /^\s*import\s+.*from\s+['"]([^'"]+)['"]/gm;

function* walkDir(dir: string, root: string): Generator<string> {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    const rel = relative(root, full);
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      yield* walkDir(full, root);
    } else if (e.isFile() && SOURCE_EXT.test(e.name)) {
      yield rel;
    }
  }
}

function getLineNumber(content: string, matchIndex: number): number {
  return content.slice(0, matchIndex).split("\n").length;
}

function extractExports(content: string): ModuleExport[] {
  const exports: ModuleExport[] = [];
  const seen = new Set<string>();

  for (const { kind, re } of EXPORT_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const name = m[1];
      if (name && !seen.has(name)) {
        seen.add(name);
        exports.push({ kind, name, line: getLineNumber(content, m.index) });
      }
    }
  }
  return exports;
}

function extractImports(content: string): string[] {
  const imports: string[] = [];
  const seen = new Set<string>();
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const spec = m[1];
    if (spec && !seen.has(spec) && !spec.startsWith(".") && !spec.startsWith("/")) {
      const pkg = spec.startsWith("@") ? spec.split("/")[0] + "/" + (spec.split("/")[1] ?? "") : spec.split("/")[0];
      if (pkg && pkg !== "node") {
        seen.add(pkg);
        imports.push(pkg);
      }
    }
  }
  return [...seen];
}

function getPackageName(filePath: string, _root: string): string {
  const parts = filePath.split(/[/\\]/);
  if (parts[0]) return parts[0];
  return "root";
}

export function analyzeCodebase(rootDir: string): CodebaseAnalysis {
  const modules: ModuleInfo[] = [];
  const packagePaths = new Map<string, string>();

  for (const rel of walkDir(join(rootDir, "packages"), join(rootDir, "packages"))) {
    const fullPath = join(rootDir, "packages", rel);
    const content = readFileSync(fullPath, "utf-8");
    const exports = extractExports(content);
    const imports = extractImports(content);
    const pkg = getPackageName(rel, rootDir);
    if (!packagePaths.has(pkg)) packagePaths.set(pkg, join(rootDir, "packages", pkg));
    if (exports.length > 0) {
      modules.push({
        path: rel,
        packageName: pkg,
        exports,
        imports,
      });
    }
  }

  for (const rel of walkDir(join(rootDir, "apps"), join(rootDir, "apps"))) {
    const fullPath = join(rootDir, "apps", rel);
    const content = readFileSync(fullPath, "utf-8");
    const exports = extractExports(content);
    const imports = extractImports(content);
    const pkg = getPackageName(rel, rootDir);
    if (!packagePaths.has(pkg)) packagePaths.set(pkg, join(rootDir, "apps", pkg));
    if (exports.length > 0) {
      modules.push({
        path: rel,
        packageName: pkg,
        exports,
        imports,
      });
    }
  }

  const packages: { name: string; path: string; hasTests: boolean }[] = [];
  function hasTestFiles(dir: string): boolean {
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) { if (hasTestFiles(full)) return true; }
        else if (e.name.endsWith(".test.ts") || e.name.endsWith(".test.tsx")) return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }
  for (const [name, path] of packagePaths) {
    let hasTests = false;
    try {
      if (statSync(path).isDirectory()) {
        hasTests = hasTestFiles(path);
        if (!hasTests) {
          const srcDir = join(path, "src");
          if (statSync(srcDir).isDirectory()) hasTests = hasTestFiles(srcDir);
        }
      }
    } catch {
      /* path or src may not exist */
    }
    packages.push({ name, path, hasTests });
  }

  return {
    modules,
    packages,
    totalExports: modules.reduce((s, m) => s + m.exports.length, 0),
    totalModules: modules.length,
    analyzedAt: new Date().toISOString(),
  };
}
