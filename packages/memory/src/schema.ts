import { sqliteTable, text, integer, real, blob } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Episodic memory — timestamped, structured interaction records.
 * Replaces OpenClaw's plain Markdown daily logs.
 */
export const episodicMemory = sqliteTable("episodic_memory", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  role: text("role", { enum: ["user", "assistant", "system", "tool"] }).notNull(),
  content: text("content").notNull(),
  contentEncrypted: blob("content_encrypted"),
  source: text("source").notNull().default("cli"),
  taskId: text("task_id"),
  importance: real("importance").notNull().default(0.5),
  embeddingId: text("embedding_id"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  deletedAt: text("deleted_at"),
});

/**
 * Semantic embeddings for similarity search.
 * Vectors stored as BLOB (compatible with sqlite-vec).
 */
export const semanticEmbeddings = sqliteTable("semantic_embeddings", {
  id: text("id").primaryKey(),
  sourceTable: text("source_table").notNull(),
  sourceId: text("source_id").notNull(),
  content: text("content").notNull(),
  vector: blob("vector").notNull(),
  dimensions: integer("dimensions").notNull(),
  model: text("model").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

/**
 * User profile — typed preferences and facts about the user.
 * Versioned rows, latest value wins.
 */
export const profileMemory = sqliteTable("profile_memory", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  valueEncrypted: blob("value_encrypted"),
  category: text("category").notNull().default("general"),
  confidence: real("confidence").notNull().default(1.0),
  source: text("source").notNull().default("user"),
  version: integer("version").notNull().default(1),
  /** Last time this fact was injected into a prompt — drives decay. */
  lastReferencedAt: text("last_referenced_at"),
  /** Protected facts never decay. User-entered facts are always protected. */
  protected: integer("protected", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  deletedAt: text("deleted_at"),
});

/**
 * Sessions — groups of interactions.
 */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  channelId: text("channel_id"),
  userId: text("user_id"),
  title: text("title"),
  startedAt: text("started_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  lastActivityAt: text("last_activity_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  endedAt: text("ended_at"),
  metadata: text("metadata").default("{}"),
});

export type EpisodicMemoryRow = typeof episodicMemory.$inferSelect;
export type EpisodicMemoryInsert = typeof episodicMemory.$inferInsert;
export type ProfileMemoryRow = typeof profileMemory.$inferSelect;
export type ProfileMemoryInsert = typeof profileMemory.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type SessionInsert = typeof sessions.$inferInsert;
