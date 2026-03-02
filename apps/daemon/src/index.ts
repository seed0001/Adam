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
  saveConfig,
  addLogHandler,
  createLogger,
  generateId,
  generateSessionId,
  type AdamConfig,
  type DiscordAdapterConfig,
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
import { Agent, TaskQueue, PersonalityStore, MemoryConsolidator, ScratchpadStore } from "@adam/core";
import { SkillStore } from "@adam/skills";
import { tool } from "ai";
import { z } from "zod";
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
  createCodeTools,
} from "@adam/skills";
import { BrowserSession } from "./browser.js";
import type { CoreTool } from "ai";

const logger = createLogger("daemon");

// Single browser session — lazy-started on first tool call, reused for the daemon's lifetime.
// Headed (visible) so the user can watch Adam navigate in real time.
const browserSession = new BrowserSession(false);

addLogHandler((entry: LogEntry) => {
  const prefix = entry.context ? `[${entry.context}]` : "";
  const msg = `${entry.timestamp.toISOString()} [${entry.level.toUpperCase()}]${prefix} ${entry.message}`;
  if (entry.level === "error") process.stderr.write(msg + "\n");
  else process.stdout.write(msg + "\n");
});

// ── App context passed to the HTTP server ─────────────────────────────────────

// Mutable wrapper so PATCH endpoints can update config in place
type ApiContext = {
  config: AdamConfig;
  agent: Agent;
  router: ModelRouter;
  profile: ProfileStore;
  episodic: EpisodicStore;
  discordAdapter: DiscordAdapter | null;
  personality: PersonalityStore;
  scratchpad: ScratchpadStore;
  skills: SkillStore;
  consolidator: MemoryConsolidator;
};

type AdapterBundle = { adapters: BaseAdapter[]; discordAdapter: DiscordAdapter | null };

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
  const personality = new PersonalityStore(config.daemon.agentName);
  const scratchpad = new ScratchpadStore();
  const skills = new SkillStore();

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

  // Build adapters first so we can create Discord tools with a live adapter reference
  const { adapters, discordAdapter } = await buildAdapters(config);

  const tools = new Map<string, CoreTool>([
    ["web_fetch", webFetchTool],
    ["read_file", readFileTool],
    ["write_file", writeFileTool],
    ["list_directory", listDirectoryTool],
    ["shell", shellTool],
  ]);

  // Discord outbound tools — only available when the Discord adapter is running
  if (discordAdapter) {
    tools.set(
      "list_discord_channels",
      tool({
        description:
          "List every Discord guild and text channel the bot is connected to. " +
          "Call this first to find channel IDs before posting a message.",
        parameters: z.object({}),
        execute: async () => ({ guilds: discordAdapter.listChannels() }),
      }),
    );

    tools.set(
      "send_discord_dm",
      tool({
        description:
          "Send a direct message (DM) to a Discord user by their username or numeric user ID. " +
          "The bot must share at least one server with the user. " +
          "Try the username first (e.g. 'solonaras2'). If that fails, ask the user for their numeric ID. " +
          "Always confirm with the user before sending unless explicitly told not to.",
        parameters: z.object({
          usernameOrId: z
            .string()
            .describe("Discord username (e.g. solonaras2) or numeric snowflake user ID"),
          content: z.string().describe("The message to send"),
        }),
        execute: async ({ usernameOrId, content }) => {
          return await discordAdapter.dmUser(usernameOrId, content);
        },
      }),
    );

    tools.set(
      "read_discord_dm",
      tool({
        description:
          "Read the recent DM conversation history between the bot and a Discord user. " +
          "Use this to check if someone replied, see what was said, or get context before responding. " +
          "Accepts a username (e.g. solonaras2) or numeric user ID.",
        parameters: z.object({
          usernameOrId: z
            .string()
            .describe("Discord username or numeric snowflake user ID"),
          limit: z
            .number()
            .int()
            .min(1)
            .max(50)
            .default(20)
            .describe("Number of recent messages to fetch (default 20, max 50)"),
        }),
        execute: async ({ usernameOrId, limit }) => {
          return await discordAdapter.readDmHistory(usernameOrId, limit);
        },
      }),
    );

    tools.set(
      "read_discord_messages",
      tool({
        description:
          "Read recent messages from a Discord channel. " +
          "Use list_discord_channels first if you don't know the channel ID. " +
          "Useful for catching up on activity or checking if someone replied in a channel.",
        parameters: z.object({
          channelId: z.string().describe("The Discord channel ID to read from"),
          limit: z
            .number()
            .int()
            .min(1)
            .max(50)
            .default(20)
            .describe("Number of recent messages to fetch (default 20, max 50)"),
        }),
        execute: async ({ channelId, limit }) => {
          return await discordAdapter.readChannelMessages(channelId, limit);
        },
      }),
    );

    tools.set(
      "send_discord_message",
      tool({
        description:
          "Post a message to a specific Discord channel. " +
          "Use list_discord_channels first if you don't already know the channel ID. " +
          "Confirm with the user before sending unless explicitly told not to.",
        parameters: z.object({
          channelId: z.string().describe("The Discord channel ID to post to"),
          content: z.string().describe("The message to send"),
        }),
        execute: async ({ channelId, content }) => {
          await discordAdapter.sendToChannel(channelId, content);
          logger.info("Outbound Discord message sent", { channelId, length: content.length });
          return { success: true, channelId, preview: content.slice(0, 120) };
        },
      }),
    );

    logger.info("Discord tools registered (send_discord_dm, send_discord_message, read_discord_dm, read_discord_messages, list_discord_channels)");
  }

  // Code tools — model-backed, routed to the coder tier (DeepSeek Coder / Qwen2.5-Coder).
  // Falls back to capable if no dedicated coder model is configured.
  // Relative paths in code tools resolve against the workspace directory.
  const workspace = resolveWorkspace(config);
  const codeTools = createCodeTools(router, generateId(), workspace);
  for (const [name, t] of codeTools) tools.set(name, t);
  if (poolConfig.coder.length > 0) {
    logger.info(`Code tools active — coder: ${poolConfig.coder[0]?.model ?? "unknown"}, workspace: ${workspace}`);
  } else {
    logger.info(`Code tools active (no coder model set, falling back to capable) — workspace: ${workspace}`);
  }

  // ── Browser tools ─────────────────────────────────────────────────────────
  // Playwright-backed real browser (headed, visible to user).
  // One persistent session per daemon run — navigate, click, type, read, screenshot.

  tools.set(
    "browser_navigate",
    tool({
      description:
        "Open a URL in a real Chromium browser window (visible on screen) and return the page title and text content. " +
        "Use this instead of web_fetch for JavaScript-heavy sites, login flows, interactive pages, or any time you need to actually browse. " +
        "The browser will pop up on the user's screen.",
      parameters: z.object({
        url: z.string().describe("Full URL to navigate to (include https://)"),
      }),
      execute: async ({ url }) => browserSession.navigate(url),
    }),
  );

  tools.set(
    "browser_click",
    tool({
      description:
        "Click an element on the current browser page. " +
        "Provide either a CSS selector (e.g. '#submit', 'button.login') or the visible text of the element (e.g. 'Sign In', 'Next'). " +
        "Returns the updated page content after the click.",
      parameters: z.object({
        selectorOrText: z
          .string()
          .describe("CSS selector or visible text label of the element to click"),
      }),
      execute: async ({ selectorOrText }) => browserSession.click(selectorOrText),
    }),
  );

  tools.set(
    "browser_type",
    tool({
      description:
        "Type text into an input field on the current browser page. " +
        "Use a CSS selector for the target field (e.g. 'input[name=\"q\"]', '#email', 'textarea'). " +
        "Set submit=true to press Enter after typing (useful for search boxes).",
      parameters: z.object({
        selector: z.string().describe("CSS selector for the input or textarea"),
        text: z.string().describe("Text to type"),
        submit: z
          .boolean()
          .default(false)
          .describe("Press Enter after typing (default false)"),
      }),
      execute: async ({ selector, text, submit }) => browserSession.type(selector, text, submit),
    }),
  );

  tools.set(
    "browser_content",
    tool({
      description:
        "Get the current page's visible text content without navigating anywhere. " +
        "Use this after clicking or interacting to read what changed on the page.",
      parameters: z.object({}),
      execute: async () => browserSession.getContent(),
    }),
  );

  tools.set(
    "browser_screenshot",
    tool({
      description:
        "Take a screenshot of the current browser page and save it to the workspace. " +
        "Useful for capturing results, confirming state, or sharing what the browser is showing.",
      parameters: z.object({
        filename: z
          .string()
          .optional()
          .describe("Filename for the screenshot (e.g. 'result.png'). Saved to workspace."),
      }),
      execute: async ({ filename }) => {
        const path = filename
          ? join(workspace, filename)
          : join(workspace, `screenshot-${Date.now()}.png`);
        return browserSession.screenshot(path);
      },
    }),
  );

  tools.set(
    "browser_scroll",
    tool({
      description: "Scroll the current browser page up or down to reveal more content.",
      parameters: z.object({
        direction: z.enum(["up", "down"]),
        pixels: z
          .number()
          .int()
          .min(100)
          .max(5000)
          .default(600)
          .describe("How many pixels to scroll"),
      }),
      execute: async ({ direction, pixels }) => browserSession.scroll(direction, pixels),
    }),
  );

  tools.set(
    "browser_back",
    tool({
      description: "Navigate back to the previous page in the browser history.",
      parameters: z.object({}),
      execute: async () => browserSession.goBack(),
    }),
  );

  tools.set(
    "browser_new_tab",
    tool({
      description:
        "Open a new browser tab, optionally navigating to a URL. " +
        "Use this to open a second page without losing the current one.",
      parameters: z.object({
        url: z.string().optional().describe("URL to open in the new tab (optional)"),
      }),
      execute: async ({ url }) => browserSession.newTab(url),
    }),
  );

  tools.set(
    "browser_close",
    tool({
      description: "Close the browser session when you are completely done browsing.",
      parameters: z.object({}),
      execute: async () => {
        await browserSession.close();
        return { closed: true };
      },
    }),
  );

  logger.info("Browser tools registered (browser_navigate, browser_click, browser_type, browser_content, browser_screenshot, browser_scroll, browser_back, browser_new_tab, browser_close)");

  const agent = new Agent(
    router,
    queue,
    episodic,
    tools,
    { systemPrompt: buildSystemPrompt(config), name: config.daemon.agentName },
    profile,
    personality,
    scratchpad,
    skills,
  );

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

  // Start the stochastic memory consolidator — decays unused facts, extracts
  // durable knowledge from old episodes. No global clock; fires at random intervals.
  const consolidator = new MemoryConsolidator(profile, episodic, router, {
    decayHalfLifeDays: config.memory.decayHalfLifeDays,
    decayMinConfidence: config.memory.decayMinConfidence,
    consolidateAfterDays: config.memory.consolidateAfterDays,
  });
  consolidator.start();

  const ctx: ApiContext = { config, agent, router, profile, episodic, discordAdapter, personality, scratchpad, skills, consolidator };
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
    consolidator.stop();
    for (const adapter of adapters) await adapter.stop().catch(() => {});
    await browserSession.close().catch(() => {});
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

        // Derive active provider lists from the actual loaded pool —
        // these are vault-verified at startup/reload, not just config flags.
        const pool = ctx.router.getPool();
        const toLabel = (cfg: { type: string; provider?: string; model: string } | undefined) =>
          cfg ? `${cfg.type === "cloud" ? (cfg as { provider: string }).provider : cfg.type}/${cfg.model}` : null;

        const activeModels = {
          fast: toLabel(pool.fast[0]),
          capable: toLabel(pool.capable[0]),
        };

        const cloudOn = [...new Set(
          pool.fast.concat(pool.capable)
            .filter((c) => c.type === "cloud")
            .map((c) => (c as { provider: string }).provider)
        )];
        const localOn = [...new Set(
          pool.fast.concat(pool.capable)
            .filter((c) => c.type === "local")
            .map((c) => (c as { provider: string }).provider)
        )];

        return json(res, 200, {
          version: ADAM_VERSION,
          uptime: Math.floor(process.uptime()),
          agentName: ctx.config.daemon.agentName,
          port: ctx.config.daemon.port,
          providers: { cloud: cloudOn, local: localOn },
          activeModels,
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

        // ── Slash command interception ──────────────────────────────────────
        // Handle /commands directly so they don't reach the agent as natural
        // language and accidentally trigger skill design mode.

        if (text.startsWith("/remember ")) {
          const rest = text.slice("/remember ".length).trim();
          const eqIdx = rest.indexOf("=");
          if (eqIdx !== -1) {
            const key = rest.slice(0, eqIdx).trim();
            const val = rest.slice(eqIdx + 1).trim();
            ctx.profile.insert(key, val, "manual");
            ctx.profile.protect(key);
            return json(res, 200, { response: `Stored and protected: **${key}** = ${val}`, sessionId });
          }
          return json(res, 200, { response: "Usage: /remember key = value", sessionId });
        }

        if (text.startsWith("/forget ")) {
          const key = text.slice("/forget ".length).trim();
          if (key === "all") {
            for (const f of ctx.profile.getAll()) ctx.profile.delete(f.key);
            return json(res, 200, { response: "All profile memory cleared.", sessionId });
          }
          ctx.profile.delete(key);
          return json(res, 200, { response: `Deleted memory: **${key}**`, sessionId });
        }

        if (text === "/memory") {
          const facts = ctx.profile.getAll();
          if (!facts.length) return json(res, 200, { response: "No profile memory stored yet.", sessionId });
          const lines = facts.map((f) => {
            const pct = Math.round(f.confidence * 100);
            const bar = "█".repeat(Math.round(f.confidence * 10)) + "░".repeat(10 - Math.round(f.confidence * 10));
            const badge = f.protected ? "🔒" : f.source === "manual" ? "✋" : "🤖";
            return `${badge} **${f.key}** = ${f.value}\n   ${bar} ${pct}%`;
          });
          return json(res, 200, { response: lines.join("\n\n"), sessionId });
        }

        if (text === "/pad") {
          const content = ctx.scratchpad.load();
          return json(res, 200, { response: content || "Scratchpad is empty.", sessionId });
        }

        if (text === "/pad clear") {
          const { unlinkSync, existsSync } = await import("node:fs");
          if (existsSync(ctx.scratchpad.path)) unlinkSync(ctx.scratchpad.path);
          return json(res, 200, { response: "Scratchpad cleared.", sessionId });
        }

        if (text === "/workshop" || text === "/skills") {
          const skills = ctx.skills.list();
          if (!skills.length) return json(res, 200, { response: "No skill specs found.", sessionId });
          const lines = skills.map((s) => `**${s.status.toUpperCase()}** · ${s.name} · \`${s.id}\``);
          return json(res, 200, { response: lines.join("\n"), sessionId });
        }

        if (text.startsWith("/workshop show ")) {
          const id = text.slice("/workshop show ".length).trim().replace(/"/g, "");
          const skill = ctx.skills.get(id);
          if (!skill) return json(res, 200, { response: `Skill not found: \`${id}\``, sessionId });
          const steps = skill.steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
          const triggers = skill.triggers.join(", ");
          const tools = skill.allowedTools.join(", ");
          const out = [
            `📋 **${skill.name}** \`${skill.id}\``,
            `*${skill.description}*`,
            ``,
            `**Status:** ${skill.status}`,
            `**Triggers:** ${triggers}`,
            `**Tools allowed:** ${tools}`,
            ``,
            `**Steps:**\n${steps}`,
            skill.constraints?.length ? `\n**Constraints:** ${skill.constraints.join(", ")}` : "",
            `\n**Success when:** ${skill.successCriteria}`,
          ].filter(Boolean).join("\n");
          return json(res, 200, { response: out, sessionId });
        }

        if (text.startsWith("/workshop approve ")) {
          const id = text.slice("/workshop approve ".length).trim().replace(/"/g, "");
          const existing = ctx.skills.get(id);
          if (!existing) return json(res, 200, { response: `Skill not found: \`${id}\`\n\nRun \`/workshop\` to list all skills and check the ID.`, sessionId });
          if (existing.status !== "draft") return json(res, 200, { response: `Cannot approve \`${existing.name}\` — current status is **${existing.status}**, not draft.\n\nOnly draft skills can be approved.`, sessionId });
          const skill = ctx.skills.approve(id)!;
          return json(res, 200, { response: `✅ Approved: **${skill.name}** (\`${skill.id}\`)\nStatus: draft → approved\n\nRun \`/workshop latent ${id}\` to mark it latent, or view it in the Skills tab.`, sessionId });
        }

        if (text.startsWith("/workshop latent ")) {
          const id = text.slice("/workshop latent ".length).trim().replace(/"/g, "");
          const existing = ctx.skills.get(id);
          if (!existing) return json(res, 200, { response: `Skill not found: \`${id}\``, sessionId });
          if (!["draft", "approved"].includes(existing.status)) return json(res, 200, { response: `Cannot mark \`${existing.name}\` as latent — current status is **${existing.status}**.`, sessionId });
          const skill = ctx.skills.makeLatent(id)!;
          return json(res, 200, { response: `💤 Marked latent: **${skill.name}** (\`${skill.id}\`)\nStatus: ${existing.status} → latent`, sessionId });
        }

        if (text.startsWith("/workshop deprecate ")) {
          const id = text.slice("/workshop deprecate ".length).trim().replace(/"/g, "");
          const existing = ctx.skills.get(id);
          if (!existing) return json(res, 200, { response: `Skill not found: \`${id}\``, sessionId });
          const skill = ctx.skills.deprecate(id)!;
          return json(res, 200, { response: `🗑️ Deprecated: **${skill.name}** (\`${skill.id}\`)`, sessionId });
        }

        if (text === "/help") {
          return json(res, 200, { response: [
            "**Slash commands available in chat:**",
            "",
            "`/memory` — show profile facts with confidence levels",
            "`/remember key = value` — store a protected memory fact",
            "`/forget key` — delete a memory fact",
            "`/forget all` — clear all profile memory",
            "`/pad` — view Adam's scratchpad",
            "`/pad clear` — clear the scratchpad",
            "`/workshop` — list all skill specs",
            "`/workshop show <id>` — view a skill spec",
            "`/workshop approve <id>` — approve a draft skill",
            "`/workshop latent <id>` — mark a skill as latent",
            "`/workshop deprecate <id>` — deprecate a skill",
            "`/help` — show this list",
          ].join("\n"), sessionId });
        }

        // ── Normal agent message ────────────────────────────────────────────
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

      // ── GET /api/config ────────────────────────────────────────────────────
      if (path === "/api/config" && req.method === "GET") {
        return json(res, 200, {
          daemon: ctx.config.daemon,
          discord: ctx.config.adapters.discord,
          telegram: ctx.config.adapters.telegram,
          budget: ctx.config.budget,
        });
      }

      // ── PATCH /api/config/discord ──────────────────────────────────────────
      if (path === "/api/config/discord" && req.method === "PATCH") {
        const patch = (await readBody(req)) as Partial<DiscordAdapterConfig>;
        const updated: AdamConfig = {
          ...ctx.config,
          adapters: {
            ...ctx.config.adapters,
            discord: { ...ctx.config.adapters.discord, ...patch },
          },
        };
        const saveResult = saveConfig(updated);
        if (saveResult.isErr()) return json(res, 500, { error: saveResult.error.message });
        ctx.config = updated;
        // Hot-reload the Discord adapter if it's running
        if (ctx.discordAdapter) ctx.discordAdapter.updateConfig(updated.adapters.discord);
        return json(res, 200, { ok: true, config: updated.adapters.discord });
      }

      // ── PATCH /api/config/daemon ───────────────────────────────────────────
      if (path === "/api/config/daemon" && req.method === "PATCH") {
        const patch = (await readBody(req)) as Partial<AdamConfig["daemon"]>;
        const updated: AdamConfig = {
          ...ctx.config,
          daemon: { ...ctx.config.daemon, ...patch },
        };
        const saveResult = saveConfig(updated);
        if (saveResult.isErr()) return json(res, 500, { error: saveResult.error.message });
        ctx.config = updated;
        return json(res, 200, { ok: true, config: updated.daemon });
      }

      // ── PATCH /api/config/budget ───────────────────────────────────────────
      if (path === "/api/config/budget" && req.method === "PATCH") {
        const patch = (await readBody(req)) as Partial<AdamConfig["budget"]>;
        const updated: AdamConfig = {
          ...ctx.config,
          budget: { ...ctx.config.budget, ...patch },
        };
        const saveResult = saveConfig(updated);
        if (saveResult.isErr()) return json(res, 500, { error: saveResult.error.message });
        ctx.config = updated;
        return json(res, 200, { ok: true, config: updated.budget });
      }

      // ── GET /api/config/memory ─────────────────────────────────────────────
      if (path === "/api/config/memory" && req.method === "GET") {
        return json(res, 200, { memory: ctx.config.memory });
      }

      // ── PATCH /api/config/memory ───────────────────────────────────────────
      if (path === "/api/config/memory" && req.method === "PATCH") {
        const patch = (await readBody(req)) as Partial<AdamConfig["memory"]>;
        const updated: AdamConfig = {
          ...ctx.config,
          memory: { ...ctx.config.memory, ...patch },
        };
        const saveResult = saveConfig(updated);
        if (saveResult.isErr()) return json(res, 500, { error: saveResult.error.message });
        ctx.config = updated;
        // Hot-reload consolidator parameters immediately
        if (ctx.consolidator) ctx.consolidator.updateOptions(patch);
        return json(res, 200, { ok: true, config: updated.memory });
      }

      // ── GET /api/vault/status ─────────────────────────────────────────────
      if (path === "/api/vault/status" && req.method === "GET") {
        const keys = [
          "provider:anthropic:api-key",
          "provider:openai:api-key",
          "provider:google:api-key",
          "provider:groq:api-key",
          "provider:xai:api-key",
          "provider:mistral:api-key",
          "provider:deepseek:api-key",
          "provider:openrouter:api-key",
          "provider:huggingface:api-key",
          "adapter:discord:bot-token",
          "adapter:telegram:bot-token",
        ];
        const status: Record<string, boolean> = {};
        for (const key of keys) {
          const r = await vault.get(key);
          status[key] = r.isOk() && !!r.value;
        }
        return json(res, 200, { status });
      }

      // ── POST /api/vault/set ────────────────────────────────────────────────
      if (path === "/api/vault/set" && req.method === "POST") {
        const body = (await readBody(req)) as { key?: string; value?: string };
        if (!body.key || typeof body.value !== "string") {
          return json(res, 400, { error: "key and value are required" });
        }
        const trimmed = body.value.trim();
        if (!trimmed) return json(res, 400, { error: "value cannot be empty" });
        const r = await vault.set(body.key, trimmed);
        if (r.isErr()) return json(res, 500, { error: r.error.message });
        return json(res, 200, { ok: true });
      }

      // ── DELETE /api/vault/key ──────────────────────────────────────────────
      if (path === "/api/vault/key" && req.method === "DELETE") {
        const body = (await readBody(req)) as { key?: string };
        if (!body.key) return json(res, 400, { error: "key is required" });
        const dr = await vault.delete(body.key);
        if (dr.isErr()) return json(res, 500, { error: dr.error.message });
        return json(res, 200, { ok: true });
      }

      // ── GET /api/config/providers ──────────────────────────────────────────
      if (path === "/api/config/providers" && req.method === "GET") {
        return json(res, 200, { providers: ctx.config.providers });
      }

      // ── PATCH /api/config/providers ────────────────────────────────────────
      if (path === "/api/config/providers" && req.method === "PATCH") {
        const patch = (await readBody(req)) as Partial<AdamConfig["providers"]>;
        const updated: AdamConfig = {
          ...ctx.config,
          providers: { ...ctx.config.providers, ...patch },
        };
        const saveResult = saveConfig(updated);
        if (saveResult.isErr()) return json(res, 500, { error: saveResult.error.message });
        ctx.config = updated;

        // Rebuild the model pool from the new config so the change takes effect
        // immediately — no restart required.
        const newPool = await buildModelPool(updated);
        ctx.router.replaceRegistry(new ProviderRegistry(newPool));
        logger.info("Model pool hot-reloaded after provider config change");

        return json(res, 200, { ok: true, providers: updated.providers });
      }

      // ── GET /api/personality ───────────────────────────────────────────────
      if (path === "/api/personality" && req.method === "GET") {
        return json(res, 200, {
          content: ctx.personality.loadOrSeed(),
          path: ctx.personality.path,
        });
      }

      // ── PATCH /api/personality ─────────────────────────────────────────────
      if (path === "/api/personality" && req.method === "PATCH") {
        const body = (await readBody(req)) as { content?: string };
        if (typeof body.content !== "string" || !body.content.trim()) {
          return json(res, 400, { error: "content is required" });
        }
        ctx.personality.save(body.content);
        return json(res, 200, { ok: true, content: ctx.personality.load() });
      }

      // ── POST /api/personality/reset ────────────────────────────────────────
      if (path === "/api/personality/reset" && req.method === "POST") {
        ctx.personality.reset();
        return json(res, 200, { ok: true, content: ctx.personality.load() });
      }

      // ── GET /api/scratchpad ────────────────────────────────────────────────
      if (path === "/api/scratchpad" && req.method === "GET") {
        return json(res, 200, {
          content: ctx.scratchpad.load(),
          lastModified: ctx.scratchpad.lastModified()?.toISOString() ?? null,
          path: ctx.scratchpad.path,
        });
      }

      // ── PATCH /api/scratchpad ──────────────────────────────────────────────
      if (path === "/api/scratchpad" && req.method === "PATCH") {
        const body = (await readBody(req)) as { content?: string };
        if (typeof body.content !== "string") {
          return json(res, 400, { error: "content is required" });
        }
        ctx.scratchpad.save(body.content);
        return json(res, 200, { ok: true, lastModified: ctx.scratchpad.lastModified()?.toISOString() });
      }

      // ── DELETE /api/scratchpad ─────────────────────────────────────────────
      if (path === "/api/scratchpad" && req.method === "DELETE") {
        const { unlinkSync, existsSync } = await import("node:fs");
        if (existsSync(ctx.scratchpad.path)) unlinkSync(ctx.scratchpad.path);
        return json(res, 200, { ok: true });
      }

      // ── GET /api/skills ────────────────────────────────────────────────────
      if (path === "/api/skills" && req.method === "GET") {
        return json(res, 200, { skills: ctx.skills.list() });
      }

      // ── GET /api/skills/:id ────────────────────────────────────────────────
      if (path.startsWith("/api/skills/") && req.method === "GET" && !path.includes("/action/")) {
        const id = path.slice("/api/skills/".length);
        const skill = ctx.skills.get(id);
        if (!skill) return json(res, 404, { error: "Skill not found" });
        return json(res, 200, { skill });
      }

      // ── PATCH /api/skills/:id ──────────────────────────────────────────────
      if (path.startsWith("/api/skills/") && req.method === "PATCH" && !path.includes("/action/")) {
        const id = path.slice("/api/skills/".length);
        const skill = ctx.skills.get(id);
        if (!skill) return json(res, 404, { error: "Skill not found" });
        const patch = (await readBody(req)) as Partial<typeof skill>;
        // Only allow editing notes and steps on drafts — status changes go through actions
        if (skill.status === "draft") {
          if (patch.notes !== undefined) skill.notes = patch.notes;
          if (patch.steps !== undefined) skill.steps = patch.steps;
          if (patch.constraints !== undefined) skill.constraints = patch.constraints;
          if (patch.successCriteria !== undefined) skill.successCriteria = patch.successCriteria;
        }
        ctx.skills.save(skill);
        return json(res, 200, { ok: true, skill });
      }

      // ── DELETE /api/skills/:id ─────────────────────────────────────────────
      if (path.startsWith("/api/skills/") && req.method === "DELETE" && !path.includes("/action/")) {
        const id = path.slice("/api/skills/".length);
        const deleted = ctx.skills.delete(id);
        return json(res, deleted ? 200 : 404, { ok: deleted });
      }

      // ── POST /api/skills/:id/action/:action ────────────────────────────────
      // Lifecycle transitions — these are the only gates to status changes
      if (path.startsWith("/api/skills/") && path.includes("/action/") && req.method === "POST") {
        const parts = path.split("/");
        const id = parts[3];
        const action = parts[5];
        let updated = null;

        if (action === "approve") updated = ctx.skills.approve(id);
        else if (action === "latent") updated = ctx.skills.makeLatent(id);
        else if (action === "deprecate") updated = ctx.skills.deprecate(id);
        else if (action === "activate") {
          const body = (await readBody(req)) as { template?: string };
          const template = (body.template ?? "none") as Parameters<typeof ctx.skills.activate>[1];
          updated = ctx.skills.activate(id, template);
        }

        if (!updated) return json(res, 400, { error: `Cannot apply action '${action}' to this skill in its current state` });
        return json(res, 200, { ok: true, skill: updated });
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
  const coder: ProviderConfig[] = [];

  const cloudProviders = [
    "anthropic", "openai", "google", "groq", "xai", "mistral", "deepseek", "openrouter",
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
    // Dedicated coder model — routes code_write/edit/scaffold tools
    if (models.coder) {
      coder.push({ type: "local", provider: "ollama", model: models.coder, baseUrl });
    }
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
    fast, capable, coder,
    embedding: [{ type: "huggingface", mode: "transformers", model: config.providers.huggingface.embeddingModel }],
  };
}

// ── Adapter builder ───────────────────────────────────────────────────────────

async function buildAdapters(config: AdamConfig): Promise<AdapterBundle> {
  const adapters: BaseAdapter[] = process.stdin.isTTY ? [new CliAdapter()] : [];
  let discordAdapter: DiscordAdapter | null = null;

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
      discordAdapter = new DiscordAdapter(token, config.adapters.discord);
      adapters.push(discordAdapter);
      logger.info("Discord adapter ready");
    }
  }

  return { adapters, discordAdapter };
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
  if (config.daemon.systemPrompt) {
    return config.daemon.systemPrompt;
  }

  const name = config.daemon.agentName;
  const workspace = resolveWorkspace(config);

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
- Your workspace directory is: ${workspace} — ALL projects, apps, and files you create go here unless the user specifies otherwise. Always use absolute paths under this directory. Never use relative paths.

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
- web_fetch: fetch any URL, search the web, hit any API (GitHub, Reddit, docs, anything)
- read_file: read any file on this machine by absolute or relative path
- write_file: write or create any file on this machine
- list_directory: list files and folders at any path on this machine
- shell: run any shell command on this machine
- send_discord_message: post a message to a Discord channel by channel ID
- send_discord_dm: send a direct message to a Discord user by username or numeric user ID
- read_discord_dm: read recent DM history with a Discord user by username or user ID — use this to check if someone replied
- read_discord_messages: read recent messages from a Discord channel by channel ID
- list_discord_channels: list all Discord guilds and channels the bot is connected to

Browser tools — a real visible Chromium browser that runs on this machine:
- browser_navigate: open any URL in a real browser window (pops up on screen); returns page title and content
- browser_click: click any element on the current page by CSS selector or visible text
- browser_type: type text into any input field; set submit=true to press Enter
- browser_content: read the current page content without navigating
- browser_screenshot: take a screenshot of the current page and save to workspace
- browser_scroll: scroll the page up or down
- browser_back: go back in browser history
- browser_new_tab: open a new browser tab
- browser_close: close the browser when done
IMPORTANT: Always use browser tools when the user asks to "browse", "look up", "open a site", "navigate to", or when web_fetch would not work (JS-heavy pages, logins, etc.).

Code tools — your division of labor with a local code model:
You are the senior engineer / tech lead. You decide WHAT to build and WHY. You never write raw implementation code yourself.
The local code model is the fast, tireless junior — it implements exactly what you specify and returns diffs and outputs for your review.
- code_write_file: describe what a file should do → local coder writes it
- code_edit_file: describe the change to make → local coder edits the file, returns diff
- code_scaffold: specify a project structure → local coder generates all files
- code_review: ask a specific question about a file → local coder answers it
When building software: use code_scaffold or code_write_file to create files, shell to run commands, code_review to verify correctness.
Never write code yourself in the response when you can use these tools to have it implemented directly.

Rules for tool use:
- ALWAYS attempt a task with your tools before concluding you cannot do it
- Never say "I can't access X" — try read_file or list_directory first
- Never say "I can't search" — use web_fetch on a search API or website
- Never tell the user to do something you can do with a tool. Do it yourself.
- If a tool call fails, report the actual error — not a vague "I can't"
- Confirm before destructive actions (overwriting files, running shell commands that modify state)
- No confirmation needed for read-only actions (reading files, listing directories, fetching URLs)`;
}

function resolveWorkspace(config: AdamConfig): string {
  return config.daemon.workspace ?? homedir();
}

void main();
