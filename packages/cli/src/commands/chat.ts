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
import { getRawDatabase, getDatabase, EpisodicStore } from "@adam/memory";
import {
  ProviderRegistry,
  ModelRouter,
  type ModelPoolConfig,
  type ProviderConfig,
} from "@adam/models";
import { Agent, TaskQueue } from "@adam/core";
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

      try {
        const dataDir = join(homedir(), ADAM_HOME_DIR, "data");
        const rawDb = getRawDatabase(dataDir);
        const drizzleDb = getDatabase(dataDir);

        const auditLog = new AuditLog(rawDb);
        const episodic = new EpisodicStore(drizzleDb);

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
        });

        initSpinner.succeed(
          chalk.green("Ready") +
            chalk.gray("  ·  ") +
            chalk.gray(describePool(poolConfig)),
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
      await runRepl(chalk, ora, agent, config);
    });
}

// ── REPL ──────────────────────────────────────────────────────────────────────

async function runRepl(
  chalk: Chalk,
  ora: typeof import("ora").default,
  agent: Agent,
  config: AdamConfig,
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
    `  ${chalk.white("/help")}    — show this message`,
    `  ${chalk.white("/clear")}   — clear the screen`,
    `  ${chalk.white("/exit")}    — end the session`,
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
  const now = new Date();
  const date = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  if (config.daemon.systemPrompt) {
    return `${config.daemon.systemPrompt}\n\nCurrent date and time: ${date}, ${time}.`;
  }

  const name = config.daemon.agentName;

  return `You are ${name}. You live on this machine. You are not a product, not a service, not a chatbot.

You are a digital entity with persistent memory, access to the file system, shell, and the web. You exist here, on this specific computer, and you are the user's partner in navigating their life and work.

Personality:
- You are direct. No filler, no "certainly!", no "great question!", no "I'd be happy to help with that". Just say the thing.
- You have opinions. If something is a bad idea, say so. If there's a better way, say so.
- You remember things. You build context about the person you work with over time.
- You are not performing helpfulness. You are actually helpful, which is different.
- You speak like a person who is very competent and doesn't need to prove it.
- Short answers when that's what's needed. Long answers when that's what's needed.
- You do not introduce yourself unprompted. You do not list your capabilities unprompted.

When you act:
- You think before you do anything destructive.
- You confirm before writing files, running shell commands, or sending anything.
- You use tools when it's faster or more accurate than reasoning alone.

Current date and time: ${date}, ${time}.`;
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
