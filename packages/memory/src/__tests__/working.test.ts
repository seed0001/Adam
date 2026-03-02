import { describe, it, expect, beforeEach } from "vitest";
import { WorkingMemory, type WorkingMemoryMessage } from "../working.js";

// estimateTokens = Math.ceil(text.length / 4)
// CONTEXT_WINDOW_MAX_TOKENS = 100_000

function msg(
  content: string,
  importance: number,
  role: WorkingMemoryMessage["role"] = "user",
): WorkingMemoryMessage {
  return {
    role,
    content,
    importance,
    tokenEstimate: Math.ceil(content.length / 4),
  };
}

/** Build a message whose token estimate is exactly `tokens`. */
function bigMsg(tokens: number, importance: number): WorkingMemoryMessage {
  const content = "x".repeat(tokens * 4);
  return { role: "user", content, importance, tokenEstimate: tokens };
}

describe("WorkingMemory", () => {
  let wm: WorkingMemory;

  beforeEach(() => {
    wm = new WorkingMemory();
  });

  // ── System prompt ───────────────────────────────────────────────────────────

  it("starts with an empty system prompt", () => {
    expect(wm.getSystemPrompt()).toBe("");
  });

  it("stores and retrieves the system prompt", () => {
    wm.setSystemPrompt("You are Adam.");
    expect(wm.getSystemPrompt()).toBe("You are Adam.");
  });

  it("clear() resets messages but keeps system prompt", () => {
    wm.setSystemPrompt("Keep me.");
    wm.push(msg("hello", 1));
    wm.clear();
    expect(wm.getMessages()).toHaveLength(0);
    expect(wm.getSystemPrompt()).toBe("Keep me.");
  });

  // ── push / getMessages ──────────────────────────────────────────────────────

  it("push adds a message", () => {
    wm.push(msg("hi", 1));
    expect(wm.getMessages()).toHaveLength(1);
  });

  it("getMessages returns a shallow copy — mutations don't affect internal state", () => {
    wm.push(msg("hi", 1));
    const copy = wm.getMessages();
    copy.push(msg("sneaky", 99));
    expect(wm.getMessages()).toHaveLength(1);
  });

  // ── totalTokens ─────────────────────────────────────────────────────────────

  it("totalTokens includes the system prompt", () => {
    wm.setSystemPrompt("abcd"); // 4 chars → 1 token
    wm.push({ role: "user", content: "abcd", importance: 1, tokenEstimate: 1 });
    expect(wm.totalTokens()).toBe(2);
  });

  // ── trim / eviction ─────────────────────────────────────────────────────────

  it("does not evict anything when under the limit", () => {
    wm.push(msg("hello", 1));
    wm.push(msg("world", 2));
    expect(wm.getMessages()).toHaveLength(2);
  });

  it("evicts the lowest-importance message when over the limit", () => {
    // Three messages; total = 120_000 tokens, exceeds the 100_000 limit.
    // Trim must evict the lowest-importance non-last message.
    const first = bigMsg(40_000, 5);  // importance 5
    const low   = bigMsg(40_000, 1);  // lowest importance — should be evicted
    const last  = bigMsg(40_000, 99); // highest importance AND last — always preserved

    wm.push(first);
    wm.push(low);
    wm.push(last); // triggers trim

    const msgs = wm.getMessages();
    // low must be gone; last must survive
    expect(msgs.some((m) => m.importance === 1)).toBe(false);
    expect(msgs[msgs.length - 1]).toEqual(last);
  });

  it("always preserves the most recent message regardless of importance", () => {
    // Two big messages that together approach the limit
    wm.push(bigMsg(50_000, 999)); // high importance
    const last = bigMsg(50_001, 0); // lowest importance but is last
    wm.push(last);

    // The last message must survive even though its importance is 0
    const msgs = wm.getMessages();
    expect(msgs[msgs.length - 1]).toEqual(last);
  });

  it("stops trimming when only one message remains", () => {
    const huge = bigMsg(200_000, 1);
    wm.push(huge);
    // Trim cannot evict the only message; it must stay
    expect(wm.getMessages()).toHaveLength(1);
  });

  // ── pushFromEpisodic ────────────────────────────────────────────────────────

  it("pushFromEpisodic with an empty array is a no-op", () => {
    wm.pushFromEpisodic([]);
    expect(wm.getMessages()).toHaveLength(0);
  });

  it("converts episodic entries to messages with estimated token counts", () => {
    const content = "hello"; // 5 chars → ceil(5/4) = 2 tokens
    wm.pushFromEpisodic([
      {
        id: "1",
        sessionId: "s",
        role: "user",
        content,
        source: "cli",
        taskId: undefined,
        importance: 5,
        createdAt: new Date(),
      },
    ]);
    const messages = wm.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe(content);
    expect(messages[0]!.importance).toBe(5);
    expect(messages[0]!.tokenEstimate).toBe(2);
  });
});
