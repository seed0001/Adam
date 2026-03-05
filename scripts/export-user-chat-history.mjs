import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

function parseArgs(argv) {
  const args = {
    db: join(homedir(), ".adam", "data", "adam.db"),
    output: "",
    source: "",
    limit: 0,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--db" && argv[i + 1]) {
      args.db = argv[i + 1];
      i += 1;
    } else if (a === "--output" && argv[i + 1]) {
      args.output = argv[i + 1];
      i += 1;
    } else if (a === "--source" && argv[i + 1]) {
      args.source = argv[i + 1];
      i += 1;
    } else if (a === "--limit" && argv[i + 1]) {
      const n = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(n) && n > 0) args.limit = n;
      i += 1;
    }
  }
  return args;
}

function makeOutputPath(outputArg) {
  if (outputArg && outputArg.trim().length > 0) return outputArg;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return join(process.cwd(), "exports", `user-chat-history-${ts}.txt`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = makeOutputPath(args.output);

  const db = new Database(args.db, { readonly: true });

  const where = ["m.role = 'user'", "m.deleted_at is null"];
  const params = [];
  if (args.source) {
    where.push("m.source = ?");
    params.push(args.source);
  }

  let sql = `
    select
      m.id,
      m.session_id as sessionId,
      m.source,
      m.content,
      m.created_at as createdAt,
      s.channel_id as channelId,
      s.user_id as userId,
      s.title as sessionTitle
    from episodic_memory m
    left join sessions s on s.id = m.session_id
    where ${where.join(" and ")}
    order by m.created_at asc
  `;
  if (args.limit > 0) sql += ` limit ${args.limit}`;

  const rows = db.prepare(sql).all(...params);

  const lines = [];
  lines.push("Adam User Chat Export");
  lines.push("=====================");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Database: ${args.db}`);
  lines.push(`Total user messages: ${rows.length}`);
  if (args.source) lines.push(`Filtered source: ${args.source}`);
  lines.push("");

  for (const r of rows) {
    lines.push("---");
    lines.push(`id: ${r.id}`);
    lines.push(`created_at: ${r.createdAt}`);
    lines.push(`session_id: ${r.sessionId}`);
    lines.push(`source: ${r.source}`);
    if (r.channelId) lines.push(`channel_id: ${r.channelId}`);
    if (r.userId) lines.push(`user_id: ${r.userId}`);
    if (r.sessionTitle) lines.push(`session_title: ${r.sessionTitle}`);
    lines.push("content:");
    lines.push(String(r.content ?? "").trimEnd());
    lines.push("");
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, lines.join("\n"), "utf-8");
  console.log(outPath);
}

main();
