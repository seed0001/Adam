import * as readline from "node:readline";
import { generateId, generateSessionId, createLogger, type InboundMessage, type OutboundMessage } from "@adam/shared";
import { BaseAdapter } from "./base.js";

const logger = createLogger("adapter:cli");

/**
 * CLI adapter — direct shell interaction for development and testing.
 * The simplest possible adapter: stdin → agent → stdout.
 */
export class CliAdapter extends BaseAdapter {
  readonly source = "cli" as const;
  private rl: readline.Interface | null = null;
  private connected = false;
  private sessionId = generateSessionId();

  async start(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "you > ",
    });

    this.rl.prompt();

    this.rl.on("line", (line) => {
      const content = line.trim();
      if (!content) {
        this.rl?.prompt();
        return;
      }

      const message: InboundMessage = {
        id: generateId(),
        sessionId: this.sessionId,
        source: "cli",
        channelId: "cli",
        userId: "local-user",
        role: "user",
        content,
        attachments: [],
        receivedAt: new Date(),
        metadata: {},
      };

      this.emit("message", message);
    });

    this.rl.on("close", () => {
      this.connected = false;
      logger.info("CLI adapter closed");
      process.exit(0);
    });

    this.connected = true;
    logger.info("CLI adapter started");
  }

  async stop(): Promise<void> {
    this.rl?.close();
    this.connected = false;
  }

  async send(message: OutboundMessage): Promise<void> {
    process.stdout.write(`\nadam > ${message.content}\n\nyou > `);
  }

  isConnected(): boolean {
    return this.connected;
  }
}
