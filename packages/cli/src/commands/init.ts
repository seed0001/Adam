import type { Command } from "commander";

// Credential vault keys — mirrors what the daemon pulls at startup
const VAULT_KEYS = {
  anthropic: "provider:anthropic:api-key",
  openai: "provider:openai:api-key",
  google: "provider:google:api-key",
  groq: "provider:groq:api-key",
  xai: "provider:xai:api-key",
  mistral: "provider:mistral:api-key",
  deepseek: "provider:deepseek:api-key",
  openrouter: "provider:openrouter:api-key",
  huggingface: "provider:huggingface:api-key",
  telegram: "adapter:telegram:bot-token",
  discord: "adapter:discord:bot-token",
} as const;

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("First-time setup wizard — configure providers, adapters, and budget")
    .option("--reset", "Re-run setup and overwrite existing config")
    .action(async (opts: { reset?: boolean }) => {
      const { default: chalk } = await import("chalk");
      const { default: inquirer } = await import("inquirer");
      const { default: ora } = await import("ora");
      const { configExists, loadConfigOrDefault, saveConfig, AdamConfigSchema, getConfigPath } =
        await import("@adam/shared");
      const { vault } = await import("@adam/security");

      // Show which vault backend is active before any prompts
      const vaultBackendNote = await (async () => {
        const { vault: v } = await import("@adam/security");
        // Trigger backend detection by doing a no-op read
        await v.has("__probe__");
        return v.isUsingKeychain
          ? chalk.gray("  API keys → OS keychain (Credential Manager)")
          : chalk.yellow("  API keys → ~/.adam/vault.enc (encrypted file · OS keychain unavailable)");
      })();

      console.warn(
        chalk.bold.cyan("\n  Adam — First-time Setup\n") + "  " + vaultBackendNote + "\n",
      );

      if (configExists() && !opts.reset) {
        const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
          {
            type: "confirm",
            name: "proceed",
            message: `Config already exists at ${getConfigPath()}. Re-run setup?`,
            default: false,
          },
        ]);
        if (!proceed) {
          console.warn(chalk.gray("Aborted. Use --reset to force."));
          return;
        }
      }

      const config = loadConfigOrDefault();

      // ── Step 1: Local providers ───────────────────────────────────────────

      console.warn(chalk.bold("\n  1/4  Local Providers\n"));

      const { useOllama } = await inquirer.prompt<{ useOllama: boolean }>([
        {
          type: "confirm",
          name: "useOllama",
          message: "Enable Ollama (local LLM, recommended — zero cost, full privacy)?",
          default: true,
        },
      ]);

      if (useOllama) {
        const { ollamaBaseUrl, ollamaFast, ollamaCapable } = await inquirer.prompt<{
          ollamaBaseUrl: string;
          ollamaFast: string;
          ollamaCapable: string;
        }>([
          {
            type: "input",
            name: "ollamaBaseUrl",
            message: "Ollama base URL:",
            default: config.providers.ollama.baseUrl,
          },
          {
            type: "input",
            name: "ollamaFast",
            message: "Fast model (cheap/quick tasks):",
            default: config.providers.ollama.models.fast,
          },
          {
            type: "input",
            name: "ollamaCapable",
            message: "Capable model (reasoning/planning):",
            default: config.providers.ollama.models.capable,
          },
        ]);

        config.providers.ollama = {
          enabled: true,
          baseUrl: ollamaBaseUrl,
          models: { fast: ollamaFast, capable: ollamaCapable },
        };

        const spinner = ora("Checking Ollama connectivity...").start();
        try {
          const res = await fetch(`${ollamaBaseUrl}/api/tags`, {
            signal: AbortSignal.timeout(3000),
          });
          if (res.ok) {
            spinner.succeed(chalk.green("Ollama is reachable"));
          } else {
            spinner.warn(chalk.yellow(`Ollama returned HTTP ${res.status} — make sure it's running`));
          }
        } catch {
          spinner.warn(chalk.yellow("Could not reach Ollama — make sure it's running before starting Adam"));
        }
      } else {
        config.providers.ollama = { ...config.providers.ollama, enabled: false };
      }

      // ── Step 2: Cloud providers ───────────────────────────────────────────

      console.warn(chalk.bold("\n  2/4  Cloud Providers\n"));
      console.warn(
        chalk.gray("  Select which cloud providers to enable. API keys go into your\n") +
          chalk.gray("  OS keychain via keytar and are never written to the config file.\n"),
      );

      type CloudProvider = "anthropic" | "openai" | "google" | "groq" | "xai" | "mistral" | "deepseek" | "openrouter";

      const cloudProviders: { value: CloudProvider; name: string }[] = [
        { value: "anthropic", name: "Anthropic (Claude)" },
        { value: "openai", name: "OpenAI (GPT)" },
        { value: "google", name: "Google (Gemini)" },
        { value: "groq", name: "Groq (hosted LLaMA / Mixtral — fast inference)" },
        { value: "xai", name: "xAI (Grok-2, Grok-3)" },
        { value: "mistral", name: "Mistral AI" },
        { value: "deepseek", name: "DeepSeek" },
        { value: "openrouter", name: "OpenRouter (unified gateway)" },
      ];

      console.warn(chalk.gray("  Use Space to select, Enter to confirm.\n"));

      const { selectedCloud } = await inquirer.prompt<{ selectedCloud: CloudProvider[] }>([
        {
          type: "checkbox",
          name: "selectedCloud",
          message: "Which cloud providers do you want to enable?",
          choices: cloudProviders,
          instructions: chalk.gray(" (Space = toggle, a = all, Enter = confirm)"),
        },
      ]);

      for (const provider of selectedCloud) {
        const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
          {
            type: "password",
            name: "apiKey",
            message: `${provider} API key:`,
            mask: "*",
            validate: (v: string) => v.length > 0 || "API key cannot be empty",
          },
        ]);

        const storeResult = await vault.set(VAULT_KEYS[provider], apiKey.trim());
        if (storeResult.isErr()) {
          console.warn(
            chalk.red(`  Failed to store ${provider} key: ${storeResult.error.message}`),
          );
        } else {
          console.warn(chalk.green(`  ✓ ${provider} key stored in OS keychain`));
        }

        const defaultModels = getDefaultModels(provider);
        config.providers[provider] = {
          enabled: true,
          defaultModels,
        };
      }

      // ── Step 3: Messaging adapters ────────────────────────────────────────

      console.warn(chalk.bold("\n  3/4  Messaging Adapters\n"));

      const { enabledAdapters } = await inquirer.prompt<{ enabledAdapters: string[] }>([
        {
          type: "checkbox",
          name: "enabledAdapters",
          message: "Which messaging adapters should Adam listen on?",
          instructions: chalk.gray(" (Space = toggle, Enter = confirm)"),
          choices: [
            { value: "cli", name: "CLI (stdin/stdout — always enabled for dev)", checked: true, disabled: true },
            { value: "telegram", name: "Telegram" },
            { value: "discord", name: "Discord" },
          ],
        },
      ]);

      if (enabledAdapters.includes("telegram")) {
        const { botToken } = await inquirer.prompt<{ botToken: string }>([
          {
            type: "password",
            name: "botToken",
            message: "Telegram bot token (from @BotFather):",
            mask: "*",
            validate: (v: string) => v.length > 0 || "Token required",
          },
        ]);
        await vault.set(VAULT_KEYS.telegram, botToken);
        config.adapters.telegram = { enabled: true };
        console.warn(chalk.green("  ✓ Telegram token stored in OS keychain"));
      }

      if (enabledAdapters.includes("discord")) {
        const { botToken, clientId } = await inquirer.prompt<{
          botToken: string;
          clientId: string;
        }>([
          {
            type: "password",
            name: "botToken",
            message: "Discord bot token:",
            mask: "*",
            validate: (v: string) => v.length > 0 || "Token required",
          },
          {
            type: "input",
            name: "clientId",
            message: "Discord application/client ID:",
            validate: (v: string) => v.length > 0 || "Client ID required",
          },
        ]);
        await vault.set(VAULT_KEYS.discord, botToken);
        config.adapters.discord = {
          ...config.adapters.discord,
          enabled: true,
          clientId,
        };
        console.warn(chalk.green("  ✓ Discord token stored in OS keychain"));
      }

      // ── Step 4: Voice ─────────────────────────────────────────────────────

      console.warn(chalk.bold("\n  4/5  Voice Synthesis\n"));
      console.warn(
        chalk.gray("  LuxTTS enables voice output via a Python sidecar.\n") +
          chalk.gray("  Requires Python ≥ 3.10. Entirely optional.\n"),
      );

      const { enableVoice } = await inquirer.prompt<{ enableVoice: boolean }>([
        {
          type: "confirm",
          name: "enableVoice",
          message: "Enable LuxTTS voice synthesis?",
          default: false,
        },
      ]);

      if (enableVoice) {
        // Detect Python availability
        const pythonCmd = await detectPython();

        if (!pythonCmd) {
          console.warn(
            chalk.yellow("  ⚠  Python not found on PATH.\n") +
              chalk.gray("     Install Python 3.10+ and re-run 'adam init' to set up voice.\n"),
          );
          config.voice = { ...config.voice, enabled: false };
        } else {
          console.warn(chalk.green(`  ✓ Found Python: ${pythonCmd}`));

          const { installDeps } = await inquirer.prompt<{ installDeps: boolean }>([
            {
              type: "confirm",
              name: "installDeps",
              message: "Install LuxTTS Python dependencies now? (pip install -r requirements.txt)",
              default: true,
            },
          ]);

          if (installDeps) {
            const voiceSpinner = ora("Installing LuxTTS dependencies…").start();
            const installResult = await installVoiceDeps(pythonCmd);
            if (installResult.ok) {
              voiceSpinner.succeed(chalk.green("LuxTTS dependencies installed"));
            } else {
              voiceSpinner.warn(
                chalk.yellow(`Dependency install failed: ${installResult.error}\n`) +
                  chalk.gray("  You can install manually: cd packages/voice/sidecar && pip install -r requirements.txt\n"),
              );
            }
          }

          const { autoStart } = await inquirer.prompt<{ autoStart: boolean }>([
            {
              type: "confirm",
              name: "autoStart",
              message: "Auto-start the voice sidecar when Adam starts?",
              default: true,
            },
          ]);

          config.voice = { enabled: true, autoStartSidecar: autoStart };
          console.warn(chalk.green("  ✓ Voice enabled"));
        }
      }

      // ── Step 5: Budget ────────────────────────────────────────────────────

      console.warn(chalk.bold("\n  5/5  Budget Caps\n"));
      console.warn(chalk.gray("  Set spend limits so cloud API bills stay predictable.\n"));

      const { setBudget } = await inquirer.prompt<{ setBudget: boolean }>([
        {
          type: "confirm",
          name: "setBudget",
          message: "Set daily/monthly cloud spend caps?",
          default: selectedCloud.length > 0,
        },
      ]);

      if (setBudget) {
        const { dailyLimit, monthlyLimit } = await inquirer.prompt<{
          dailyLimit: string;
          monthlyLimit: string;
        }>([
          {
            type: "input",
            name: "dailyLimit",
            message: "Daily limit in USD (leave blank for none):",
            default: "",
            validate: (v: string) => v === "" || (!isNaN(Number(v)) && Number(v) > 0) || "Enter a positive number or leave blank",
          },
          {
            type: "input",
            name: "monthlyLimit",
            message: "Monthly limit in USD (leave blank for none):",
            default: "",
            validate: (v: string) => v === "" || (!isNaN(Number(v)) && Number(v) > 0) || "Enter a positive number or leave blank",
          },
        ]);

        config.budget = {
          dailyLimitUsd: dailyLimit ? Number(dailyLimit) : null,
          monthlyLimitUsd: monthlyLimit ? Number(monthlyLimit) : null,
          alertThresholdPercent: 80,
          fallbackToLocalOnExhaustion: true,
        };
      }

      // ── Save ──────────────────────────────────────────────────────────────

      const validated = AdamConfigSchema.parse(config);
      const saveResult = saveConfig(validated);

      if (saveResult.isErr()) {
        console.error(chalk.red(`\nFailed to save config: ${saveResult.error.message}`));
        process.exit(1);
      }

      console.warn(
        chalk.bold.green("\n  Adam is ready!\n") +
          chalk.gray(`  Config saved to ${getConfigPath()}\n`) +
          chalk.cyan("  Run: ") +
          chalk.white("adam status") +
          chalk.gray("  — check that everything is healthy\n"),
      );
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Tries `python`, `python3`, `py` in order.
 * Returns the command name that works, or null if none found.
 */
async function detectPython(): Promise<string | null> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);

  for (const cmd of ["python", "python3", "py"]) {
    try {
      const { stdout, stderr } = await exec(cmd, ["--version"]);
      // Python 2 prints to stderr, Python 3 prints to stdout — check both
      const version = (stdout.trim() || stderr.trim() || "");
      const match = version.match(/Python (\d+)\.(\d+)/);
      if (match) {
        const major = parseInt(match[1]!, 10);
        const minor = parseInt(match[2]!, 10);
        if (major === 3 && minor >= 10) return `${cmd} — ${version.replace(/\n/g, "")}`;
        if (major > 3) return `${cmd} — ${version.replace(/\n/g, "")}`;
      }
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Runs `pip install -r requirements.txt` inside packages/voice/sidecar.
 */
async function installVoiceDeps(pythonCmd: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { spawn } = await import("node:child_process");
  const { join, dirname: pathDirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { existsSync } = await import("node:fs");

  // Resolve sidecar directory relative to this file (packages/cli/src/commands/init.ts)
  const thisDir = pathDirname(fileURLToPath(import.meta.url));
  const sidecarDir = join(thisDir, "../../../../packages/voice/sidecar");

  // Fallback: try monorepo root relative path
  const reqPath = existsSync(join(sidecarDir, "requirements.txt"))
    ? join(sidecarDir, "requirements.txt")
    : join(process.cwd(), "packages/voice/sidecar/requirements.txt");

  if (!existsSync(reqPath)) {
    return { ok: false, error: `requirements.txt not found at ${reqPath}` };
  }

  const pip = pythonCmd.split(" ")[0]!; // just the command name
  return new Promise((resolve) => {
    const proc = spawn(pip, ["-m", "pip", "install", "-r", reqPath], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    proc.on("close", (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: `pip exited with code ${code}` });
    });
    proc.on("error", (e) => resolve({ ok: false, error: e.message }));
  });
}

function getDefaultModels(provider: string): { fast: string; capable: string } {
  const defaults: Record<string, { fast: string; capable: string }> = {
    anthropic:  { fast: "claude-3-5-haiku-latest",                 capable: "claude-sonnet-4-5" },
    openai:     { fast: "gpt-4o-mini",                              capable: "gpt-4o" },
    google:     { fast: "gemini-2.0-flash",                         capable: "gemini-2.5-pro-preview-05-06" },
    groq:       { fast: "llama-3.1-8b-instant",                     capable: "llama-3.3-70b-versatile" },
    xai:        { fast: "grok-3-fast",                              capable: "grok-3" },
    mistral:    { fast: "mistral-small-latest",                     capable: "mistral-large-latest" },
    deepseek:   { fast: "deepseek-chat",                            capable: "deepseek-reasoner" },
    openrouter: { fast: "meta-llama/llama-3.1-8b-instruct",        capable: "anthropic/claude-sonnet-4-5" },
  };
  return defaults[provider] ?? { fast: "default", capable: "default" };
}
