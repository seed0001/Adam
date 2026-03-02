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
  updatedAt: Date;
};

/**
 * Typed user preferences and long-term facts.
 * Versioned — every update creates a new row, previous is soft-deleted.
 * Replaces OpenClaw's MEMORY.md and SOUL.md flat files.
 */
export class ProfileStore {
  constructor(
    private db: DB,
    private encryptionKey: Buffer | null = null,
  ) {}

  set(
    key: string,
    value: string,
    opts: { category?: string; confidence?: number; source?: string } = {},
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

      const id = generateId();
      const now = new Date().toISOString();
      const insertRow: ProfileMemoryInsert = {
        id,
        key,
        value: this.encryptionKey ? "" : value,
        category: opts.category ?? "general",
        confidence: opts.confidence ?? 1.0,
        source: opts.source ?? "user",
        version,
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
}
