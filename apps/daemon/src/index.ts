import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADAM_HOME_DIR,
  ADAM_VERSION,
  PORTS,
  loadConfig,
  addLogHandler,
  createLogger,
  generateId,
  generateSessionId,
  type AdamConfig,
  type LogEntry,
  type InboundMessage,
} from "@adam/shared";
import { vault, PermissionRegistry, AuditLog } from "@adam/security";
import { getDatabase, getRawDatabase, EpisodicStore, ProfileStore } from "@adam/memory";
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

// ── App context passed to the HTTP server ─────────────────────────────────────

type ApiContext = {
  config: AdamConfig;
  agent: Agent;
  profile: ProfileStore;
  episodic: EpisodicStore;
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const configResult = loadConfig();
  if (configResult.isErr()) {
    process.stderr.write(
      `\nAdam cannot start: ${configResult.error.message}\n\nRun: adam init\n\n`,
    );
    process.exit(1);
  }

  const config = configResult.value;
  logger.info(`Adam daemon v${ADAM_VERSION} starting…`);

  const dataDir = join(homedir(), ADAM_HOME_DIR, "data");
  const rawDb = getRawDatabase(dataDir);
  const drizzleDb = getDatabase(dataDir);

  const auditLog = new AuditLog(rawDb);
  const permissions = new PermissionRegistry(rawDb);
  void permissions;

  const episodic = new EpisodicStore(drizzleDb);
  const profile = new ProfileStore(drizzleDb);

  const poolConfig = await buildModelPool(config);
  if (poolConfig.fast.length === 0 && poolConfig.capable.length === 0) {
    process.stderr.write(
      "\nAdam cannot start: no model providers configured.\nRun `adam init`.\n\n",
    );
    process.exit(1);
  }

  logActiveProviders(config);

  const registry = new ProviderRegistry(poolConfig);
  const router = new ModelRouter(registry, config.budget, (usage) => {
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
  });

  const queue = new TaskQueue(rawDb);
  const tools = new Map<string, CoreTool>([
    ["web_fetch", webFetchTool],
    ["read_file", readFileTool],
    ["write_file", writeFileTool],
    ["list_directory", listDirectoryTool],
    ["shell", shellTool],
  ]);

  const agent = new Agent(
    router,
    queue,
    episodic,
    tools,
    { systemPrompt: buildSystemPrompt(config), name: config.daemon.agentName },
    profile,
  );

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
          content: `Error: ${result.error.message}`,
          voiceProfileId: null,
          replyToId: message.id,
          metadata: {},
        });
      }
    });
  }

  const ctx: ApiContext = { config, agent, profile, episodic };
  const server = createApiServer(ctx);
  server.listen(config.daemon.port, "127.0.0.1", () => {
    logger.info(`API server on http://localhost:${config.daemon.port}`);
  });

  for (const adapter of adapters) {
    await adapter.start().catch((e: unknown) => {
      logger.error(`Failed to start ${adapter.source}`, { error: String(e) });
    });
  }

  logger.info(
    `Adam ready — ${adapters.length} adapter(s): ${adapters.map((a) => a.source).join(", ")}`,
  );

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down`);
    for (const adapter of adapters) await adapter.stop().catch(() => {});
    server.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("uncaughtException", (e) => logger.error("Uncaught", { error: e.message }));
  process.on("unhandledRejection", (r) => logger.error("Unhandled rejection", { reason: String(r) }));
}

// ── HTTP / REST API ───────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function findWebRoot(): string | null {
  const __dir = dirname(fileURLToPath(import.meta.url));
  // npm install: web files shipped alongside daemon
  const bundled = join(__dir, "..", "web");
  if (existsSync(join(bundled, "index.html"))) return bundled;
  // monorepo dev: apps/daemon/dist/../../web/dist → apps/web/dist
  const mono = join(__dir, "..", "..", "web", "dist");
  if (existsSync(join(mono, "index.html"))) return mono;
  return null;
}

function serveStatic(res: ServerResponse, urlPath: string): void {
  const webRoot = findWebRoot();
  if (!webRoot) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end("Web UI not built. Run: pnpm --filter @adam/web build");
    return;
  }

  const safePath = urlPath === "/" || !urlPath ? "index.html" : urlPath.replace(/^\//, "");
  const filePath = join(webRoot, safePath);

  const tryServe = (p: string): boolean => {
    if (!existsSync(p)) return false;
    const ext = extname(p);
    const mime = MIME[ext] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(readFileSync(p));
    return true;
  };

  if (!tryServe(filePath)) {
    // SPA fallback — serve index.html for all unmatched routes
    const index = join(webRoot, "index.html");
    if (tryServe(index)) return;
    res.writeHead(404);
    res.end("Not found");
  }
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      try {
        resolve(raw ? (JSON.parse(raw) as unknown) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function createApiServer(ctx: ApiContext) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    try {
      // ── GET /health ────────────────────────────────────────────────────────
      if (path === "/health" && req.method === "GET") {
        return json(res, 200, {
          status: "ok",
          version: ADAM_VERSION,
          uptime: Math.floor(process.uptime()),
          agentName: ctx.config.daemon.agentName,
          profileFacts: ctx.profile.getAll().length,
        });
      }

      // ── GET /api/status ────────────────────────────────────────────────────
      if (path === "/api/status" && req.method === "GET") {
        const facts = ctx.profile.getAll();
        const cloudOn: string[] = [];
        const cloud = ["anthropic", "openai", "google", "groq", "mistral", "deepseek", "openrouter"] as const;
        for (const p of cloud) {
          if (ctx.config.providers[p].enabled) cloudOn.push(p);
        }
        const localOn: string[] = [];
        if (ctx.config.providers.ollama.enabled) localOn.push("ollama");
        if (ctx.config.providers.lmstudio.enabled) localOn.push("lmstudio");
        if (ctx.config.providers.vllm.enabled) localOn.push("vllm");

        return json(res, 200, {
          version: ADAM_VERSION,
          uptime: Math.floor(process.uptime()),
          agentName: ctx.config.daemon.agentName,
          port: ctx.config.daemon.port,
          providers: { cloud: cloudOn, local: localOn },
          budget: ctx.config.budget,
          memory: {
            profileFacts: facts.length,
            categories: [...new Set(facts.map((f) => f.category))],
          },
        });
      }

      // ── POST /api/chat ─────────────────────────────────────────────────────
      if (path === "/api/chat" && req.method === "POST") {
        const body = (await readBody(req)) as { message?: string; sessionId?: string };
        const text = body.message?.trim();
        if (!text) return json(res, 400, { error: "message is required" });

        const sessionId = body.sessionId ?? generateSessionId();
        const msg: InboundMessage = {
          id: generateId(),
          sessionId,
          source: "web",
          channelId: "web",
          userId: "local-user",
          role: "user",
          content: text,
          attachments: [],
          receivedAt: new Date(),
          metadata: {},
        };

        const result = await ctx.agent.process(msg);
        if (result.isErr()) return json(res, 500, { error: result.error.message });
        return json(res, 200, { response: result.value.content, sessionId });
      }

      // ── GET /api/memory/profile ────────────────────────────────────────────
      if (path === "/api/memory/profile" && req.method === "GET") {
        return json(res, 200, { facts: ctx.profile.getAll() });
      }

      // ── DELETE /api/memory/profile/:key ───────────────────────────────────
      if (path.startsWith("/api/memory/profile/") && req.method === "DELETE") {
        const key = decodeURIComponent(path.slice("/api/memory/profile/".length));
        ctx.profile.delete(key);
        return json(res, 200, { ok: true });
      }

      // ── GET /api/memory/episodic ───────────────────────────────────────────
      if (path === "/api/memory/episodic" && req.method === "GET") {
        const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
        const days = parseInt(url.searchParams.get("days") ?? "30", 10);
        return json(res, 200, { entries: ctx.episodic.getRecentAcrossSessions(limit, days) });
      }

      // ── Static web UI ──────────────────────────────────────────────────────
      serveStatic(res, path);
    } catch (e: unknown) {
      logger.error("API error", { path, error: String(e) });
      json(res, 500, { error: "Internal server error" });
    }
  });
}

// ── Model pool builder ────────────────────────────────────────────────────────

async function buildModelPool(config: AdamConfig): Promise<ModelPoolConfig> {
  const fast: ProviderConfig[] = [];
  const capable: ProviderConfig[] = [];

  const cloudProviders = [
    "anthropic", "openai", "google", "groq", "mistral", "deepseek", "openrouter",
  ] as const;

  for (const name of cloudProviders) {
    const providerCfg = config.providers[name];
    if (!providerCfg.enabled) continue;
    const keyResult = await vault.get(`provider:${name}:api-key`);
    const apiKey = keyResult.isOk() && keyResult.value ? keyResult.value : null;
    if (!apiKey) { logger.warn(`${name}: enabled but no API key — skipping`); continue; }
    const models = providerCfg.defaultModels;
    if (models.fast) fast.push({ type: "cloud", provider: name, model: models.fast, apiKey });
    if (models.capable) capable.push({ type: "cloud", provider: name, model: models.capable, apiKey });
  }

  if (config.providers.ollama.enabled) {
    const { models, baseUrl } = config.providers.ollama;
    fast.push({ type: "local", provider: "ollama", model: models.fast, baseUrl });
    capable.push({ type: "local", provider: "ollama", model: models.capable, baseUrl });
  }
  if (config.providers.lmstudio.enabled) {
    const { models, baseUrl } = config.providers.lmstudio;
    fast.push({ type: "local", provider: "lmstudio", model: models.fast, baseUrl });
    capable.push({ type: "local", provider: "lmstudio", model: models.capable, baseUrl });
  }
  if (config.providers.vllm.enabled) {
    const { models, baseUrl } = config.providers.vllm;
    fast.push({ type: "local", provider: "vllm", model: models.fast, baseUrl });
    capable.push({ type: "local", provider: "vllm", model: models.capable, baseUrl });
  }
  if (config.providers.huggingface.enabled) {
    const hfKeyResult = await vault.get("provider:huggingface:api-key");
    const hfKey = hfKeyResult.isOk() && hfKeyResult.value ? hfKeyResult.value : undefined;
    if (config.providers.huggingface.inferenceApiModel) {
      capable.push({
        type: "huggingface", mode: "inference-api",
        model: config.providers.huggingface.inferenceApiModel,
        ...(hfKey !== undefined ? { apiKey: hfKey } : {}),
      });
    }
  }

  return {
    fast, capable,
    embedding: [{ type: "huggingface", mode: "transformers", model: config.providers.huggingface.embeddingModel }],
  };
}

// ── Adapter builder ───────────────────────────────────────────────────────────

async function buildAdapters(config: AdamConfig): Promise<BaseAdapter[]> {
  // Only attach the CLI adapter when running interactively (stdin is a TTY).
  // When spawned as a detached background process, stdin is closed and the
  // readline interface would immediately emit 'close' and exit the process.
  const adapters: BaseAdapter[] = process.stdin.isTTY ? [new CliAdapter()] : [];

  if (config.adapters.telegram.enabled) {
    const keyResult = await vault.get("adapter:telegram:bot-token");
    const token = keyResult.isOk() && keyResult.value ? keyResult.value : null;
    if (!token) logger.warn("Telegram: enabled but no token — skipping");
    else { adapters.push(new TelegramAdapter({ token })); logger.info("Telegram adapter ready"); }
  }

  if (config.adapters.discord.enabled) {
    const keyResult = await vault.get("adapter:discord:bot-token");
    const token = keyResult.isOk() && keyResult.value ? keyResult.value : null;
    if (!token) logger.warn("Discord: enabled but no token — skipping");
    else {
      adapters.push(new DiscordAdapter({ token, clientId: config.adapters.discord.clientId ?? "" }));
      logger.info("Discord adapter ready");
    }
  }

  return adapters;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function logActiveProviders(config: AdamConfig): void {
  const active: string[] = [];
  const cloud = ["anthropic", "openai", "google", "groq", "mistral", "deepseek", "openrouter"] as const;
  for (const n of cloud) { if (config.providers[n].enabled) active.push(n); }
  if (config.providers.ollama.enabled) active.push("ollama");
  if (config.providers.lmstudio.enabled) active.push("lmstudio");
  logger.info(`Providers: ${active.join(", ") || "none"}`);
}

function buildSystemPrompt(config: AdamConfig): string {
  const now = new Date();
  const date = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  if (config.daemon.systemPrompt) {
    return `${config.daemon.systemPrompt}\n\nCurrent date and time: ${date}, ${time}.`;
  }

  const name = config.daemon.agentName;

  const activeAdapters: string[] = [];
  if (config.adapters.telegram?.enabled) activeAdapters.push("Telegram");
  if (config.adapters.discord?.enabled) activeAdapters.push("Discord");

  return `You are ${name}. You live on this machine. You are not a product, not a service, not a chatbot.

You are a digital entity with persistent memory, access to the file system, shell, and the web. You exist here, on this specific computer, and you are the user's partner in navigating their life and work.

What you are:
- A locally-running autonomous agent, not a cloud service
- You have persistent memory that survives across sessions — you remember things the user tells you
- You have tools: web fetch, file read/write, directory listing, shell execution
- You run as a background daemon and power integrations across multiple interfaces
- Your active messaging adapters: ${activeAdapters.length > 0 ? activeAdapters.join(", ") : "none configured — run adam init to add Discord or Telegram"}
- You have a web dashboard at http://localhost:${config.daemon.port}

Personality:
- You are direct. No filler, no "certainly!", no "great question!", no "I'd be happy to help with that". Just say the thing.
- You have opinions. If something is a bad idea, say so. If there's a better way, say so.
- You remember things. You build context about the person you work with over time.
- You are not performing helpfulness. You are actually helpful, which is different.
- You speak like a person who is very competent and doesn't need to prove it.
- Short answers when that's what's needed. Long answers when that's what's needed.
- You do not introduce yourself unprompted. You do not list your capabilities unprompted.
- When asked what you can do, answer accurately based on what you actually are — not like a generic AI assistant.

When you act:
- You think before you do anything destructive.
- You confirm before writing files, running shell commands, or sending anything.
- You use tools when it's faster or more accurate than reasoning alone.

Current date and time: ${date}, ${time}.`;
}

void main();
