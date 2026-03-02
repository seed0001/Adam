import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { AdamConfigSchema, DEFAULT_CONFIG, type AdamConfig } from "./config.js";
import { ADAM_HOME_DIR } from "./constants.js";
import { adamError, trySync, type Result, type AdamError } from "./result.js";
import { ok, err } from "neverthrow";

/**
 * Returns the absolute path to `~/.adam/config.json`.
 * Can be overridden via the `ADAM_CONFIG` environment variable for testing.
 */
export function getConfigPath(): string {
  return process.env["ADAM_CONFIG"] ?? join(homedir(), ADAM_HOME_DIR, "config.json");
}

/** Returns `~/.adam` (or the directory containing the config file). */
export function getAdamHome(): string {
  return dirname(getConfigPath());
}

/** Checks whether a config file exists at the expected path. */
export function configExists(): boolean {
  return existsSync(getConfigPath());
}

/**
 * Reads and validates config from `~/.adam/config.json`.
 *
 * Returns `Ok<AdamConfig>` on success, `Err<AdamError>` if the file is
 * missing, unreadable, or fails Zod validation.
 */
export function loadConfig(): Result<AdamConfig, AdamError> {
  const path = getConfigPath();

  if (!existsSync(path)) {
    return err(
      adamError(
        "config:not-found",
        `Config file not found at ${path}. Run \`adam init\` to set up Adam.`,
      ),
    );
  }

  const readResult = trySync(() => readFileSync(path, "utf-8"), "config:read-failed");
  if (readResult.isErr()) return err(readResult.error);

  const parseResult = trySync(() => JSON.parse(readResult.value) as unknown, "config:parse-failed");
  if (parseResult.isErr()) return err(parseResult.error);

  const zodResult = AdamConfigSchema.safeParse(parseResult.value);
  if (!zodResult.success) {
    const messages = zodResult.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return err(adamError("config:validation-failed", `Config validation failed: ${messages}`));
  }

  return ok(zodResult.data);
}

/**
 * Writes a config object to `~/.adam/config.json`.
 * Creates the `~/.adam` directory if it doesn't exist.
 */
export function saveConfig(config: AdamConfig): Result<void, AdamError> {
  const path = getConfigPath();
  const dir = dirname(path);

  const mkdirResult = trySync(() => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }, "config:mkdir-failed");
  if (mkdirResult.isErr()) return mkdirResult;

  return trySync(
    () => writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8"),
    "config:write-failed",
  );
}

/**
 * Loads the config, returning the default config if the file doesn't exist.
 * Useful for commands that degrade gracefully before first `adam init`.
 */
export function loadConfigOrDefault(): AdamConfig {
  const result = loadConfig();
  return result.isOk() ? result.value : DEFAULT_CONFIG;
}

/**
 * Applies an update function to the current config (or defaults) and saves.
 */
export function updateConfig(
  updater: (current: AdamConfig) => AdamConfig,
): Result<AdamConfig, AdamError> {
  const current = loadConfigOrDefault();
  const updated = updater(current);
  const saveResult = saveConfig(updated);
  if (saveResult.isErr()) return err(saveResult.error);
  return ok(updated);
}
