import Database from "better-sqlite3";
import { homedir } from "os";
import { join } from "path";

const dbPath = join(homedir(), ".adam", "data", "adam.db");
const db = new Database(dbPath);

console.log("--- Sessions Table (Recent) ---");
const sessions = db.prepare("SELECT id, source, user_id, channel_id, last_activity_at FROM sessions ORDER BY last_activity_at DESC LIMIT 5").all();
console.table(sessions);

console.log("\n--- Message Attribution Check ---");
const messages = db.prepare(`
  SELECT 
    m.id, 
    m.content, 
    s.user_id as attributed_user,
    m.created_at 
  FROM episodic_memory m
  LEFT JOIN sessions s ON m.session_id = s.id
  ORDER BY m.created_at DESC 
  LIMIT 10
`).all();
console.table(messages);
