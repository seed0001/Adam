import {
  Client,
  GatewayIntentBits,
  type Message,
  Partials,
} from "discord.js";
import {
  generateId,
  generateSessionId,
  createLogger,
  type InboundMessage,
  type OutboundMessage,
} from "@adam/shared";
import { BaseAdapter } from "./base.js";

const logger = createLogger("adapter:discord");

/**
 * Discord adapter using discord.js.
 * Responds to direct messages and @mentions in servers.
 */
export class DiscordAdapter extends BaseAdapter {
  readonly source = "discord" as const;
  private client: Client | null = null;
  private connected = false;
  private sessions = new Map<string, string>();

  constructor(private token: string) {
    super();
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

    this.client.once("ready", () => {
      this.connected = true;
      logger.info("Discord adapter connected", { tag: this.client?.user?.tag });
    });

    this.client.on("messageCreate", (msg: Message) => {
      if (msg.author.bot) return;
      if (!this.isMentionedOrDM(msg)) return;

      const channelId = msg.channelId;
      let sessionId = this.sessions.get(channelId);
      if (!sessionId) {
        sessionId = generateSessionId();
        this.sessions.set(channelId, sessionId);
      }

      const content = msg.content
        .replace(/<@!?\d+>/g, "")
        .trim();

      if (!content) return;

      const message: InboundMessage = {
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
          guildId: msg.guildId,
          messageId: msg.id,
        },
      };

      this.emit("message", message);
    });

    this.client.on("error", (err) => {
      logger.error("Discord client error", { error: String(err) });
    });

    await this.client.login(this.token);
  }

  async stop(): Promise<void> {
    await this.client?.destroy();
    this.connected = false;
    logger.info("Discord adapter stopped");
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.client) throw new Error("Discord client not started");

    const channel = await this.client.channels.fetch(message.channelId);
    if (!channel?.isTextBased() || !("send" in channel)) {
      throw new Error(`Channel ${message.channelId} is not a sendable text channel`);
    }

    const sendable = channel as { send: (content: string) => Promise<unknown> };
    const chunks = splitMessage(message.content, 2000);
    for (const chunk of chunks) {
      await sendable.send(chunk);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  private isMentionedOrDM(msg: Message): boolean {
    if (!msg.guild) return true;
    return msg.mentions.users.has(this.client?.user?.id ?? "");
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
