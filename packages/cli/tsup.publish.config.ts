import { defineConfig } from "tsup";

/**
 * Publish build — bundles all @adam/* workspace packages inline.
 * Run: pnpm build:publish
 * Then: npm publish  (from packages/cli)
 */
export default defineConfig({
  entry: {
    bin: "src/bin.ts",
    daemon: "src/daemon-entry.ts",
  },
  format: ["esm"],
  bundle: true,
  clean: true,
  outDir: "dist",
  // These are declared as npm dependencies and must NOT be inlined
  external: [
    // Native / large — installed as npm deps
    "better-sqlite3",
    "keytar",
    // AI SDK
    "ai",
    "@ai-sdk/anthropic",
    "@ai-sdk/openai",
    "@ai-sdk/google",
    "@ai-sdk/groq",
    "@ai-sdk/mistral",
    "@ai-sdk/deepseek",
    "@openrouter/ai-sdk-provider",
    "@huggingface/transformers",
    // ORM
    "drizzle-orm",
    // Adapters
    "discord.js",
    "grammy",
    // Utilities declared as deps
    "zod",
    "neverthrow",
    // Node built-ins
    /^node:/,
  ],
  // All @adam/* workspace packages are inlined — they aren't published separately
  noExternal: [
    "@adam/shared",
    "@adam/security",
    "@adam/memory",
    "@adam/models",
    "@adam/core",
    "@adam/skills",
    "@adam/voice",
    "@adam/adapters",
    "@adam/daemon",
  ],
});
