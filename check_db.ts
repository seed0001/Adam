import Database from "better-sqlite3";
import { homedir } from "os";
import { join } from "path";

const dbPath = join(homedir(), ".adam", "data", "adam.db");
const db = new Database(dbPath);

console.log("--- Sessions Table ---");
const sessions = db.prepare("SELECT * FROM sessions ORDER BY last_activity_at DESC LIMIT 5").all();
console.table(sessions);

console.log("\n--- Latest Messages ---");
const messages = db.prepare("SELECT id, session_id, role, source, content, created_at FROM episodic_memory ORDER BY created_at DESC LIMIT 10").all();
console.table(messages);
