import { loadConfig, saveConfig } from "../packages/shared/dist/index.js";

const result = loadConfig();
if (result.isErr()) { console.error("Cannot load config:", result.error.message); process.exit(1); }

const config = result.value;

// Disable Groq
config.providers.groq = { ...config.providers.groq, enabled: false };

// Enable xAI with Grok defaults
config.providers.xai = {
  enabled: true,
  defaultModels: {
    fast: "grok-3-fast",
    capable: "grok-3",
  },
};

const save = saveConfig(config);
if (save.isErr()) { console.error("Cannot save config:", save.error.message); process.exit(1); }

console.log("Done — Groq disabled, xAI (Grok-3 / Grok-3-fast) enabled");
