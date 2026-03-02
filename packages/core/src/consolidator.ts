import { createLogger } from "@adam/shared";
import type { ProfileStore } from "@adam/memory";
import type { EpisodicStore } from "@adam/memory";
import type { ModelRouter } from "@adam/models";

const logger = createLogger("core:consolidator");

/**
 * MemoryConsolidator — the background metabolism of Adam's memory.
 *
 * Inspired by the Neural CA paper's stochastic cell update:
 * no global clock, each process fires at a random interval.
 * Over time this produces a living memory that:
 *   - Reinforces what gets used
 *   - Lets unused facts decay and die
 *   - Extracts durable facts from old episodic entries
 *
 * This is the software equivalent of the CA's "attractor" —
 * things the system keeps returning to stabilize; things it ignores fade.
 */
export class MemoryConsolidator {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private sessionId: string;

  constructor(
    private profile: ProfileStore,
    private episodic: EpisodicStore,
    private router: ModelRouter,
    private options: {
      minIntervalMs?: number;        // default 8 min
      maxIntervalMs?: number;        // default 18 min
      decayHalfLifeDays?: number;    // default 30
      decayMinConfidence?: number;   // default 0.25
      consolidateAfterDays?: number; // default 14
    } = {},
  ) {
    this.sessionId = `consolidator-${Date.now()}`;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info("Memory consolidator started (stochastic tick, no global clock)");
    this.scheduleNextTick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info("Memory consolidator stopped");
  }

  /** Update decay/consolidation parameters at runtime without restarting. */
  updateOptions(patch: Partial<typeof this.options>): void {
    Object.assign(this.options, patch);
    logger.info("Consolidator options updated", patch);
  }

  /** Run a full consolidation cycle immediately (also called on schedule). */
  async runOnce(): Promise<void> {
    await this.tick();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private scheduleNextTick(): void {
    if (!this.running) return;

    const min = this.options.minIntervalMs ?? 8 * 60 * 1000;
    const max = this.options.maxIntervalMs ?? 18 * 60 * 1000;
    // Genuinely stochastic — not a fixed cron, matches the CA's async cell updates
    const delay = min + Math.random() * (max - min);

    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.scheduleNextTick());
    }, delay);
  }

  private async tick(): Promise<void> {
    try {
      logger.info("Consolidation tick starting");

      // 1. Decay: let unreferenced facts lose confidence and eventually die
      const decayStats = this.profile.decay(
        this.options.decayHalfLifeDays ?? 30,
        this.options.decayMinConfidence ?? 0.25,
      );
      if (decayStats.removed > 0 || decayStats.decayed > 0) {
        logger.info("Memory decay applied", {
          checked: decayStats.checked,
          decayed: decayStats.decayed,
          removed: decayStats.removed,
          protected: decayStats.reinforced,
        });
      }

      // 2. Consolidate: extract durable facts from old episodic sessions
      await this.consolidateOldEpisodic();

    } catch (e) {
      logger.error("Consolidation tick failed", { error: String(e) });
    }
  }

  /**
   * Looks at episodic entries older than `consolidateAfterDays`.
   * Groups them by session. For sessions not yet consolidated, runs a
   * fast LLM pass to extract any facts worth persisting in the profile.
   *
   * This is the CA's "seed pool" — we're distilling the past into a
   * stable representation that survives session boundaries.
   */
  private async consolidateOldEpisodic(): Promise<void> {
    const afterDays = this.options.consolidateAfterDays ?? 14;
    const oldEntries = this.episodic
      .getRecentAcrossSessions(200, 365)
      .filter((e) => {
        const age = (Date.now() - e.createdAt.getTime()) / 86_400_000;
        return age > afterDays && (e.role === "user" || e.role === "assistant");
      });

    if (oldEntries.length === 0) return;

    // Group by session — only consolidate each session once
    const bySessions = new Map<string, typeof oldEntries>();
    for (const entry of oldEntries) {
      const bucket = bySessions.get(entry.sessionId) ?? [];
      bucket.push(entry);
      bySessions.set(entry.sessionId, bucket);
    }

    let consolidated = 0;

    for (const [sessionId, entries] of bySessions) {
      // Skip sessions already partially loaded into profile
      // (simple heuristic: if < 4 entries, not worth processing)
      if (entries.length < 4) continue;

      // Build a compact transcript
      const transcript = entries
        .slice(0, 30) // cap to avoid huge prompts
        .map((e) => `${e.role}: ${e.content.slice(0, 300)}`)
        .join("\n");

      try {
        const result = await this.router.generate({
          sessionId: this.sessionId,
          tier: "fast",
          system: `You extract durable facts about the user from old conversation transcripts.
Output ONLY a valid JSON array. Each element: {"key": string, "value": string, "category": "identity"|"preference"|"context"|"goal", "confidence": 0.0–1.0}.
Rules:
- Only extract facts about the user that are still likely true today
- Prefer stable facts (name, job, location, long-term goals, preferences)
- Skip transient facts (what they ate, one-off tasks)
- Return [] if nothing durable is present`,
          prompt: `Old conversation transcript (session ${sessionId.slice(0, 8)}):\n\n${transcript}\n\nExtract durable user facts.`,
        });

        if (result.isErr()) continue;

        const match = result.value.match(/\[[\s\S]*\]/);
        if (!match) continue;

        const raw = JSON.parse(match[0]) as unknown;
        if (!Array.isArray(raw)) continue;

        let extracted = 0;
        for (const item of raw) {
          if (typeof item !== "object" || item === null) continue;
          const r = item as Record<string, unknown>;
          const k = r["key"];
          const v = r["value"];
          const c = r["confidence"];
          const cat = r["category"];
          if (typeof k !== "string" || typeof v !== "string") continue;
          if (typeof c !== "number" || c < 0.65) continue;

          // Only set if we don't already have a more confident version
          const existing = this.profile.getAll().find((f) => f.key === k);
          if (existing && existing.confidence >= (c as number)) continue;

          this.profile.set(k, v, {
            category: typeof cat === "string" ? cat : "general",
            confidence: c as number,
            source: "consolidated",
          });
          extracted++;
        }

        if (extracted > 0) {
          logger.info("Consolidated episodic session into profile", {
            sessionId: sessionId.slice(0, 8),
            extracted,
          });
          consolidated++;
        }
      } catch {
        // best-effort
      }
    }

    if (consolidated > 0) {
      logger.info(`Consolidated ${consolidated} old sessions`);
    }
  }
}
