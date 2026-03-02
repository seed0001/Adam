import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AdamConfigSchema,
  DaemonConfigSchema,
  OllamaConfigSchema,
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  loadConfigOrDefault,
  updateConfig,
  configExists,
  getConfigPath,
} from "../index.js";

// ── Schema tests (no I/O) ──────────────────────────────────────────────────────

describe("AdamConfigSchema", () => {
  it("parses an empty object using all defaults", () => {
    const result = AdamConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("produces the expected defaults", () => {
    const config = AdamConfigSchema.parse({});
    expect(config.version).toBe("1");
    expect(config.daemon.agentName).toBe("Adam");
    expect(config.daemon.logLevel).toBe("info");
    expect(config.adapters.cli.enabled).toBe(true);
    expect(config.providers.ollama.enabled).toBe(false);
    expect(config.budget.fallbackToLocalOnExhaustion).toBe(true);
  });

  it("rejects an invalid logLevel", () => {
    const result = AdamConfigSchema.safeParse({
      daemon: { logLevel: "verbose" },
    });
    expect(result.success).toBe(false);
  });
});

describe("DaemonConfigSchema", () => {
  it("rejects a port below 1024", () => {
    const result = DaemonConfigSchema.safeParse({ port: 80 });
    expect(result.success).toBe(false);
  });

  it("rejects a port above 65535", () => {
    const result = DaemonConfigSchema.safeParse({ port: 70000 });
    expect(result.success).toBe(false);
  });

  it("accepts a valid port", () => {
    const result = DaemonConfigSchema.safeParse({ port: 8080 });
    expect(result.success).toBe(true);
  });
});

describe("OllamaConfigSchema", () => {
  it("rejects a non-URL baseUrl", () => {
    const result = OllamaConfigSchema.safeParse({ enabled: true, baseUrl: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("accepts a valid URL", () => {
    const result = OllamaConfigSchema.safeParse({
      enabled: true,
      baseUrl: "http://localhost:11434",
    });
    expect(result.success).toBe(true);
  });
});

describe("DEFAULT_CONFIG", () => {
  it("is a valid AdamConfig", () => {
    const result = AdamConfigSchema.safeParse(DEFAULT_CONFIG);
    expect(result.success).toBe(true);
  });

  it("has only Ollama enabled", () => {
    expect(DEFAULT_CONFIG.providers.ollama.enabled).toBe(true);
    expect(DEFAULT_CONFIG.providers.anthropic.enabled).toBe(false);
    expect(DEFAULT_CONFIG.providers.openai.enabled).toBe(false);
  });
});

// ── Config loader tests (I/O via temp dir + ADAM_CONFIG env var) ──────────────

let tempDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  tempDir = join(tmpdir(), `adam-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  originalEnv = process.env["ADAM_CONFIG"];
  process.env["ADAM_CONFIG"] = join(tempDir, "config.json");
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env["ADAM_CONFIG"];
  } else {
    process.env["ADAM_CONFIG"] = originalEnv;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("configExists", () => {
  it("returns false when no config file exists", () => {
    expect(configExists()).toBe(false);
  });

  it("returns true after saving a config", () => {
    saveConfig(DEFAULT_CONFIG);
    expect(configExists()).toBe(true);
  });
});

describe("getConfigPath", () => {
  it("returns the ADAM_CONFIG env var path when set", () => {
    expect(getConfigPath()).toBe(join(tempDir, "config.json"));
  });
});

describe("loadConfig", () => {
  it("returns config:not-found when file is missing", () => {
    const result = loadConfig();
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("config:not-found");
  });

  it("returns config:parse-failed for invalid JSON", () => {
    writeFileSync(join(tempDir, "config.json"), "{ not valid json", "utf-8");
    const result = loadConfig();
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("config:parse-failed");
  });

  it("returns config:validation-failed for JSON that fails Zod", () => {
    writeFileSync(
      join(tempDir, "config.json"),
      JSON.stringify({ daemon: { port: 50 } }),
      "utf-8",
    );
    const result = loadConfig();
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("config:validation-failed");
  });

  it("successfully loads a valid config", () => {
    saveConfig(DEFAULT_CONFIG);
    const result = loadConfig();
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().version).toBe("1");
  });
});

describe("saveConfig", () => {
  it("creates the directory if it does not exist", () => {
    const nested = join(tempDir, "nested", "deep");
    process.env["ADAM_CONFIG"] = join(nested, "config.json");
    const result = saveConfig(DEFAULT_CONFIG);
    expect(result.isOk()).toBe(true);
    expect(existsSync(join(nested, "config.json"))).toBe(true);
  });
});

describe("loadConfigOrDefault", () => {
  it("returns DEFAULT_CONFIG when file is missing", () => {
    const config = loadConfigOrDefault();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("returns the saved config when file exists", () => {
    const modified = AdamConfigSchema.parse({
      daemon: { agentName: "TestBot" },
    });
    saveConfig(modified);
    const loaded = loadConfigOrDefault();
    expect(loaded.daemon.agentName).toBe("TestBot");
  });
});

describe("updateConfig", () => {
  it("applies the updater and persists the change", () => {
    const result = updateConfig((c) => ({
      ...c,
      daemon: { ...c.daemon, agentName: "Eve" },
    }));
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().daemon.agentName).toBe("Eve");

    const reloaded = loadConfig();
    expect(reloaded._unsafeUnwrap().daemon.agentName).toBe("Eve");
  });

  it("identity updater round-trips without loss", () => {
    saveConfig(DEFAULT_CONFIG);
    const result = updateConfig((c) => c);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(DEFAULT_CONFIG);
  });
});
