import BetterSQLite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { ADAM_HOME_DIR } from "@adam/shared";
import * as schema from "./schema.js";

export type AdamDB = BetterSQLite3Database<typeof schema>;

let _db: AdamDB | null = null;
let _rawDb: BetterSQLite3.Database | null = null;

/**
 * Creates all schema tables if they don't exist yet.
 * Safe to call on every startup — uses IF NOT EXISTS throughout.
 */
function runMigrations(sqlite: BetterSQLite3.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS episodic_memory (
      id                TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL,
      role              TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
      content           TEXT NOT NULL DEFAULT '',
      content_encrypted BLOB,
      source            TEXT NOT NULL DEFAULT 'cli',
      task_id           TEXT,
      importance        REAL NOT NULL DEFAULT 0.5,
      embedding_id      TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at        TEXT
    );

    CREATE TABLE IF NOT EXISTS semantic_embeddings (
      id           TEXT PRIMARY KEY,
      source_table TEXT NOT NULL,
      source_id    TEXT NOT NULL,
      content      TEXT NOT NULL,
      vector       BLOB NOT NULL,
      dimensions   INTEGER NOT NULL,
      model        TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profile_memory (
      id              TEXT PRIMARY KEY,
      key             TEXT NOT NULL,
      value           TEXT NOT NULL DEFAULT '',
      value_encrypted BLOB,
      category        TEXT NOT NULL DEFAULT 'general',
      confidence      REAL NOT NULL DEFAULT 1.0,
      source          TEXT NOT NULL DEFAULT 'user',
      version         INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at      TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id               TEXT PRIMARY KEY,
      source           TEXT NOT NULL,
      channel_id       TEXT,
      user_id          TEXT,
      title            TEXT,
      started_at       TEXT NOT NULL DEFAULT (datetime('now')),
      last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at         TEXT,
      metadata         TEXT DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_episodic_session  ON episodic_memory(session_id);
    CREATE INDEX IF NOT EXISTS idx_episodic_created  ON episodic_memory(created_at);
    CREATE INDEX IF NOT EXISTS idx_profile_key       ON profile_memory(key);
    CREATE INDEX IF NOT EXISTS idx_sessions_source   ON sessions(source);
  `);
}

export function getDatabase(dataDir?: string): AdamDB {
  if (_db) return _db;

  const dir = dataDir ?? join(homedir(), ADAM_HOME_DIR, "data");
  mkdirSync(dir, { recursive: true });

  const dbPath = join(dir, "adam.db");
  const sqlite = new BetterSQLite3(dbPath);

  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("temp_store = MEMORY");
  sqlite.pragma("mmap_size = 268435456");

  runMigrations(sqlite);

  _db = drizzle(sqlite, { schema });
  return _db;
}

export function getRawDatabase(dataDir?: string): BetterSQLite3.Database {
  if (_rawDb) return _rawDb;

  const dir = dataDir ?? join(homedir(), ADAM_HOME_DIR, "data");
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, "adam.db");
  const sqlite = new BetterSQLite3(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  runMigrations(sqlite);

  _rawDb = sqlite;
  return _rawDb;
}
