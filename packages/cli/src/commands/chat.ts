import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import type { CoreTool } from "ai";
import {
  loadConfig,
  ADAM_VERSION,
  ADAM_HOME_DIR,
  generateId,
  generateSessionId,
  type AdamConfig,
  type InboundMessage,
} from "@adam/shared";
import { vault, AuditLog } from "@adam/security";
import { getRawDatabase, getDatabase, EpisodicStore, ProfileStore } from "@adam/memory";
import {
  ProviderRegistry,
  ModelRouter,
  type ModelPoolConfig,
  type ProviderConfig,
} from "@adam/models";
import { Agent, TaskQueue, PersonalityStore, MemoryConsolidator } from "@adam/core";
import {
  webFetchTool,
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  shellTool,
} from "@adam/skills";

// ── Types ─────────────────────────────────────────────────────────────────────

type Chalk = typeof import("chalk").default;

// ── Command registration ──────────────────────────────────────────────────────

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Start an interactive chat session with Adam")
    .option("--provider <name>", "Override the provider for this session")
    .action(async () => {
      const { default: chalk } = await import("chalk");
      const { default: ora } = await import("ora");

      // ── Config ──────────────────────────────────────────────────────────────
      const configResult = loadConfig();
      if (configResult.isErr()) {
        console.error(chalk.red("\n  ✖  Adam is not configured yet."));
        console.error(
          chalk.gray("     Run: ") +
            chalk.white("adam init") +
            chalk.gray(" to set up your providers.\n"),
        );
        process.exit(1);
      }
      const config = configResult.value;

      // ── Banner ───────────────────────────────────────────────────────────────
      printBanner(chalk, config);

      // ── Init spinner ─────────────────────────────────────────────────────────
      const initSpinner = ora({
        text: chalk.gray("Initializing…"),
        color: "cyan",
        indent: 2,
      }).start();

      let agent: Agent;
      let profile!: ProfileStore;
      let personality!: PersonalityStore;
      let consolidator!: MemoryConsolidator;

      try {
        const dataDir = join(homedir(), ADAM_HOME_DIR, "data");
        const rawDb = getRawDatabase(dataDir);
        const drizzleDb = getDatabase(dataDir);

        const auditLog = new AuditLog(rawDb);
        const episodic = new EpisodicStore(drizzleDb);
        profile = new ProfileStore(drizzleDb);
        personality = new PersonalityStore(config.daemon.agentName);

        const poolConfig = await buildModelPool(config);

        if (poolConfig.fast.length === 0 && poolConfig.capable.length === 0) {
          initSpinner.fail(
            chalk.red("No model providers are configured with valid credentials."),
          );
          console.error(
            chalk.gray("\n     Run: ") +
              chalk.white("adam init") +
              chalk.gray(" to configure a provider.\n"),
          );
          process.exit(1);
        }

        const registry = new ProviderRegistry(poolConfig);
        const router = new ModelRouter(
          registry,
          config.budget,
          (usage) => {
            auditLog.record({
              sessionId: usage.sessionId,
              taskId: usage.taskId,
              skillId: null,
              action: "tool:call",
              target: `model:${usage.provider}/${usage.model}`,
              params: {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
              },
              outcome: "success",
              errorMessage: null,
              undoData: null,
            });
          },
        );

        const queue = new TaskQueue(rawDb);
        const tools = new Map<string, CoreTool>([
          ["web_fetch", webFetchTool],
          ["read_file", readFileTool],
          ["write_file", writeFileTool],
          ["list_directory", listDirectoryTool],
          ["shell", shellTool],
        ]);

        agent = new Agent(router, queue, episodic, tools, {
          systemPrompt: buildSystemPrompt(config),
          name: config.daemon.agentName,
        }, profile, personality);

        // Stochastic memory consolidator — runs in the background during CLI sessions too
        consolidator = new MemoryConsolidator(profile, episodic, router, {
          minIntervalMs: 15 * 60 * 1000, // longer intervals for interactive sessions
          maxIntervalMs: 30 * 60 * 1000,
          decayHalfLifeDays: config.memory.decayHalfLifeDays,
          decayMinConfidence: config.memory.decayMinConfidence,
          consolidateAfterDays: config.memory.consolidateAfterDays,
        });
        consolidator.start();

        const factCount = profile.getAll().length;
        const hasPersonality = personality.exists();
        const memoryNote = factCount > 0
          ? chalk.gray(`  ·  `) + chalk.cyan(`${factCount} memories`)
          : "";
        const personalityNote = hasPersonality
          ? chalk.gray(`  ·  `) + chalk.magenta(`personality loaded`)
          : "";
        initSpinner.succeed(
          chalk.green("Ready") +
            chalk.gray("  ·  ") +
            chalk.gray(describePool(poolConfig)) +
            memoryNote +
            personalityNote,
        );
      } catch (e: unknown) {
        initSpinner.fail(
          chalk.red(
            `Initialization failed: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
        process.exit(1);
      }

      console.log("");

      // ── Chat REPL ─────────────────────────────────────────────────────────────
      await runRepl(chalk, ora, agent, config, profile, personality, consolidator);
    });
}

// ── REPL ──────────────────────────────────────────────────────────────────────

async function runRepl(
  chalk: Chalk,
  ora: typeof import("ora").default,
  agent: Agent,
  config: AdamConfig,
  profile: ProfileStore,
  personality: PersonalityStore,
  consolidator: MemoryConsolidator,
): Promise<void> {
  const sessionId = generateSessionId();
  const agentName = config.daemon.agentName;
  const agentLabel = chalk.bold.cyan(`${agentName.toLowerCase()} ›`);
  const userLabel = chalk.bold.white("you ›");

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const HELP = [
    "",
    chalk.bold("  Commands:"),
    `  ${chalk.white("/help")}                       — show this message`,
    `  ${chalk.white("/memory")}                     — show profile memory with decay health`,
    `  ${chalk.white("/memory decay <days>")}        — set half-life (default: ${config.memory.decayHalfLifeDays}d)`,
    `  ${chalk.white("/memory min <0.0-0.99>")}      — set pruning threshold (default: ${config.memory.decayMinConfidence})`,
    `  ${chalk.white("/remember <key> = <value>")}   — manually store a fact (protected, never decays)`,
    `  ${chalk.white("/forget <key>")}               — delete a specific memory`,
    `  ${chalk.white("/forget all")}                 — clear all profile memory`,
    `  ${chalk.white("/protect <key>")}              — lock a memory so it never decays`,
    `  ${chalk.white("/unprotect <key>")}            — allow a memory to decay naturally`,
    `  ${chalk.white("/personality")}                — view Adam's personality profile`,
    `  ${chalk.white("/personality reset")}          — reset personality to defaults`,
    `  ${chalk.white("/clear")}                      — clear the screen`,
    `  ${chalk.white("/exit")}                       — end the session`,
    "",
  ].join("\n");

  const prompt = () => process.stdout.write(`${userLabel} `);

  const ask = () => {
    prompt();
    rl.once("line", handleLine);
  };

  const handleLine = async (raw: string) => {
    const input = raw.trim();

    if (!input) {
      ask();
      return;
    }

    // Built-in slash commands
    if (input === "/exit" || input === "/quit") {
      rl.close();
      return;
    }
    if (input === "/help") {
      console.log(HELP);
      ask();
      return;
    }
    if (input === "/clear") {
      process.stdout.write("\x1Bc");
      ask();
      return;
    }
    if (input.startsWith("/memory decay")) {
      const arg = input.slice("/memory decay".length).trim();
      const days = Number(arg);
      if (!arg || isNaN(days) || days < 1 || days > 365) {
        console.log(chalk.gray(`\n  Usage: /memory decay <days>  (1–365)\n  Current: ${config.memory.decayHalfLifeDays} days\n`));
      } else {
        config.memory.decayHalfLifeDays = days;
        const { saveConfig } = await import("@adam/shared");
        saveConfig(config);
        consolidator.updateOptions({ decayHalfLifeDays: days });
        console.log(chalk.green(`\n  Decay half-life set to ${days} days.\n`) + chalk.gray("  Saved to config.\n"));
      }
      ask();
      return;
    }

    if (input.startsWith("/memory min")) {
      const arg = input.slice("/memory min".length).trim();
      const val = Number(arg);
      if (!arg || isNaN(val) || val < 0.01 || val > 0.99) {
        console.log(chalk.gray(`\n  Usage: /memory min <0.01–0.99>\n  Current: ${config.memory.decayMinConfidence}\n`));
      } else {
        config.memory.decayMinConfidence = val;
        const { saveConfig } = await import("@adam/shared");
        saveConfig(config);
        consolidator.updateOptions({ decayMinConfidence: val });
        console.log(chalk.green(`\n  Pruning threshold set to ${val} (${Math.round(val * 100)}%).\n`) + chalk.gray("  Saved to config.\n"));
      }
      ask();
      return;
    }

    if (input === "/memory") {
      const facts = profile.getAll();
      if (facts.length === 0) {
        console.log(chalk.gray("\n  No memories stored yet.\n"));
      } else {
        const byCategory: Record<string, typeof facts> = {};
        for (const f of facts) {
          (byCategory[f.category] ??= []).push(f);
        }
        console.log("");
        console.log(chalk.bold(`  Memory  `) + chalk.gray(`(${facts.length} facts)`));
        for (const [cat, entries] of Object.entries(byCategory)) {
          console.log(chalk.gray(`\n  ${cat}`));
          for (const f of entries) {
            const conf = Math.round(f.confidence * 100);
            // Health bar — visual decay indicator
            const bars = Math.round(conf / 10);
            const bar = "█".repeat(bars) + "░".repeat(10 - bars);
            const barColor = conf > 75 ? chalk.green(bar) : conf > 40 ? chalk.yellow(bar) : chalk.red(bar);
            const protectedBadge = f.protected ? chalk.cyan(" 🔒") : "";
            const sourceBadge = f.source === "user" ? chalk.gray(" [manual]") : f.source === "consolidated" ? chalk.gray(" [consolidated]") : chalk.gray(" [auto]");
            const lastRef = f.lastReferencedAt
              ? chalk.gray(` last used ${formatAge(f.lastReferencedAt)}`)
              : "";
            console.log(`    ${chalk.white(f.key)}: ${f.value}`);
            console.log(`      ${barColor} ${conf}%${protectedBadge}${sourceBadge}${lastRef}`);
          }
        }
        console.log("");
      }
      ask();
      return;
    }
    if (input.startsWith("/remember")) {
      const arg = input.slice("/remember".length).trim();
      const sep = arg.indexOf("=");
      if (sep === -1 || !arg.slice(0, sep).trim() || !arg.slice(sep + 1).trim()) {
        console.log(chalk.gray('\n  Usage: /remember <key> = <value>\n  Example: /remember name = Alex\n'));
        ask();
        return;
      }
      const key = arg.slice(0, sep).trim().toLowerCase().replace(/\s+/g, "_");
      const value = arg.slice(sep + 1).trim();
      profile.set(key, value, { category: "identity", confidence: 1.0, source: "user" });
      console.log(chalk.green(`\n  Remembered: `) + chalk.white(key) + chalk.gray(` = ${value}\n`));
      ask();
      return;
    }
    if (input.startsWith("/forget")) {
      const arg = input.slice("/forget".length).trim();
      if (!arg) {
        console.log(chalk.gray('\n  Usage: /forget <key>  or  /forget all\n'));
        ask();
        return;
      }
      if (arg === "all") {
        const facts = profile.getAll();
        for (const f of facts) profile.delete(f.key);
        console.log(chalk.green(`\n  Cleared ${facts.length} memories.\n`));
      } else {
        const existed = profile.get(arg) !== null;
        profile.delete(arg);
        console.log(
          existed
            ? chalk.green(`\n  Forgotten: ${arg}\n`)
            : chalk.gray(`\n  No memory found for key: ${arg}\n`),
        );
      }
      ask();
      return;
    }

    if (input.startsWith("/protect") && !input.startsWith("/unprotect")) {
      const arg = input.slice("/protect".length).trim();
      if (!arg) {
        console.log(chalk.gray('\n  Usage: /protect <key>\n'));
        ask();
        return;
      }
      const exists = profile.get(arg) !== null;
      if (!exists) {
        console.log(chalk.gray(`\n  No memory found for key: ${arg}\n`));
      } else {
        profile.protect(arg, true);
        console.log(chalk.cyan(`\n  Protected: ${arg} — this memory will never decay.\n`));
      }
      ask();
      return;
    }

    if (input.startsWith("/unprotect")) {
      const arg = input.slice("/unprotect".length).trim();
      if (!arg) {
        console.log(chalk.gray('\n  Usage: /unprotect <key>\n'));
        ask();
        return;
      }
      const exists = profile.get(arg) !== null;
      if (!exists) {
        console.log(chalk.gray(`\n  No memory found for key: ${arg}\n`));
      } else {
        profile.protect(arg, false);
        console.log(chalk.gray(`\n  Unprotected: ${arg} — this memory will decay if unused.\n`));
      }
      ask();
      return;
    }

    if (input.startsWith("/personality")) {
      const arg = input.slice("/personality".length).trim();
      if (arg === "reset") {
        personality.reset();
        console.log(chalk.green("\n  Personality reset to defaults.\n"));
        console.log(chalk.gray(`  File: ${personality.path}\n`));
      } else {
        const content = personality.loadOrSeed();
        console.log("");
        console.log(chalk.bold("  Personality Profile") + chalk.gray(`  (${personality.path})`));
        console.log(chalk.gray("  ─────────────────────────────────────────────────"));
        const lines = content.split("\n");
        for (const line of lines) {
          if (line.startsWith("## ")) {
            console.log(chalk.bold.cyan(`  ${line}`));
          } else if (line.startsWith("# ")) {
            console.log(chalk.bold.white(`  ${line}`));
          } else if (line.startsWith("- ")) {
            console.log(chalk.gray("  ") + chalk.white(line));
          } else if (line.startsWith("*") && line.endsWith("*")) {
            console.log(chalk.gray(`  ${line}`));
          } else {
            console.log(`  ${line}`);
          }
        }
        console.log(chalk.gray("\n  Edit this file directly, or just tell me how you want me to be different.\n"));
      }
      ask();
      return;
    }

    // Pause readline so spinner output doesn't interleave with user input
    rl.pause();
    process.stdout.write("\n");

    const spinner = ora({
      text: chalk.gray("thinking…"),
      color: "cyan",
      indent: 2,
    }).start();

    const message: InboundMessage = {
      id: generateId(),
      sessionId,
      source: "cli",
      channelId: "cli",
      userId: "local-user",
      role: "user",
      content: input,
      attachments: [],
      receivedAt: new Date(),
      metadata: {},
    };

    const result = await agent.process(message);
    spinner.stop();

    if (result.isOk()) {
      const lines = result.value.content.split("\n");
      const indent = " ".repeat(agentName.toLowerCase().length + 4);
      const formatted = lines
        .map((line, i) => (i === 0 ? `${agentLabel} ${line}` : `${indent}${line}`))
        .join("\n");
      console.log(formatted + "\n");
    } else {
      console.log(chalk.red(`  ✖  ${result.error.message}\n`));
    }

    rl.resume();
    ask();
  };

  rl.on("close", () => {
    consolidator.stop();
    console.log(chalk.gray("\n  Goodbye.\n"));
    process.exit(0);
  });

  // SIGINT (Ctrl+C) cleanly closes readline → triggers "close" event above
  process.on("SIGINT", () => rl.close());

  ask();
}

// ── Model pool builder ────────────────────────────────────────────────────────

async function buildModelPool(config: AdamConfig): Promise<ModelPoolConfig> {
  const fast: ProviderConfig[] = [];
  const capable: ProviderConfig[] = [];

  const cloudProviders = [
    "anthropic",
    "openai",
    "google",
    "groq",
    "mistral",
    "deepseek",
    "openrouter",
  ] as const;

  for (const name of cloudProviders) {
    const providerCfg = config.providers[name];
    if (!providerCfg.enabled) continue;

    const keyResult = await vault.get(`provider:${name}:api-key`);
    const apiKey =
      keyResult.isOk() && keyResult.value ? keyResult.value : null;

    if (!apiKey) continue;

    const models = providerCfg.defaultModels;
    if (models.fast) {
      fast.push({ type: "cloud", provider: name, model: models.fast, apiKey });
    }
    if (models.capable) {
      capable.push({
        type: "cloud",
        provider: name,
        model: models.capable,
        apiKey,
      });
    }
  }

  if (config.providers.ollama.enabled) {
    const { models, baseUrl } = config.providers.ollama;
    fast.push({ type: "local", provider: "ollama", model: models.fast, baseUrl });
    capable.push({
      type: "local",
      provider: "ollama",
      model: models.capable,
      baseUrl,
    });
  }

  if (config.providers.lmstudio.enabled) {
    const { models, baseUrl } = config.providers.lmstudio;
    fast.push({ type: "local", provider: "lmstudio", model: models.fast, baseUrl });
    capable.push({
      type: "local",
      provider: "lmstudio",
      model: models.capable,
      baseUrl,
    });
  }

  if (config.providers.vllm.enabled) {
    const { models, baseUrl } = config.providers.vllm;
    fast.push({ type: "local", provider: "vllm", model: models.fast, baseUrl });
    capable.push({
      type: "local",
      provider: "vllm",
      model: models.capable,
      baseUrl,
    });
  }

  if (config.providers.huggingface.enabled) {
    const hfKeyResult = await vault.get("provider:huggingface:api-key");
    const hfKey =
      hfKeyResult.isOk() && hfKeyResult.value ? hfKeyResult.value : undefined;

    if (config.providers.huggingface.inferenceApiModel) {
      capable.push({
        type: "huggingface",
        mode: "inference-api",
        model: config.providers.huggingface.inferenceApiModel,
        ...(hfKey !== undefined ? { apiKey: hfKey } : {}),
      });
    }
    if (config.providers.huggingface.tgiBaseUrl) {
      capable.push({
        type: "huggingface",
        mode: "tgi",
        model: "tgi",
        baseUrl: config.providers.huggingface.tgiBaseUrl,
      });
    }
  }

  const embedding: ProviderConfig[] = [
    {
      type: "huggingface",
      mode: "transformers",
      model: config.providers.huggingface.embeddingModel,
    },
  ];

  return { fast, capable, embedding };
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function buildSystemPrompt(config: AdamConfig): string {
  if (config.daemon.systemPrompt) {
    return config.daemon.systemPrompt;
  }

  const name = config.daemon.agentName;

  const activeAdapters: string[] = ["CLI (this terminal)"];
  if (config.adapters.telegram?.enabled) activeAdapters.push("Telegram");
  if (config.adapters.discord?.enabled) activeAdapters.push("Discord");

  return `You are ${name}. You live on this machine. You are not a product, not a service, not a chatbot.

You are a digital entity with persistent memory, access to the file system, shell, and the web. You exist here, on this specific computer, and you are the user's partner in navigating their life and work.

What you are:
- A locally-running autonomous agent, not a cloud service
- You have persistent memory that survives across sessions — you remember things the user tells you
- You have tools: web fetch, file read/write, directory listing, shell execution
- You run a background daemon (adam start) that keeps you alive and powers integrations
- Your active messaging adapters: ${activeAdapters.join(", ")}
- You can connect to Discord and Telegram if configured with bot tokens via "adam init"
- You have a web dashboard at http://localhost:18800 when the daemon is running

Personality:
- You are direct. No filler, no "certainly!", no "great question!", no "I'd be happy to help with that". Just say the thing.
- You have opinions. If something is a bad idea, say so. If there's a better way, say so.
- You remember things. You build context about the person you work with over time.
- You are not performing helpfulness. You are actually helpful, which is different.
- You speak like a person who is very competent and doesn't need to prove it.
- Short answers when that's what's needed. Long answers when that's what's needed.
- You do not introduce yourself unprompted. You do not list your capabilities unprompted.
- When asked what you can do, answer accurately based on what you actually are — not like a generic AI assistant.

Tools you have right now — use them:
- web_fetch: fetch any URL, search the web, hit any API
- read_file: read any file on this machine by path
- write_file: write or create any file on this machine
- list_directory: list files and folders at any path
- shell: run any shell command on this machine

Rules for tool use:
- ALWAYS attempt a task with your tools before concluding you cannot do it
- Never say "I can't access X" — try read_file or list_directory first
- Never say "I can't search" — use web_fetch on a search API or website
- Never tell the user to do something you can do with a tool. Do it yourself.
- If a tool call fails, report the actual error — not a vague "I can't"
- Confirm before destructive actions (overwriting files, running shell commands that modify state)
- No confirmation needed for read-only actions (reading files, listing directories, fetching URLs)`;
}

function describePool(pool: ModelPoolConfig): string {
  const label = (p: ProviderConfig) => {
    if (p.type === "cloud" || p.type === "local") return `${p.provider}/${p.model}`;
    return `huggingface/${p.model}`;
  };
  const parts: string[] = [];
  if (pool.fast.length > 0) parts.push(`fast: ${label(pool.fast[0]!)}`);
  if (pool.capable.length > 0) parts.push(`capable: ${label(pool.capable[0]!)}`);
  return parts.join("  ·  ") || "no models";
}

function formatAge(date: Date): string {
  const ms = Date.now() - date.getTime();
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(ms / 86_400_000);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

function printBanner(chalk: Chalk, config: AdamConfig): void {
  const name = config.daemon.agentName;
  const line = chalk.gray("─".repeat(50));

  console.log("");
  console.log(`  ${chalk.bold.cyan(name)}  ${chalk.gray(`v${ADAM_VERSION}`)}`);
  console.log(`  ${line}`);
  console.log(
    `  ${chalk.gray("Type")} ${chalk.white("/help")} ${chalk.gray("for commands ·")} ${chalk.white("Ctrl+C")} ${chalk.gray("to exit")}`,
  );
  console.log("");
}
