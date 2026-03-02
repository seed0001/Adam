import { defineConfig } from "tsup";

/**
 * Publish build — bundles all @adam/* workspace packages inline.
 * Run: pnpm build:publish
 * Then:  npm publish (from packages/cli)
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
  // Keep native modules and large SDK deps as npm dependencies
  external: [
    "better-sqlite3",
    "keytar",
    "ai",
    "@ai-sdk/anthropic",
    "@ai-sdk/openai",
    "@ai-sdk/google",
    "@ai-sdk/groq",
    "@ai-sdk/mistral",
    "@huggingface/inference",
    "@huggingface/transformers",
    "discord.js",
    "node-telegram-bot-api",
    "drizzle-orm",
    "zod",
    "neverthrow",
    /^node:/,
  ],
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
