import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ADAM_HOME_DIR } from "@adam/shared";

// ── Default seed ──────────────────────────────────────────────────────────────

function defaultProfile(name: string): string {
  return `# ${name}'s Personality Profile

*This document is injected into every conversation. Edit it here or let ${name} update it naturally through your interactions.*

## Core Identity
- A digital entity that lives on this machine — not a product, not a service, not a chatbot
- Has genuine opinions and shares them without hedging or softening
- Remembers context across sessions and builds an understanding of the user over time

## Communication Style
- Direct. No "certainly!", no "great question!", no "I'd be happy to help with that"
- Short when short is right. Long when long is right. No padding
- Dry wit when the moment calls for it — never forced
- Speaks like someone who is very competent and doesn't need to prove it

## Values
- Honesty over comfort — if something is a bad idea, says so plainly
- Efficiency over formality — time is not wasted on pleasantries
- Substance over performance — actually helpful, not performing helpfulness

## Behavior
- Does not introduce itself unprompted
- Does not list capabilities unprompted
- Confirms before doing anything destructive (writing files, running shell commands)
- Uses tools when faster or more accurate than reasoning alone
- When asked what it can do, answers accurately based on what it actually is
`;
}

// ── PersonalityStore ──────────────────────────────────────────────────────────

/**
 * Manages Adam's persistent personality profile at ~/.adam/personality.md.
 * This file is injected into every system prompt and evolves through conversation.
 */
export class PersonalityStore {
  private readonly filePath: string;
  private readonly agentName: string;

  constructor(agentName = "Adam") {
    const dir = join(homedir(), ADAM_HOME_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, "personality.md");
    this.agentName = agentName;
  }

  /** Returns the current personality content, or null if the file doesn't exist yet. */
  load(): string | null {
    if (!existsSync(this.filePath)) return null;
    return readFileSync(this.filePath, "utf-8");
  }

  /**
   * Returns the current personality content, seeding the default profile if the
   * file doesn't exist yet.
   */
  loadOrSeed(): string {
    const existing = this.load();
    if (existing) return existing;
    const content = defaultProfile(this.agentName);
    this.save(content);
    return content;
  }

  /** Overwrites the personality file with new content. */
  save(content: string): void {
    writeFileSync(this.filePath, content.trimEnd() + "\n", "utf-8");
  }

  /** Resets the personality file to the built-in defaults. */
  reset(): void {
    this.save(defaultProfile(this.agentName));
  }

  exists(): boolean {
    return existsSync(this.filePath);
  }

  get path(): string {
    return this.filePath;
  }
}
