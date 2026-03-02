import { defineConfig } from "tsup";

/**
 * Monorepo dev build — runs from packages/cli linked globally via pnpm.
 * All dependencies are resolved from node_modules; nothing needs to be bundled.
 *
 * Key: `platform: "node"` tells esbuild this is a Node.js binary, which
 * prevents the CJS-to-ESM shim from trying to require() Node built-ins
 * (the root cause of "Dynamic require of events is not supported").
 */
export default defineConfig({
  entry: {
    bin: "src/bin.ts",
    index: "src/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  platform: "node",
  // Everything lives in monorepo node_modules — no bundling needed.
  // Marking them external skips the CJS interop entirely.
  external: [
    // CLI helpers
    "commander",
    "inquirer",
    "chalk",
    "ora",
    // All workspace packages resolve via pnpm symlinks
    /^@adam\//,
    // AI SDK
    "ai",
    /^@ai-sdk\//,
    "@openrouter/ai-sdk-provider",
    // ORM + DB
    "better-sqlite3",
    "drizzle-orm",
    // Adapters
    "discord.js",
    "grammy",
    "@huggingface/transformers",
    // Vault
    "keytar",
    // Utilities
    "zod",
    "neverthrow",
    // Node built-ins
    /^node:/,
  ],
});
