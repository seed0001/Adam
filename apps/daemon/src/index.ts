import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  ADAM_HOME_DIR,
  ADAM_VERSION,
  loadConfig,
  addLogHandler,
  createLogger,
  type AdamConfig,
  type LogEntry,
} from "@adam/shared";
import { vault, PermissionRegistry, AuditLog } from "@adam/security";
import { getDatabase, getRawDatabase, EpisodicStore } from "@adam/memory";
import {
  ProviderRegistry,
  ModelRouter,
  type ModelPoolConfig,
  type ProviderConfig,
} from "@adam/models";
import { Agent, TaskQueue } from "@adam/core";
import {
  CliAdapter,
  TelegramAdapter,
  DiscordAdapter,
  type BaseAdapter,
} from "@adam/adapters";
import {
  webFetchTool,
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  shellTool,
} from "@adam/skills";
import type { CoreTool } from "ai";

const logger = createLogger("daemon");

addLogHandler((entry: LogEntry) => {
  const prefix = entry.context ? `[${entry.context}]` : "";
  const msg = `${entry.timestamp.toISOString()} [${entry.level.toUpperCase()}]${prefix} ${entry.message}`;
  if (entry.level === "error") process.stderr.write(msg + "\n");
  else process.stdout.write(msg + "\n");
});

async function main() {
  // ── Load & validate config ─────────────────────────────────────────────────
  const configResult = loadConfig();
  if (configResult.isErr()) {
    process.stderr.write(
      `\nAdam cannot start: ${configResult.error.message}\n\nRun: adam init\n\n`,
    );
    process.exit(1);
  }

  const config = configResult.value;
  logger.info(`Adam daemon v${ADAM_VERSION} starting...`);
  logger.info(`Log level: ${config.daemon.logLevel}`);

  // ── Data directory ─────────────────────────────────────────────────────────
  const dataDir = join(homedir(), ADAM_HOME_DIR, "data");
  const rawDb = getRawDatabase(dataDir);
  const drizzleDb = getDatabase(dataDir);

  // ── Security ───────────────────────────────────────────────────────────────
  const auditLog = new AuditLog(rawDb);
  const permissions = new PermissionRegistry(rawDb);
  void permissions; // reserved for skill permission checks

  // ── Memory ─────────────────────────────────────────────────────────────────
  const episodic = new EpisodicStore(drizzleDb);

  // ── Model pool ─────────────────────────────────────────────────────────────
  const poolConfig = await buildModelPool(config);
  if (poolConfig.fast.length === 0 && poolConfig.capable.length === 0) {
    process.stderr.write(
      "\nAdam cannot start: no model providers are configured.\n" +
        "Run `adam init` to configure at least one provider.\n\n",
    );
    process.exit(1);
  }

  logActiveProviders(config);

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
        params: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
        outcome: "success",
        errorMessage: null,
        undoData: null,
      });
    },
  );

  // ── Task queue & tools ─────────────────────────────────────────────────────
  const queue = new TaskQueue(rawDb);
  const tools = new Map<string, CoreTool>([
    ["web_fetch", webFetchTool],
    ["read_file", readFileTool],
    ["write_file", writeFileTool],
    ["list_directory", listDirectoryTool],
    ["shell", shellTool],
  ]);

  // ── Agent ──────────────────────────────────────────────────────────────────
  const agent = new Agent(router, queue, episodic, tools, {
    systemPrompt: buildSystemPrompt(config),
    name: config.daemon.agentName,
  });

  // ── Adapters ───────────────────────────────────────────────────────────────
  const adapters = await buildAdapters(config);

  for (const adapter of adapters) {
    adapter.on("message", async (message) => {
      const result = await agent.process(message);
      if (result.isOk()) {
        await adapter.send(result.value);
      } else {
        logger.error("Agent processing failed", { error: result.error.message });
        await adapter.send({
          sessionId: message.sessionId,
          channelId: message.channelId,
          source: message.source,
          content: `Sorry, I encountered an error: ${result.error.message}`,
          voiceProfileId: null,
          replyToId: message.id,
          metadata: {},
        });
      }
    });
  }

  // ── Health server ──────────────────────────────────────────────────────────
  const port = config.daemon.port;
  const healthServer = createHealthServer(config);
  healthServer.listen(port, "127.0.0.1", () => {
    logger.info(`Health server listening on http://localhost:${port}`);
  });

  // ── Start adapters ─────────────────────────────────────────────────────────
  for (const adapter of adapters) {
    await adapter.start().catch((e: unknown) => {
      logger.error(`Failed to start adapter ${adapter.source}`, { error: String(e) });
    });
  }

  logger.info(
    `Adam daemon ready — ${adapters.length} adapter(s) active: ${adapters.map((a) => a.source).join(", ")}`,
  );

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    for (const adapter of adapters) {
      await adapter.stop().catch(() => {});
    }
    healthServer.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("uncaughtException", (e) => {
    logger.error("Uncaught exception", { error: e.message, stack: e.stack });
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", { reason: String(reason) });
  });
}

// ── Model pool builder ────────────────────────────────────────────────────────

async function buildModelPool(config: AdamConfig): Promise<ModelPoolConfig> {
  const fast: ProviderConfig[] = [];
  const capable: ProviderConfig[] = [];

  // Cloud providers — keys are fetched from OS keychain
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
    const apiKey = keyResult.isOk() && keyResult.value ? keyResult.value : null;

    if (!apiKey) {
      logger.warn(`${name} is enabled in config but no API key found in keychain — skipping`);
      continue;
    }

    const models = providerCfg.defaultModels;
    if (models.fast) {
      fast.push({
        type: "cloud",
        provider: name as "anthropic" | "openai" | "google" | "groq" | "mistral" | "deepseek" | "openrouter",
        model: models.fast,
        apiKey,
      });
    }
    if (models.capable) {
      capable.push({
        type: "cloud",
        provider: name as "anthropic" | "openai" | "google" | "groq" | "mistral" | "deepseek" | "openrouter",
        model: models.capable,
        apiKey,
      });
    }
  }

  // Ollama (local)
  if (config.providers.ollama.enabled) {
    fast.push({
      type: "local",
      provider: "ollama",
      model: config.providers.ollama.models.fast,
      baseUrl: config.providers.ollama.baseUrl,
    });
    capable.push({
      type: "local",
      provider: "ollama",
      model: config.providers.ollama.models.capable,
      baseUrl: config.providers.ollama.baseUrl,
    });
  }

  // LM Studio / vLLM / generic OpenAI-compatible
  if (config.providers.lmstudio.enabled) {
    fast.push({
      type: "local",
      provider: "lmstudio",
      model: config.providers.lmstudio.models.fast,
      baseUrl: config.providers.lmstudio.baseUrl,
    });
    capable.push({
      type: "local",
      provider: "lmstudio",
      model: config.providers.lmstudio.models.capable,
      baseUrl: config.providers.lmstudio.baseUrl,
    });
  }

  if (config.providers.vllm.enabled) {
    fast.push({
      type: "local",
      provider: "vllm",
      model: config.providers.vllm.models.fast,
      baseUrl: config.providers.vllm.baseUrl,
    });
    capable.push({
      type: "local",
      provider: "vllm",
      model: config.providers.vllm.models.capable,
      baseUrl: config.providers.vllm.baseUrl,
    });
  }

  // HuggingFace
  if (config.providers.huggingface.enabled) {
    const hfKeyResult = await vault.get("provider:huggingface:api-key");
    const hfKey = hfKeyResult.isOk() && hfKeyResult.value ? hfKeyResult.value : undefined;

    if (config.providers.huggingface.inferenceApiModel) {
      capable.push({
        type: "huggingface",
        mode: "inference-api",
        model: config.providers.huggingface.inferenceApiModel,
        apiKey: hfKey,
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

// ── Adapter builder ───────────────────────────────────────────────────────────

async function buildAdapters(config: AdamConfig): Promise<BaseAdapter[]> {
  const adapters: BaseAdapter[] = [];

  // CLI adapter is always included
  adapters.push(new CliAdapter());

  if (config.adapters.telegram.enabled) {
    const keyResult = await vault.get("adapter:telegram:bot-token");
    const token = keyResult.isOk() && keyResult.value ? keyResult.value : null;

    if (!token) {
      logger.warn("Telegram adapter enabled but no bot token found in keychain — skipping");
    } else {
      adapters.push(new TelegramAdapter({ token }));
      logger.info("Telegram adapter configured");
    }
  }

  if (config.adapters.discord.enabled) {
    const keyResult = await vault.get("adapter:discord:bot-token");
    const token = keyResult.isOk() && keyResult.value ? keyResult.value : null;

    if (!token) {
      logger.warn("Discord adapter enabled but no bot token found in keychain — skipping");
    } else {
      adapters.push(
        new DiscordAdapter({ token, clientId: config.adapters.discord.clientId ?? "" }),
      );
      logger.info("Discord adapter configured");
    }
  }

  return adapters;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function logActiveProviders(config: AdamConfig): void {
  const active: string[] = [];

  const cloudProviders = ["anthropic", "openai", "google", "groq", "mistral", "deepseek", "openrouter"] as const;
  for (const name of cloudProviders) {
    if (config.providers[name].enabled) active.push(name);
  }
  if (config.providers.ollama.enabled) active.push("ollama");
  if (config.providers.lmstudio.enabled) active.push("lmstudio");
  if (config.providers.vllm.enabled) active.push("vllm");
  if (config.providers.huggingface.enabled) active.push("huggingface");

  logger.info(`Active providers: ${active.join(", ") || "none"}`);
}

function createHealthServer(config: AdamConfig) {
  return createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          version: ADAM_VERSION,
          uptime: process.uptime(),
          agentName: config.daemon.agentName,
        }),
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });
}

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

void main();
