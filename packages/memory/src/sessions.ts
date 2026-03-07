import { eq, sql } from "drizzle-orm";
import {
    type AdamError,
    type Result,
    ok,
    trySync,
} from "@adam/shared";
import { sessions, type SessionRow, type SessionInsert } from "./schema.js";
import type { AdamDB } from "./db.js";

export class SessionStore {
    constructor(private db: AdamDB) { }

    /**
     * Upsert a session record.
     * Ensures that the session exists and has the correct user/channel mapping.
     */
    ensureSession(
        id: string,
        source: string,
        userId?: string | null,
        channelId?: string | null,
        metadata: Record<string, unknown> = {},
    ): Result<void, AdamError> {
        return trySync(() => {
            // Drizzle doesn't have a clean UPSERT for SQLite in Better-SQLite3 yet
            // so we use a raw SQL approach or manual check
            const existing = this.db
                .select()
                .from(sessions)
                .where(eq(sessions.id, id))
                .get();

            if (existing) {
                this.db
                    .update(sessions)
                    .set({
                        lastActivityAt: sql`datetime('now')`,
                        userId: userId ?? existing.userId,
                        channelId: channelId ?? existing.channelId,
                        metadata: JSON.stringify({
                            ...JSON.parse(existing.metadata || "{}"),
                            ...metadata,
                        }),
                    })
                    .where(eq(sessions.id, id))
                    .run();
            } else {
                const insert: SessionInsert = {
                    id,
                    source,
                    userId: userId ?? null,
                    channelId: channelId ?? null,
                    metadata: JSON.stringify(metadata),
                };
                this.db.insert(sessions).values(insert).run();
            }
        }, "session:ensure-failed");
    }

    get(id: string): SessionRow | undefined {
        return this.db.select().from(sessions).where(eq(sessions.id, id)).get();
    }

    list(limit = 100): SessionRow[] {
        return this.db.select().from(sessions).limit(limit).all();
    }
}
