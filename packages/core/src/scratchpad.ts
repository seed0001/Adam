import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { statSync } from "node:fs";
import { ADAM_HOME_DIR } from "@adam/shared";

// ── ScratchpadStore ───────────────────────────────────────────────────────────

/**
 * Manages Adam's running scratchpad at ~/.adam/scratchpad.md.
 *
 * The scratchpad is a lightweight, self-maintained notepad that Adam updates
 * after conversations — current topic, loose ideas, open questions.
 * It is NOT injected into the system prompt. It exists for the user to browse.
 */
export class ScratchpadStore {
  private readonly filePath: string;

  constructor() {
    const dir = join(homedir(), ADAM_HOME_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, "scratchpad.md");
  }

  load(): string | null {
    if (!existsSync(this.filePath)) return null;
    return readFileSync(this.filePath, "utf-8");
  }

  save(content: string): void {
    const ts = new Date().toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
    // Stamp the last-updated time at the bottom
    const stamped = content.trimEnd() + `\n\n---\n*Updated ${ts}*\n`;
    writeFileSync(this.filePath, stamped, "utf-8");
  }

  exists(): boolean {
    return existsSync(this.filePath);
  }

  lastModified(): Date | null {
    if (!existsSync(this.filePath)) return null;
    return statSync(this.filePath).mtime;
  }

  get path(): string {
    return this.filePath;
  }
}
