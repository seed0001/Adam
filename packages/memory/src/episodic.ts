import { desc, eq, and, gte, isNull } from "drizzle-orm";
import {
  type AdamError,
  type Result,
  ok,
  trySync,
  generateId,
  MEMORY,
} from "@adam/shared";
import { episodicMemory, type EpisodicMemoryRow, type EpisodicMemoryInsert } from "./schema.js";
import { encrypt, decrypt } from "./encryption.js";
import type { AdamDB } from "./db.js";

type DB = AdamDB;

export type EpisodicEntry = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  source: string;
  taskId: string | undefined;
  importance: number;
  createdAt: Date;
};

export class EpisodicStore {
  constructor(
    private db: DB,
    private encryptionKey: Buffer | null = null,
  ) {}

  insert(entry: Omit<EpisodicEntry, "id" | "createdAt">): Result<string, AdamError> {
    return trySync(() => {
      const id = generateId();
      const insertRow: EpisodicMemoryInsert = {
        id,
        sessionId: entry.sessionId,
        role: entry.role,
        content: this.encryptionKey ? "" : entry.content,
        source: entry.source,
        taskId: entry.taskId,
        importance: entry.importance,
      };

      if (this.encryptionKey) {
        const encResult = encrypt(entry.content, this.encryptionKey);
        if (encResult.isErr()) throw new Error(encResult.error.message);
        insertRow.contentEncrypted = encResult.value;
      }

      this.db.insert(episodicMemory).values(insertRow).run();
      return id;
    }, "episodic:insert-failed");
  }

  getBySession(sessionId: string, limit = 100): EpisodicEntry[] {
    const rows = this.db
      .select()
      .from(episodicMemory)
      .where(and(eq(episodicMemory.sessionId, sessionId), isNull(episodicMemory.deletedAt)))
      .orderBy(desc(episodicMemory.createdAt))
      .limit(limit)
      .all();

    return rows.map((r) => this.decryptRow(r));
  }

  getRecent(limit = MEMORY.CONTEXT_WINDOW_MAX_TOKENS / 1000): EpisodicEntry[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - MEMORY.EPISODIC_RETENTION_DAYS);

    const rows = this.db
      .select()
      .from(episodicMemory)
      .where(
        and(isNull(episodicMemory.deletedAt), gte(episodicMemory.createdAt, cutoff.toISOString())),
      )
      .orderBy(desc(episodicMemory.createdAt))
      .limit(limit)
      .all();

    return rows.map((r) => this.decryptRow(r));
  }

  /**
   * Returns the most recent N turns across ALL sessions, optionally bounded to
   * the last `withinDays` days.  Used to seed cross-session context at startup.
   */
  getRecentAcrossSessions(limit = 20, withinDays = 30): EpisodicEntry[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - withinDays);

    const rows = this.db
      .select()
      .from(episodicMemory)
      .where(
        and(
          isNull(episodicMemory.deletedAt),
          gte(episodicMemory.createdAt, cutoff.toISOString()),
        ),
      )
      .orderBy(desc(episodicMemory.createdAt))
      .limit(limit)
      .all();

    return rows.map((r) => this.decryptRow(r));
  }

  softDelete(id: string): Result<void, AdamError> {
    return trySync(() => {
      this.db
        .update(episodicMemory)
        .set({ deletedAt: new Date().toISOString() })
        .where(eq(episodicMemory.id, id))
        .run();
    }, "episodic:delete-failed");
  }

  deleteAll(): Result<void, AdamError> {
    return trySync(() => {
      this.db
        .update(episodicMemory)
        .set({ deletedAt: new Date().toISOString() })
        .where(isNull(episodicMemory.deletedAt))
        .run();
    }, "episodic:delete-all-failed");
  }

  private decryptRow(row: EpisodicMemoryRow): EpisodicEntry {
    let content = row.content;

    if (this.encryptionKey && row.contentEncrypted) {
      const result = decrypt(row.contentEncrypted as unknown as Buffer, this.encryptionKey);
      if (result.isOk()) content = result.value;
    }

    return {
      id: row.id,
      sessionId: row.sessionId,
      role: row.role as EpisodicEntry["role"],
      content,
      source: row.source,
      taskId: row.taskId ?? undefined,
      importance: row.importance,
      createdAt: new Date(row.createdAt),
    };
  }
}
