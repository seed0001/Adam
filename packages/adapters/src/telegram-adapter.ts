import { Bot, type Context } from "grammy";
import {
  generateId,
  generateSessionId,
  createLogger,
  type InboundMessage,
  type OutboundMessage,
} from "@adam/shared";
import { BaseAdapter } from "./base.js";

const logger = createLogger("adapter:telegram");

/**
 * Telegram adapter using grammY.
 * Runs as an isolated module — if it crashes, the daemon continues.
 */
export class TelegramAdapter extends BaseAdapter {
  readonly source = "telegram" as const;
  private bot: Bot | null = null;
  private connected = false;
  private sessions = new Map<string, string>();

  constructor(private token: string) {
    super();
  }

  async start(): Promise<void> {
    this.bot = new Bot(this.token);

    this.bot.on("message:text", (ctx: Context) => {
      if (!ctx.message?.text || !ctx.from) return;

      const chatId = String(ctx.chat?.id ?? ctx.from.id);
      const userId = String(ctx.from.id);

      let sessionId = this.sessions.get(chatId);
      if (!sessionId) {
        sessionId = generateSessionId();
        this.sessions.set(chatId, sessionId);
      }

      const message: InboundMessage = {
        id: generateId(),
        sessionId,
        source: "telegram",
        channelId: chatId,
        userId,
        role: "user",
        content: ctx.message.text,
        attachments: [],
        receivedAt: new Date(),
        metadata: {
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          messageId: ctx.message.message_id,
        },
      };

      this.emit("message", message);
    });

    this.bot.catch((err) => {
      logger.error("Telegram bot error", { error: String(err) });
    });

    await this.bot.start({ onStart: () => {
      this.connected = true;
      logger.info("Telegram adapter connected");
    }});
  }

  async stop(): Promise<void> {
    await this.bot?.stop();
    this.connected = false;
    logger.info("Telegram adapter stopped");
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.bot) throw new Error("Telegram bot not started");

    const chunks = splitMessage(message.content, 4096);
    for (const chunk of chunks) {
      const extra: Parameters<typeof this.bot.api.sendMessage>[2] = { parse_mode: "Markdown" };
      if (message.replyToId) extra.reply_parameters = { message_id: Number(message.replyToId) };
      await this.bot.api.sendMessage(message.channelId, chunk, extra);
    }
  }

  isConnected(): boolean {
    return this.connected;
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
