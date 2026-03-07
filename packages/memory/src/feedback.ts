import { sql } from "drizzle-orm";
import { generateId } from "@adam/shared";
import {
    feedback,
    traits,
    type FeedbackRow,
    type FeedbackInsert,
    type TraitRow
} from "./schema.js";

export class FeedbackStore {
    constructor(private db: any) { }

    createFeedback(data: Omit<FeedbackInsert, "id" | "createdAt">): string {
        const id = generateId();
        const now = new Date().toISOString();

        this.db.insert(feedback).values({
            ...data,
            id,
            createdAt: now,
        }).run();

        if (data.trait && data.type !== "neutral") {
            const delta = data.type === "positive" ? 1 : -1;
            this.updateTraitScore(data.trait, delta);
        }

        return id;
    }

    updateTraitScore(name: string, delta: number): void {
        const now = new Date().toISOString();
        const existing = this.db.select().from(traits).where(sql`name = ${name}`).get();

        if (existing) {
            this.db.update(traits)
                .set({
                    score: existing.score + delta,
                    updatedAt: now
                })
                .where(sql`name = ${name}`)
                .run();
        } else {
            this.db.insert(traits).values({
                name,
                score: delta,
                updatedAt: now,
            }).run();
        }
    }

    listTraits(): TraitRow[] {
        return this.db.select().from(traits).all();
    }

    getTrait(name: string): TraitRow | undefined {
        return this.db.select().from(traits).where(sql`name = ${name}`).get();
    }

    listFeedback(limit = 50): FeedbackRow[] {
        return this.db.select().from(feedback).limit(limit).all();
    }

    getGoldenExamples(limit = 10): FeedbackRow[] {
        return this.db.select().from(feedback).where(sql`is_golden = 1`).limit(limit).all();
    }
}
