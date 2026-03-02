import { MEMORY } from "@adam/shared";
import type { EpisodicEntry } from "./episodic.js";

export type WorkingMemoryMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  importance: number;
  tokenEstimate: number;
};

/**
 * In-process context window manager.
 * Maintains the active message buffer for the current agent loop iteration.
 * Uses importance scoring and sliding window to stay within token limits.
 */
export class WorkingMemory {
  private messages: WorkingMemoryMessage[] = [];
  private systemPrompt: string = "";

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  push(message: WorkingMemoryMessage): void {
    this.messages.push(message);
    this.trim();
  }

  pushFromEpisodic(entries: EpisodicEntry[]): void {
    for (const entry of entries) {
      this.messages.push({
        role: entry.role,
        content: entry.content,
        importance: entry.importance,
        tokenEstimate: estimateTokens(entry.content),
      });
    }
    this.trim();
  }

  getMessages(): WorkingMemoryMessage[] {
    return [...this.messages];
  }

  totalTokens(): number {
    return (
      estimateTokens(this.systemPrompt) +
      this.messages.reduce((sum, m) => sum + m.tokenEstimate, 0)
    );
  }

  clear(): void {
    this.messages = [];
  }

  /**
   * Trims context to fit within the token limit.
   * Drops lowest-importance messages first, always preserving
   * the most recent message and the system prompt.
   */
  private trim(): void {
    while (this.totalTokens() > MEMORY.CONTEXT_WINDOW_MAX_TOKENS && this.messages.length > 1) {
      let minImportance = Infinity;
      let minIndex = -1;

      for (let i = 0; i < this.messages.length - 1; i++) {
        const msg = this.messages[i];
        if (msg && msg.importance < minImportance) {
          minImportance = msg.importance;
          minIndex = i;
        }
      }

      if (minIndex >= 0) {
        this.messages.splice(minIndex, 1);
      } else {
        break;
      }
    }
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
