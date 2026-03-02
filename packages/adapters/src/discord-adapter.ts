import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type Message,
  type TextChannel,
  type DMChannel,
  type NewsChannel,
  type ThreadChannel,
  type ChatInputCommandInteraction,
  Partials,
} from "discord.js";
import {
  generateId,
  generateSessionId,
  createLogger,
  type InboundMessage,
  type OutboundMessage,
  type DiscordAdapterConfig,
} from "@adam/shared";
import { BaseAdapter } from "./base.js";

const logger = createLogger("adapter:discord");

// ── Rate limiter (sliding window per user) ────────────────────────────────────

class RateLimiter {
  private windows = new Map<string, number[]>();

  isAllowed(userId: string, limitPerMinute: number): boolean {
    if (limitPerMinute === 0) return true;
    const now = Date.now();
    const cutoff = now - 60_000;
    const hits = (this.windows.get(userId) ?? []).filter((t) => t > cutoff);
    if (hits.length >= limitPerMinute) return false;
    hits.push(now);
    this.windows.set(userId, hits);
    return true;
  }

  clear(userId: string): void {
    this.windows.delete(userId);
  }
}

// ── Sendable channel type ─────────────────────────────────────────────────────

type SendableChannel = TextChannel | DMChannel | NewsChannel | ThreadChannel;

function isSendable(ch: unknown): ch is SendableChannel {
  return (
    typeof ch === "object" &&
    ch !== null &&
    typeof (ch as Record<string, unknown>)["send"] === "function"
  );
}

// ── Discord adapter ───────────────────────────────────────────────────────────

/**
 * Full-featured Discord adapter.
 *
 * Controls:
 *  - Channel whitelist (empty = all)
 *  - User blacklist
 *  - Admin user list (can run !adam-config commands)
 *  - Mention-only mode (default on for servers)
 *  - Per-user rate limiting
 *  - Auto-thread responses
 *  - Slash commands: /adam, /adam-memory, /adam-forget
 *  - Typing indicator while processing
 *  - Hot-reload via updateConfig()
 */
export class DiscordAdapter extends BaseAdapter {
  readonly source = "discord" as const;
  private client: Client | null = null;
  private connected = false;
  private sessions = new Map<string, string>();
  private limiter = new RateLimiter();

  constructor(
    private token: string,
    private config: DiscordAdapterConfig,
  ) {
    super();
  }

  /** Live-update config without restarting the adapter. */
  updateConfig(newConfig: DiscordAdapterConfig): void {
    this.config = newConfig;
    logger.info("Discord adapter config updated");
  }

  async start(): Promise<void> {
    this.client = new Client({
      intents: [
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.Guilds,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this.client.once("ready", async () => {
      this.connected = true;
      logger.info("Discord adapter connected", { tag: this.client?.user?.tag });

      if (this.config.clientId) {
        await this.registerSlashCommands().catch((e: unknown) =>
          logger.warn("Slash command registration failed", { error: String(e) }),
        );
      }
    });

    this.client.on("messageCreate", (msg: Message) => void this.handleMessage(msg));
    this.client.on("interactionCreate", (i) => {
      if (i.isChatInputCommand()) void this.handleSlashCommand(i);
    });
    this.client.on("error", (err) => logger.error("Discord client error", { error: String(err) }));

    await this.client.login(this.token);
  }

  async stop(): Promise<void> {
    await this.client?.destroy();
    this.connected = false;
    logger.info("Discord adapter stopped");
  }

  /** Send a message to any channel by ID. Used by tools and adapter.send(). */
  async sendToChannel(channelId: string, content: string): Promise<void> {
    if (!this.client) throw new Error("Discord client not started");
    const channel = await this.client.channels.fetch(channelId);
    if (!isSendable(channel)) throw new Error(`Channel ${channelId} is not a sendable text channel`);
    const chunks = splitMessage(content, this.config.maxMessageLength);
    for (const chunk of chunks) await channel.send(chunk);
  }

  /**
   * Returns every guild the bot is in with its sendable text channels.
   * Used by the list_discord_channels tool so Adam can look up channel IDs.
   */
  listChannels(): Array<{
    guildId: string;
    guildName: string;
    channels: Array<{ id: string; name: string }>;
  }> {
    if (!this.client || !this.connected) return [];
    return this.client.guilds.cache.map((guild) => ({
      guildId: guild.id,
      guildName: guild.name,
      channels: guild.channels.cache
        .filter((ch) => isSendable(ch))
        .map((ch) => ({ id: ch.id, name: (ch as TextChannel).name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }

  async send(message: OutboundMessage): Promise<void> {
    // If there's a pending slash command interaction, edit the deferred reply
    const interaction = this.pendingInteractions.get(message.channelId);
    if (interaction?.deferred) {
      this.pendingInteractions.delete(message.channelId);
      const chunks = splitMessage(message.content, this.config.maxMessageLength);
      await interaction.editReply(chunks[0] ?? "…");
      for (const chunk of chunks.slice(1)) await interaction.followUp(chunk);
      return;
    }
    await this.sendToChannel(message.channelId, message.content);
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async handleMessage(msg: Message): Promise<void> {
    if (msg.author.bot) return;

    // ── Channel whitelist ────────────────────────────────────────────────────
    const whitelist = this.config.channelWhitelist;
    if (whitelist.length > 0 && !whitelist.includes(msg.channelId)) return;

    // ── User blacklist ───────────────────────────────────────────────────────
    if (this.config.userBlacklist.includes(msg.author.id)) return;

    // ── Mention-only mode (servers only) ────────────────────────────────────
    const isDM = !msg.guild;
    if (!isDM && this.config.mentionOnly && !msg.mentions.users.has(this.client?.user?.id ?? "")) {
      // Admin commands always pass through
      if (!msg.content.startsWith("!adam")) return;
    }

    // ── Admin commands ───────────────────────────────────────────────────────
    if (msg.content.startsWith("!adam ")) {
      if (this.config.adminUsers.includes(msg.author.id)) {
        await this.handleAdminCommand(msg);
      } else {
        await msg.reply("You're not in the admin users list.");
      }
      return;
    }

    // ── Rate limiting ────────────────────────────────────────────────────────
    if (!this.limiter.isAllowed(msg.author.id, this.config.rateLimitPerUserPerMinute)) {
      await msg.reply("Slow down.").catch(() => {});
      return;
    }

    // ── Strip mention and clean content ──────────────────────────────────────
    const content = msg.content.replace(/<@!?\d+>/g, "").trim();
    if (!content) return;

    // ── Session management (per-channel) ─────────────────────────────────────
    const channelId = msg.channelId;
    let sessionId = this.sessions.get(channelId);
    if (!sessionId) {
      sessionId = generateSessionId();
      this.sessions.set(channelId, sessionId);
    }

    // ── Typing indicator ──────────────────────────────────────────────────────
    if (isSendable(msg.channel)) {
      void msg.channel.sendTyping().catch(() => {});
    }

    const inbound: InboundMessage = {
      id: generateId(),
      sessionId,
      source: "discord",
      channelId,
      userId: msg.author.id,
      role: "user",
      content,
      attachments: [],
      receivedAt: new Date(),
      metadata: {
        username: msg.author.username,
        guildId: msg.guildId ?? undefined,
        messageId: msg.id,
        systemPromptOverride: this.config.systemPromptOverride,
      },
    };

    this.emit("message", inbound);
  }

  private async handleAdminCommand(msg: Message): Promise<void> {
    const parts = msg.content.slice("!adam ".length).trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    switch (cmd) {
      case "status": {
        const whitelist = this.config.channelWhitelist;
        const status = [
          `**Adam status**`,
          `Mention-only: ${this.config.mentionOnly ? "on" : "off"}`,
          `Channel whitelist: ${whitelist.length > 0 ? whitelist.join(", ") : "all channels"}`,
          `Rate limit: ${this.config.rateLimitPerUserPerMinute > 0 ? `${this.config.rateLimitPerUserPerMinute}/min` : "off"}`,
          `Admin users: ${this.config.adminUsers.length}`,
        ].join("\n");
        await msg.reply(status);
        break;
      }
      case "whitelist": {
        const sub = parts[1];
        const channelArg = parts[2] ?? msg.channelId;
        if (sub === "add") {
          if (!this.config.channelWhitelist.includes(channelArg)) {
            this.config.channelWhitelist.push(channelArg);
            await msg.reply(`Channel \`${channelArg}\` added to whitelist.`);
          } else {
            await msg.reply("Already whitelisted.");
          }
        } else if (sub === "remove") {
          this.config.channelWhitelist = this.config.channelWhitelist.filter(
            (c) => c !== channelArg,
          );
          await msg.reply(`Removed \`${channelArg}\` from whitelist.`);
        } else if (sub === "clear") {
          this.config.channelWhitelist = [];
          await msg.reply("Whitelist cleared — Adam will respond in all channels.");
        } else {
          await msg.reply(
            "Usage: `!adam whitelist add [#channel-id]` | `remove [#channel-id]` | `clear`",
          );
        }
        break;
      }
      case "block": {
        const targetId = parts[1]?.replace(/\D/g, "");
        if (!targetId) { await msg.reply("Usage: `!adam block <@user>`"); break; }
        if (!this.config.userBlacklist.includes(targetId)) {
          this.config.userBlacklist.push(targetId);
          this.limiter.clear(targetId);
          await msg.reply(`User \`${targetId}\` blocked.`);
        } else {
          await msg.reply("Already blocked.");
        }
        break;
      }
      case "unblock": {
        const targetId = parts[1]?.replace(/\D/g, "");
        if (!targetId) { await msg.reply("Usage: `!adam unblock <@user>`"); break; }
        this.config.userBlacklist = this.config.userBlacklist.filter((u) => u !== targetId);
        await msg.reply(`User \`${targetId}\` unblocked.`);
        break;
      }
      case "mention": {
        const val = parts[1];
        if (val === "on") { this.config.mentionOnly = true; await msg.reply("Mention-only mode on."); }
        else if (val === "off") { this.config.mentionOnly = false; await msg.reply("Mention-only mode off — I'll respond to all messages."); }
        else await msg.reply("Usage: `!adam mention on|off`");
        break;
      }
      case "ratelimit": {
        const n = parseInt(parts[1] ?? "", 10);
        if (isNaN(n) || n < 0) { await msg.reply("Usage: `!adam ratelimit <number>` (0 = off)"); break; }
        this.config.rateLimitPerUserPerMinute = n;
        await msg.reply(n === 0 ? "Rate limit disabled." : `Rate limit set to ${n} messages/minute per user.`);
        break;
      }
      case "help":
      default:
        await msg.reply([
          "**Admin commands** (only admin users can run these):",
          "`!adam status` — show current config",
          "`!adam whitelist add [channel-id]` — add a channel",
          "`!adam whitelist remove [channel-id]` — remove a channel",
          "`!adam whitelist clear` — respond in all channels",
          "`!adam block @user` — block a user",
          "`!adam unblock @user` — unblock a user",
          "`!adam mention on|off` — toggle mention-only mode",
          "`!adam ratelimit <n>` — set rate limit (0 = off)",
        ].join("\n"));
    }
  }

  private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const name = interaction.commandName;

    if (name === "adam") {
      const message = interaction.options.getString("message", true);

      // Rate limit slash commands too
      if (!this.limiter.isAllowed(interaction.user.id, this.config.rateLimitPerUserPerMinute)) {
        await interaction.reply({ content: "Slow down.", ephemeral: true });
        return;
      }

      await interaction.deferReply();

      const channelId = interaction.channelId;
      let sessionId = this.sessions.get(channelId);
      if (!sessionId) {
        sessionId = generateSessionId();
        this.sessions.set(channelId, sessionId);
      }

      const inbound: InboundMessage = {
        id: generateId(),
        sessionId,
        source: "discord",
        channelId,
        userId: interaction.user.id,
        role: "user",
        content: message,
        attachments: [],
        receivedAt: new Date(),
        metadata: { username: interaction.user.username, slashCommand: true },
      };

      // We emit the message and the response gets sent via adapter.send()
      // but for slash commands we need to edit the deferred reply
      // Store the interaction so send() can use it
      this.pendingInteractions.set(channelId, interaction);
      this.emit("message", inbound);

      // Timeout cleanup
      setTimeout(() => this.pendingInteractions.delete(channelId), 30_000);
    }
  }

  private pendingInteractions = new Map<string, ChatInputCommandInteraction>();

  private async registerSlashCommands(): Promise<void> {
    if (!this.client?.user || !this.config.clientId) return;

    const commands = [
      new SlashCommandBuilder()
        .setName("adam")
        .setDescription("Talk to Adam")
        .addStringOption((o) =>
          o.setName("message").setDescription("Your message").setRequired(true),
        ),
    ].map((c) => c.toJSON());

    const rest = new REST({ version: "10" }).setToken(this.token);
    await rest.put(Routes.applicationCommands(this.config.clientId), { body: commands });
    logger.info("Slash commands registered");
  }
}

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLength) {
    chunks.push(text.slice(i, i + maxLength));
  }
  return chunks;
}
