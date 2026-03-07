import { eq, sql, desc } from "drizzle-orm";
import {
    type AdamError,
    type Result,
    ok,
    trySync,
    generateId,
} from "@adam/shared";
import { patches } from "./schema.js";
import type { AdamDB } from "./db.js";

export type PatchStatus = "proposed" | "approved" | "rejected" | "applied";
export type PatchSource = "reflex" | "review";

export interface PatchRow {
    id: string;
    source: PatchSource;
    taskId?: string | null;
    filePath: string;
    diff: string;
    rationale: string;
    status: PatchStatus;
    createdAt: string;
    updatedAt: string;
}

export interface PatchInsert {
    id?: string;
    source: PatchSource;
    taskId?: string | null;
    filePath: string;
    diff: string;
    rationale: string;
    status?: PatchStatus;
}

export class PatchStore {
    constructor(private db: AdamDB) { }

    create(insert: PatchInsert): Result<PatchRow, AdamError> {
        return trySync(() => {
            const id = insert.id || generateId();
            const row = {
                ...insert,
                id,
                status: insert.status || "proposed",
            };
            this.db.insert(patches).values(row).run();
            const created = this.get(id);
            if (!created) throw new Error("Failed to retrieve created patch");
            return created as PatchRow;
        }, "patch:create-failed");
    }

    updateStatus(id: string, status: PatchStatus): Result<void, AdamError> {
        return trySync(() => {
            this.db
                .update(patches)
                .set({ status, updatedAt: sql`datetime('now')` })
                .where(eq(patches.id, id))
                .run();
        }, "patch:update-failed");
    }

    get(id: string): PatchRow | undefined {
        return this.db.select().from(patches).where(eq(patches.id, id)).get() as PatchRow | undefined;
    }

    list(limit = 100): PatchRow[] {
        return this.db
            .select()
            .from(patches)
            .orderBy(desc(patches.createdAt))
            .limit(limit)
            .all() as PatchRow[];
    }

    listProposed(): PatchRow[] {
        return this.db
            .select()
            .from(patches)
            .where(eq(patches.status, "proposed"))
            .orderBy(desc(patches.createdAt))
            .all() as PatchRow[];
    }
}
