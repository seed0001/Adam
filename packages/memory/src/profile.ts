import { eq, and, isNull, desc } from "drizzle-orm";
import { type AdamError, type Result, ok, trySync, generateId } from "@adam/shared";
import { profileMemory, type ProfileMemoryInsert } from "./schema.js";
import { encrypt, decrypt } from "./encryption.js";
import type { Buffer } from "node:buffer";
import type { AdamDB } from "./db.js";

type DB = AdamDB;

export type ProfileEntry = {
  id: string;
  key: string;
  value: string;
  category: string;
  confidence: number;
  source: string;
  version: number;
  protected: boolean;
  lastReferencedAt: Date | null;
  updatedAt: Date;
};

export type DecayStats = {
  checked: number;
  reinforced: number;
  decayed: number;
  removed: number;
};

/**
 * Typed user preferences and long-term facts.
 *
 * Implements a CA-inspired lifecycle:
 *  - Facts used in prompts are reinforced (confidence → 1.0)
 *  - Facts not referenced decay exponentially over time
 *  - Facts that decay below the threshold are pruned
 *  - User-entered and protected facts are immune to decay
 */
export class ProfileStore {
  constructor(
    private db: DB,
    private encryptionKey: Buffer | null = null,
  ) {}

  set(
    key: string,
    value: string,
    opts: { category?: string; confidence?: number; source?: string; protected?: boolean } = {},
  ): Result<string, AdamError> {
    return trySync(() => {
      const existing = this.db
        .select()
        .from(profileMemory)
        .where(and(eq(profileMemory.key, key), isNull(profileMemory.deletedAt)))
        .limit(1)
        .all();

      const version = existing[0] ? existing[0].version + 1 : 1;

      if (existing[0]) {
        this.db
          .update(profileMemory)
          .set({ deletedAt: new Date().toISOString() })
          .where(eq(profileMemory.id, existing[0].id))
          .run();
      }

      const source = opts.source ?? "user";
      // User-entered facts are always protected
      const isProtected = opts.protected ?? source === "user";

      const id = generateId();
      const now = new Date().toISOString();
      const insertRow: ProfileMemoryInsert = {
        id,
        key,
        value: this.encryptionKey ? "" : value,
        category: opts.category ?? "general",
        confidence: opts.confidence ?? 1.0,
        source,
        version,
        protected: isProtected,
        updatedAt: now,
      };

      if (this.encryptionKey) {
        const encResult = encrypt(value, this.encryptionKey);
        if (encResult.isErr()) throw new Error(encResult.error.message);
        insertRow.valueEncrypted = encResult.value;
      }

      this.db.insert(profileMemory).values(insertRow).run();
      return id;
    }, "profile:set-failed");
  }

  get(key: string): string | null {
    const row = this.db
      .select()
      .from(profileMemory)
      .where(and(eq(profileMemory.key, key), isNull(profileMemory.deletedAt)))
      .limit(1)
      .all()[0];

    if (!row) return null;

    if (this.encryptionKey && row.valueEncrypted) {
      const result = decrypt(row.valueEncrypted as unknown as Buffer, this.encryptionKey);
      return result.isOk() ? result.value : null;
    }

    return row.value;
  }

  getAll(category?: string): ProfileEntry[] {
    const query = this.db
      .select()
      .from(profileMemory)
      .where(
        category
          ? and(isNull(profileMemory.deletedAt), eq(profileMemory.category, category))
          : isNull(profileMemory.deletedAt),
      )
      .orderBy(desc(profileMemory.updatedAt));

    return query.all().map((row) => {
      let value = row.value;
      if (this.encryptionKey && row.valueEncrypted) {
        const result = decrypt(row.valueEncrypted as unknown as Buffer, this.encryptionKey);
        if (result.isOk()) value = result.value;
      }
      return {
        id: row.id,
        key: row.key,
        value,
        category: row.category,
        confidence: row.confidence,
        source: row.source,
        version: row.version,
        protected: row.protected ?? false,
        lastReferencedAt: row.lastReferencedAt ? new Date(row.lastReferencedAt) : null,
        updatedAt: new Date(row.updatedAt),
      };
    });
  }

  delete(key: string): Result<void, AdamError> {
    return trySync(() => {
      this.db
        .update(profileMemory)
        .set({ deletedAt: new Date().toISOString() })
        .where(and(eq(profileMemory.key, key), isNull(profileMemory.deletedAt)))
        .run();
    }, "profile:delete-failed");
  }

  /**
   * Mark a fact as referenced — boosts confidence toward 1.0 and records
   * the timestamp. Called whenever a fact is injected into a prompt.
   */
  reinforce(key: string, amount = 0.08): void {
    const row = this.db
      .select()
      .from(profileMemory)
      .where(and(eq(profileMemory.key, key), isNull(profileMemory.deletedAt)))
      .limit(1)
      .all()[0];

    if (!row) return;

    const newConfidence = Math.min(1.0, row.confidence + amount);
    const now = new Date().toISOString();

    this.db
      .update(profileMemory)
      .set({ confidence: newConfidence, lastReferencedAt: now, updatedAt: now })
      .where(eq(profileMemory.id, row.id))
      .run();
  }

  /**
   * Apply exponential decay to all non-protected, auto-extracted facts.
   * Facts below the minimum confidence threshold are pruned entirely.
   *
   * This is the CA analogy: facts that aren't reinforced by active use
   * lose their alpha channel and eventually die.
   *
   * @param halfLifeDays  Confidence halves after this many days without reference. Default: 30.
   * @param minConfidence Facts below this value are deleted. Default: 0.25.
   */
  decay(halfLifeDays = 30, minConfidence = 0.25): DecayStats {
    const stats: DecayStats = { checked: 0, reinforced: 0, decayed: 0, removed: 0 };
    const facts = this.getAll();
    const now = Date.now();
    const lambda = Math.LN2 / halfLifeDays;

    for (const fact of facts) {
      stats.checked++;

      // Protected and user-entered facts are immortal
      if (fact.protected || fact.source === "user") {
        stats.reinforced++;
        continue;
      }

      const lastRef = fact.lastReferencedAt ?? fact.updatedAt;
      const daysSince = (now - lastRef.getTime()) / 86_400_000;

      // No decay within the first day
      if (daysSince < 1) continue;

      const newConfidence = fact.confidence * Math.exp(-lambda * daysSince);

      if (newConfidence < minConfidence) {
        this.delete(fact.key);
        stats.removed++;
      } else {
        this.db
          .update(profileMemory)
          .set({ confidence: newConfidence, updatedAt: new Date().toISOString() })
          .where(and(eq(profileMemory.key, fact.key), isNull(profileMemory.deletedAt)))
          .run();
        stats.decayed++;
      }
    }

    return stats;
  }

  /**
   * Toggle the protected flag on a fact.
   * Protected facts never decay, regardless of when they were last referenced.
   */
  protect(key: string, value = true): void {
    this.db
      .update(profileMemory)
      .set({ protected: value, updatedAt: new Date().toISOString() })
      .where(and(eq(profileMemory.key, key), isNull(profileMemory.deletedAt)))
      .run();
  }

  ok(): Result<true, AdamError> {
    return ok(true);
  }
}
